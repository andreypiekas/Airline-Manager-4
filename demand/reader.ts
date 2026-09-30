import { readOperationalObservation } from '../optimization/observations';
import { automaticFaresFromControl } from '../pricing/ticket-pricing';
import { expect, Page } from '@playwright/test';
import { AircraftSnapshot, CollectionResult } from './types';
import { CabinText, integerText, parseCapacity, parseDemand } from './parsing';

interface RouteCard {
  routeId: string; aircraftId: string; registration: string; routeLabel: string;
  from: string; to: string; ready: boolean; inflight: boolean; pax: boolean;
}
/** Read-only navigation using DOM inspected on 2026-09-29. No direct HTTP requests. */
export class DemandReader {
  constructor(private readonly page: Page, private readonly timeout = 10000, private readonly includeInflightDetails = false) {}

  async collect(): Promise<CollectionResult> {
    const result: CollectionResult = { aircraft: [], complete: false, expectedRoutes: null, warnings: [] };
    const seenRoutes = new Set<string>();
    try {
      await this.page.locator('#routesContainer').waitFor({ state: 'visible', timeout: this.timeout });
      const heading = await this.page.getByRole('button', { name: /^Routes\s*\(\d+\)$/ }).innerText();
      result.expectedRoutes = integerText(heading.match(/\((\d+)\)/)![1]);
      for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
        const rows = this.page.locator('#routesContainer [id^="routeMainList"]');
        if (result.expectedRoutes > 0) await rows.first().waitFor({ state: 'visible', timeout: this.timeout });
        const cards: RouteCard[] = await rows.evaluateAll(elements => elements.map(el => {
          const routeId = el.id.replace(/^routeMainList/, '');
          const registration = el.querySelector('a [id^="acRegList"]');
          const routeLabel = Array.from(el.querySelectorAll('span.s-text')).map(e => e.textContent?.trim() || '').find(t => /^[A-Z0-9]{3}\s*-\s*[A-Z0-9]{3}$/.test(t)) || '';
          const codes = routeLabel.split(/\s*-\s*/);
          const depart = el.querySelector<HTMLButtonElement>(`#listDepart${routeId}`);
          const visible = !!el.getClientRects().length;
          return { routeId, aircraftId: registration?.id.replace(/^acRegList/, '') || '', registration: registration?.textContent?.trim() || '', routeLabel,
            from: codes[0] || '', to: codes[1] || '', pax: el.classList.contains('classPAX'),
            ready: visible && el.classList.contains('listDepartable') && !!depart && !depart.disabled && !!depart.getClientRects().length,
            inflight: visible && /Onboard\s*:/.test((el as HTMLElement).innerText) };
        }));
        for (const card of cards) {
          if (seenRoutes.has(card.routeId)) throw new Error('PAGINATION_DUPLICATE');
          seenRoutes.add(card.routeId);
          const item: AircraftSnapshot = { aircraftId: card.aircraftId, routeId: card.routeId, registration: card.registration,
            routeLabel: card.routeLabel, from: card.from, to: card.to, state: card.inflight ? 'inflight' : 'unavailable',
            capacity: null, remaining: null, dailyTotal: null, observedAt: new Date().toISOString() };
          result.aircraft.push(item);
          if (!card.pax) { item.state = 'unavailable'; item.issue = 'Carga/charter nao suportado nesta versao.'; continue; }
          if (!card.ready && !(this.includeInflightDetails && card.inflight)) continue;
          try {
            await this.readDetails(card, item);
          } catch {
            // Do not serialize exception messages, HTML, URLs, session data or credentials.
            item.state = card.inflight ? 'inflight' : 'unavailable'; item.issue = 'Falha de carregamento, identidade ou leitura dos detalhes.';
            result.warnings.push(`DETAILS_UNAVAILABLE:${/^\d+$/.test(card.routeId) ? card.routeId : 'invalid-id'}`);
          } finally {
            const back = this.page.locator('#route-name .glyphicons-chevron-left');
            if (await back.isVisible()) await back.click({ timeout: this.timeout });
            await this.page.locator('#routeAction').waitFor({ state: 'visible', timeout: this.timeout });
          }
        }
        const next = this.page.locator('#routesContainer .pagination').getByRole('link', { name: 'Next', exact: true });
        if (!(await next.count())) {
          result.complete = seenRoutes.size === result.expectedRoutes;
          if (!result.complete) result.warnings.push('ROUTE_COUNT_MISMATCH');
          return result;
        }
        const firstId = cards[0]?.routeId;
        await next.click({ timeout: this.timeout });
        await expect.poll(async () => this.page.locator('#routesContainer [id^="routeMainList"]').first().getAttribute('id'), { timeout: this.timeout }).not.toBe(`routeMainList${firstId}`);
      }
      result.warnings.push('PAGINATION_LIMIT');
    } catch {
      result.warnings.push('COLLECTION_FAILED');
    }
    return result;
  }

  private async readDetails(card: RouteCard, item: AircraftSnapshot): Promise<void> {
    if (!/^\d+$/.test(card.routeId) || !/^\d+$/.test(card.aircraftId)) throw new Error('Invalid identity');
    const cardLocator = this.page.locator(`#routeMainList${card.routeId}`);
    const link = cardLocator.locator('a').filter({ has: this.page.locator(`#acRegList${card.aircraftId}`) });
    if (await link.count() !== 1) throw new Error('Ambiguous aircraft link');
    await link.click({ timeout: this.timeout });
    const details = this.page.locator('#detailsAction');
    await details.waitFor({ state: 'visible', timeout: this.timeout });
    const depart = details.locator('#routeViewDepart');
    if (card.ready) {
      await depart.waitFor({ state: 'visible', timeout: this.timeout });
      await expect(depart).toHaveAttribute('onclick', new RegExp(`route_depart\\.php\\?id=${card.routeId}&`), { timeout: this.timeout });
      if (!(await depart.isEnabled()) || !(await details.locator('#routeViewGround_unground').isVisible())) throw new Error('Not ready / grounded');
    } else {
      // Inspected on the ATR in flight: countdown plus independent aircraft/route identities.
      await details.locator('#timer').waitFor({ state: 'visible', timeout: this.timeout });
      const callbacks = await details.locator('button').evaluateAll(es => es.map(e => e.getAttribute('onclick') || ''));
      if (!callbacks.some(s => s.includes(`fleet_details.php?id=${card.aircraftId}&mode=reg&`)) ||
          !callbacks.some(s => s.includes(`fleet_details.php?id=${card.routeId}&mode=routeReg&`)) || await depart.isVisible()) throw new Error('Inflight identity not confirmed');
    }
    await expect(details.locator('#ff-name')).toHaveText(card.registration, { timeout: this.timeout });
    if (!(await details.locator('#seat-layout').isVisible())) await details.getByText('Seat layout', { exact: true }).click({ timeout: this.timeout });
    if (!(await details.locator('#list-demand').isVisible())) await details.getByText('Todays demand', { exact: true }).click({ timeout: this.timeout });
    await details.locator('#seat-layout').waitFor({ state: 'visible', timeout: this.timeout });
    const text = await details.evaluate(el => {
      const readCabins = (selector: string, capacity: boolean) => {
        const out = { Y: '', J: '', F: '' };
        for (const [key, file] of [['Y', 'economy_seat.png'], ['J', 'business_seat.png'], ['F', 'first_seat.png']] as const) {
          const images = el.querySelectorAll(`${selector} img[src$="/${file}"]`);
          if (images.length !== 1) throw new Error('Missing/ambiguous cabin');
          const cell = images[0].parentElement!;
          // Capacity is text directly in the seat cell; exclude ticket-price form controls.
          out[key] = capacity ? Array.from(cell.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim() : (cell as HTMLElement).innerText.trim();
        }
        return out;
      };
      const codes = Array.from(el.querySelectorAll('.col-5 span.l-text')).map(e => e.textContent?.trim() || '');
      return { seats: readCabins('#seat-layout', true), demand: readCabins('#list-demand', false), codes };
    });
    if (text.codes.length !== 2 || [...text.codes].sort().join(':') !== [card.from, card.to].sort().join(':')) throw new Error('Route mismatch');
    const capacity = parseCapacity(text.seats as CabinText);
    const demand = parseDemand(text.demand as CabinText);
    if (card.inflight && (text.codes[0] !== card.from || text.codes[1] !== card.to)) throw new Error('Inflight direction mismatch');
    Object.assign(item, { capacity, ...demand, from: text.codes[0], to: text.codes[1], state: card.inflight ? 'inflight' : 'ready', observedAt: new Date().toISOString() });
    item.operational = await readOperationalObservation(details);
    // Read only the inspected Auto callback and ticket inputs. Never click Auto/Save or fill inputs.
    try {
      const auto = details.locator('#seat-layout').getByRole('button', { name: 'Auto', exact: true });
      if (await auto.count() !== 1 || !(await auto.isVisible())) throw new Error('Auto unavailable');
      const automatic = automaticFaresFromControl(await auto.getAttribute('onclick') || '');
      let current = null;
      try {
        current = { Y: integerText(await details.locator('#eTicket').inputValue()), J: integerText(await details.locator('#bTicket').inputValue()), F: integerText(await details.locator('#fTicket').inputValue()) };
      } catch { /* Unknown current fare does not invalidate the observed Auto reference. */ }
      item.fares = { automatic, current, source: 'inspected-auto-control' };
    } catch {
      item.fares = { automatic: null, current: null, source: 'unavailable', issue: 'Referencia Auto nao confirmada.' };
    }
  }
}
