import { Page } from '@playwright/test';
import { Cabins } from '../demand/types';
import { integerText } from '../demand/parsing';
import { inspectRouteCreateControl, RouteCreateControlEvidence } from './route-create-control';

export interface QuoteIdentity { aircraftId: string; registration: string; airportId: string; from: string; to: string }
export interface CandidateQuote extends QuoteIdentity {
  observedAt: string;
  distanceKm: number;
  durationSeconds: number;
  fuelLbs: number;
  co2KgPerPaxKm: number;
  costIndex: number;
  routeFee: number;
  aircraftOnRoute: number;
  dailyDemand: Cabins;
  autopriceReference: QuoteAutopriceReference | null;
  createControl?: RouteCreateControlEvidence;
  remainingDemand: null;
  netProfit: null;
  comparisonReady: false;
  mutationAuthorized: false;
}
/** Raw callback reference; effective VIP adjustments in autoPrice remain unverified. */
export interface QuoteAutopriceReference { base: Cabins; modelId: number; effectiveFares: null }
export function parseQuoteAutoprice(callback: string): QuoteAutopriceReference | null {
  const match=callback.trim().match(/^(?:playSound\('neutral_click'\);\s*)?autoPrice\((\d+),(\d+),(\d+),(\d+)\);?$/);
  if(!match)return null;
  const values=match.slice(1).map(Number);
  if(!values.every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  return {base:{Y:values[0],J:values[1],F:values[2]},modelId:values[3],effectiveFares:null};
}
export type QuoteReadResult = { status: 'observed'; quote: CandidateQuote } | { status: 'unavailable'; reason: string };

/** Reads an already-open, inspected quote. Does not navigate, click, fill or issue HTTP requests. */
export async function readOpenCandidateQuote(page: Page, identity: QuoteIdentity): Promise<QuoteReadResult> {
  try {
    if (!/^\d+$/.test(identity.aircraftId) || !/^\d+$/.test(identity.airportId) || !identity.registration ||
        !/^[A-Z0-9]{3}$/.test(identity.from) || !/^[A-Z0-9]{3}$/.test(identity.to) || identity.from === identity.to) throw new Error();
    const panel = page.locator('#newRouteInfo');
    if (await panel.count() !== 1 || !(await panel.isVisible())) throw new Error();
    const next = page.locator('#introSuggestm');
    if (await next.count() !== 1 || !(await next.isVisible())) throw new Error();
    const callback = await next.getAttribute('onclick') || '';
    const match = callback.match(/^playSound\('neutral_click'\);Ajax\('new_route_info\.php\?id=(\d+)&airportId=(\d+)&ferry=0','newRouteInfo',this,false,true\);\s*$/);
    if (!match || match[1] !== identity.aircraftId || match[2] !== identity.airportId) throw new Error();
    const raw = await panel.evaluate(el => {
      const one = (selector: string) => {
        const matches = Array.from(el.querySelectorAll(selector)).filter(e => e.getClientRects().length);
        if (matches.length !== 1) throw new Error();
        return matches[0].textContent?.trim() || '';
      };
      const labelledValue = (label: string) => {
        const matches = Array.from(el.querySelectorAll('div')).filter(e => e.childElementCount === 0 && e.textContent?.trim() === label && e.getClientRects().length);
        if (matches.length !== 1 || !matches[0].nextElementSibling?.getClientRects().length) throw new Error();
        return matches[0].nextElementSibling!.textContent?.trim() || '';
      };
      const headers = Array.from(el.querySelectorAll('td')).filter(e => e.textContent?.trim() === 'Daily pax demand' && e.getClientRects().length);
      if (headers.length !== 1) throw new Error();
      const rows = headers[0].closest('table')!.querySelectorAll('tr');
      if (rows.length !== 3 || rows[2].children.length !== 3) throw new Error();
      const images = rows[1].querySelectorAll('img');
      if (images.length !== 3 || ['economy','business','first'].some((name, i) => !images[i].getAttribute('src')?.endsWith('/'+name+'_seat.png'))) throw new Error();
      const fees = Array.from(el.querySelectorAll('b')).filter(e => e.textContent?.trim() === 'Route fee' && e.getClientRects().length);
      if (fees.length !== 1) throw new Error();
      const header = el.querySelector('.blue-bg');
      if (!header?.getClientRects().length) throw new Error();
      return {
        registration: Array.from(header.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim(),
        codes: Array.from(el.querySelectorAll('.col-3.m-text > b')).filter(e => e.getClientRects().length).map(e => e.textContent?.trim()),
        distance: one('.col-2 > span.s-text'), duration: one('#departFlightTimeInfo'), fuel: one('#departFuelInfo'),
        co2: one('#departCo2Info'), costIndex: one('#costIndexBar'), aircraft: labelledValue('A/C on route'),
        fee: fees[0].parentElement?.nextElementSibling?.textContent?.trim() || '',
        daily: Array.from(rows[2].children).map(e => e.textContent?.trim() || '')
      };
    });
    if (raw.registration !== identity.registration || raw.codes.length !== 2 || raw.codes[0] !== identity.from || raw.codes[1] !== identity.to) throw new Error();
    const time = raw.duration.match(/^(\d{2,3}):([0-5]\d):([0-5]\d)$/);
    if (!time || !/^\$\s*[\d,]+$/.test(raw.fee) || !/^\d+(?:\.\d+)?$/.test(raw.co2)) throw new Error();
    const durationSeconds = Number(time[1])*3600 + Number(time[2])*60 + Number(time[3]);
    const auto=panel.locator('#introAuto');
    const autopriceReference=await auto.count()===1 && await auto.isVisible()?parseQuoteAutoprice(await auto.getAttribute('onclick')||''):null;
    const create=panel.locator('#btnCreateNewRoute');
    const createControl=inspectRouteCreateControl({
      id:await create.count()===1?await create.getAttribute('id'):null,
      label:await create.count()===1?(await create.innerText().catch(()=>'')):null,
      onclick:await create.count()===1?await create.getAttribute('onclick'):null,
      visible:await create.count()===1?await create.isVisible():false,
      enabled:await create.count()===1?await create.isEnabled().catch(()=>false):false
    });
    const quote: CandidateQuote = { ...identity, observedAt: new Date().toISOString(), distanceKm: integerText(raw.distance), durationSeconds,
      fuelLbs: integerText(raw.fuel), co2KgPerPaxKm: Number(raw.co2), costIndex: integerText(raw.costIndex), routeFee: integerText(raw.fee.replace(/^\$\s*/, '')),
      aircraftOnRoute: integerText(raw.aircraft), autopriceReference, createControl, dailyDemand: { Y: integerText(raw.daily[0]), J: integerText(raw.daily[1]), F: integerText(raw.daily[2]) },
      remainingDemand: null, netProfit: null, comparisonReady: false, mutationAuthorized: false };
    if (quote.distanceKm <= 0 || durationSeconds <= 0 || quote.fuelLbs <= 0 || !Number.isFinite(quote.co2KgPerPaxKm) || quote.costIndex > 200) throw new Error();
    return { status: 'observed', quote };
  } catch { return { status: 'unavailable', reason: 'Orcamento ausente, identidade divergente ou estrutura/valores nao confirmados.' }; }
}
