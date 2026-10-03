import { Page } from '@playwright/test';
import { Cabins } from '../demand/types';
import { integerText } from '../demand/parsing';
import { inspectRouteCreateControl, RouteCreateControlEvidence } from './route-create-control';
import { readRouteListenerDiagnostics, RouteListenerDiagnostic } from './route-listener-diagnostics';
import { readRouteMutationControl, RouteMutationControlEvidence } from './route-mutation-control';
import { readAutopriceFunctionEvidence, effectiveAutopriceBase, AutopriceFunctionEvidence } from './autoprice-diagnostics';
import { readRouteQuoteFieldDiagnostics, RouteQuoteFieldDiagnostic } from './route-quote-diagnostics';
import type { RouteResponseDiagnostic } from './route-response-diagnostics';
import { inspectRouteDirectionEvidence, RouteDirectionEvidence } from './route-direction-evidence';

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
  routeActionDiagnostics?: Array<{
    tag:string;id:string|null;label:string|null;role:string|null;type:string|null;
    callbackShape:string|null;hrefShape:string|null;phpEndpoints:string[];attributeNames:string[];
  }>;
  routeListenerDiagnostics?: RouteListenerDiagnostic[];
  routeMutationControl?: RouteMutationControlEvidence;
  autopriceFunctionEvidence?: AutopriceFunctionEvidence;
  quoteFieldDiagnostics?: RouteQuoteFieldDiagnostic[];
  routeDirectionEvidence?: RouteDirectionEvidence;
  routeResponseDiagnostics?: RouteResponseDiagnostic;
  remainingDemand: null;
  netProfit: null;
  comparisonReady: false;
  mutationAuthorized: false;
}
/** Raw callback reference; effective VIP adjustments in autoPrice remain unverified. */
export interface QuoteAutopriceReference { base: Cabins; modelId: number; effectiveFares: Cabins | null }
export function parseQuoteAutoprice(callback: string): QuoteAutopriceReference | null {
  const match=callback.trim().match(/^(?:playSound\('neutral_click'\);\s*)?autoPrice\((\d+),(\d+),(\d+),(\d+)\);?$/);
  if(!match)return null;
  const values=match.slice(1).map(Number);
  if(!values.every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  return {base:{Y:values[0],J:values[1],F:values[2]},modelId:values[3],effectiveFares:null};
}
export type QuoteReadResult = { status: 'observed'; quote: CandidateQuote } | { status: 'unavailable'; reason: string };

/** Reads an already-open suggestion quote and verifies the native Next-suggestion callback. */
export async function readOpenCandidateQuote(page: Page, identity: QuoteIdentity): Promise<QuoteReadResult> {
  return readOpenCandidateQuoteInternal(page,identity,true);
}

/**
 * Reads a quote opened by a caller that already verified and issued the exact
 * read-only new_route_info.php Ajax request. It deliberately skips only the
 * #introSuggestm linkage check; registration plus two independent rendered
 * direction sources still have to match the supplied identity.
 */
export async function readOpenCandidateQuoteAfterVerifiedAjax(page: Page, identity: QuoteIdentity): Promise<QuoteReadResult> {
  return readOpenCandidateQuoteInternal(page,identity,false);
}

async function readOpenCandidateQuoteInternal(page: Page, identity: QuoteIdentity, requireSuggestionControl:boolean): Promise<QuoteReadResult> {
  try {
    if (!/^\d+$/.test(identity.aircraftId) || !/^\d+$/.test(identity.airportId) || !identity.registration ||
        !/^[A-Z0-9]{3}$/.test(identity.from) || !/^[A-Z0-9]{3}$/.test(identity.to) || identity.from === identity.to) throw new Error();
    const panel = page.locator('#newRouteInfo');
    if (await panel.count() !== 1 || !(await panel.isVisible())) throw new Error();
    if(requireSuggestionControl){
      const next = page.locator('#introSuggestm');
      if (await next.count() !== 1 || !(await next.isVisible())) throw new Error();
      const callback = await next.getAttribute('onclick') || '';
      const match = callback.match(/^playSound\('neutral_click'\);Ajax\('new_route_info\.php\?id=(\d+)&airportId=(\d+)&ferry=0','newRouteInfo',this,false,true\);\s*$/);
      if (!match || match[1] !== identity.aircraftId || match[2] !== identity.airportId) throw new Error();
    }
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
        routeHeader: (() => {
          const distanceNode=Array.from(el.querySelectorAll('.col-2 > span.s-text')).find(e=>e.getClientRects().length);
          const row=distanceNode?.closest('.row');
          return row ? ((row as HTMLElement).innerText||'').replace(/\s+/g,' ').trim() : '';
        })(),
        distance: one('.col-2 > span.s-text'), duration: one('#departFlightTimeInfo'), fuel: one('#departFuelInfo'),
        co2: one('#departCo2Info'), costIndex: one('#costIndexBar'), aircraft: labelledValue('A/C on route'),
        fee: fees[0].parentElement?.nextElementSibling?.textContent?.trim() || '',
        daily: Array.from(rows[2].children).map(e => e.textContent?.trim() || '')
      };
    });
    if (raw.registration !== identity.registration) throw new Error();
    const routeDirectionEvidence=inspectRouteDirectionEvidence(raw.codes,raw.routeHeader,identity);
    if(!routeDirectionEvidence.verified) throw new Error();
    const time = raw.duration.match(/^(\d{2,3}):([0-5]\d):([0-5]\d)$/);
    if (!time || !/^\$\s*[\d,]+$/.test(raw.fee) || !/^\d+(?:\.\d+)?$/.test(raw.co2)) throw new Error();
    const durationSeconds = Number(time[1])*3600 + Number(time[2])*60 + Number(time[3]);
    const auto=panel.locator('#introAuto');
    let autopriceReference=await auto.count()===1 && await auto.isVisible()?parseQuoteAutoprice(await auto.getAttribute('onclick')||''):null;
    // The live AM4 UI does not consistently expose the same tag/id for this
    // action. Inspect any unique visible element that actually owns an onclick
    // and whose rendered label starts with "Create route". Never click it here.
    const createCandidates=await panel.locator('[onclick]').evaluateAll(elements=>elements.flatMap(e=>{
      const visible=!!e.getClientRects().length;
      const label=((e as HTMLElement).innerText||(e as HTMLInputElement).value||'').replace(/\s+/g,' ').trim();
      if(!visible||!/^Create route(?:\b|\s|$)/i.test(label))return [];
      const disabled=(e as HTMLButtonElement).disabled===true||e.getAttribute('aria-disabled')==='true'||e.classList.contains('disabled');
      return [{
        id:e.getAttribute('id'),
        label:label.slice(0,100),
        onclick:e.getAttribute('onclick'),
        visible:true,
        enabled:!disabled
      }];
    }));
    const createControl=inspectRouteCreateControl(createCandidates.length===1?createCandidates[0]:{
      id:null,label:null,onclick:null,visible:false,enabled:false
    });

    // Passive structural inventory for the live route quote. This is intentionally
    // broad because AM4 may bind Create route through a non-button element or a
    // delegated listener. Values/tokens are never retained: only labels, tag/id,
    // attribute names, endpoint names and redacted callback/href shapes.
    const routeActionDiagnostics=await panel.locator('button,a,input,[role="button"],[onclick]').evaluateAll(elements=>{
      const sanitize=(value:string|null)=>{
        if(!value)return null;
        return value
          .replace(/([?&][A-Za-z0-9_-]+)=([^&'"\s)]+)/g,'$1=<value>')
          .replace(/\d+/g,'#')
          .replace(/\s+/g,' ')
          .trim()
          .slice(0,400);
      };
      const endpoints=(value:string|null)=>value
        ? [...new Set(Array.from(value.matchAll(/([A-Za-z0-9_-]+\.php)(?:\?|['"\s]|$)/g),m=>m[1]))].slice(0,10)
        : [];
      return elements.flatMap(e=>{
        if(!e.getClientRects().length)return [];
        const label=((e as HTMLElement).innerText||(e as HTMLInputElement).value||e.getAttribute('aria-label')||e.getAttribute('title')||'')
          .replace(/\s+/g,' ').trim().slice(0,120);
        const onclick=e.getAttribute('onclick');
        const href=e.getAttribute('href')||e.getAttribute('formaction');
        const phpEndpoints=[...new Set([...endpoints(onclick),...endpoints(href)])];
        const relevant=!!onclick||!!href||/create|route|new|confirm|save|open|depart/i.test(label);
        if(!relevant)return [];
        return [{
          tag:e.tagName.toLowerCase(),
          id:e.getAttribute('id')?.slice(0,100)||null,
          label:label||null,
          role:e.getAttribute('role')?.slice(0,60)||null,
          type:e.getAttribute('type')?.slice(0,60)||null,
          callbackShape:sanitize(onclick),
          hrefShape:sanitize(href),
          phpEndpoints,
          attributeNames:Array.from(e.attributes).map(a=>a.name).filter(n=>n!=='style').slice(0,30)
        }];
      }).slice(0,20);
    });
    const routeListenerDiagnostics=await readRouteListenerDiagnostics(page);
    const routeMutationControl=await readRouteMutationControl(page,identity);
    const autopriceFunctionEvidence=autopriceReference?await readAutopriceFunctionEvidence(page):undefined;
    const quoteFieldDiagnostics=await readRouteQuoteFieldDiagnostics(page);
    if(autopriceReference&&autopriceFunctionEvidence){
      autopriceReference={...autopriceReference,effectiveFares:effectiveAutopriceBase(autopriceReference.base,autopriceReference.modelId,autopriceFunctionEvidence)};
    }
    const quote: CandidateQuote = { ...identity, observedAt: new Date().toISOString(), distanceKm: integerText(raw.distance), durationSeconds,
      fuelLbs: integerText(raw.fuel), co2KgPerPaxKm: Number(raw.co2), costIndex: integerText(raw.costIndex), routeFee: integerText(raw.fee.replace(/^\$\s*/, '')),
      aircraftOnRoute: integerText(raw.aircraft), autopriceReference, createControl, routeActionDiagnostics, routeListenerDiagnostics, routeMutationControl, autopriceFunctionEvidence, quoteFieldDiagnostics, routeDirectionEvidence, dailyDemand: { Y: integerText(raw.daily[0]), J: integerText(raw.daily[1]), F: integerText(raw.daily[2]) },
      remainingDemand: null, netProfit: null, comparisonReady: false, mutationAuthorized: false };
    if (quote.distanceKm <= 0 || durationSeconds <= 0 || quote.fuelLbs <= 0 || !Number.isFinite(quote.co2KgPerPaxKm) || quote.costIndex > 200) throw new Error();
    return { status: 'observed', quote };
  } catch { return { status: 'unavailable', reason: 'Orcamento ausente, identidade divergente ou estrutura/valores nao confirmados.' }; }
}
