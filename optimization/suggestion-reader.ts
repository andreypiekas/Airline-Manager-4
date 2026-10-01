import { expect, Page } from '@playwright/test';
import { AircraftSnapshot } from '../demand/types';
import { CandidateQuote, readOpenCandidateQuote } from './quote-reader';

/** Bounded native suggestions from an ALREADY OPEN planner. Only inspection clicks. */
export async function collectOpenRouteSuggestions(page: Page, aircraft: AircraftSnapshot, origin: string | null, limit=3, timeout=10000) {
  const result={aircraftId:aircraft.aircraftId,quotes:[] as CandidateQuote[],status:'unavailable',warnings:[] as string[],candidatesComplete:false,comparisonReady:false,mutationAuthorized:false};
  if(!Number.isSafeInteger(limit)||limit<1||limit>10||!Number.isSafeInteger(timeout)||timeout<1||timeout>30000)throw new Error('SUGGESTION_CONFIG_INVALID');
  // Never research a replacement for a plane away from its own confirmed origin.
  const age=Date.now()-Date.parse(aircraft.observedAt);
  if(!Number.isFinite(age)||age<0||age>300000){result.warnings.push('AIRCRAFT_OBSERVATION_EXPIRED');return result;}
  if(!origin || aircraft.state!=='ready' || aircraft.issue || aircraft.from!==origin || !/^[A-Z]{3}$/.test(origin) || !/^\d+$/.test(aircraft.aircraftId) || !aircraft.registration) {
    result.warnings.push('AIRCRAFT_NOT_READY_AT_BASE');return result;
  }
  const seen=new Set<string>();
  try {
    for(let i=0;i<limit;i++) {
      const suggest=page.locator(i===0?'#introSuggest':'#introSuggestOR');
      if(await suggest.count()!==1||!await suggest.isVisible()||!await suggest.isEnabled())throw new Error();
      const callback=(await suggest.getAttribute('onclick')||'').trim();
      const allowed=`playSound('neutral_click');Ajax('add_airports.php?mode=suggest&id=${aircraft.aircraftId}','runme',this,false,true);`;
      const tail=callback.slice(allowed.length).replace(/\s/g,'');
      if(!callback.startsWith(allowed)||!(tail===''||i===0&&tail==='isItrouteClick=true;hideAirpAndHubs();remPrevClickedMarkerAirc();'))throw new Error();
      const previousNext=await page.locator('#introSuggestm').count()===1 ? await page.locator('#introSuggestm').elementHandle() : null;
      try {
        await suggest.click({timeout});
        // Ajax replaces the suggestion markup. Do not accept the previous destination
        // while the next read request is still loading.
        if(previousNext)await expect.poll(()=>previousNext.evaluate(e=>e.isConnected),{timeout}).toBe(false);
      } finally {await previousNext?.dispose();}
      const next=page.locator('#introSuggestm');
      await expect(next).toHaveAttribute('onclick',new RegExp(`^playSound\\('neutral_click'\\);Ajax\\('new_route_info\\.php\\?id=${aircraft.aircraftId}&airportId=\\d+&ferry=0','newRouteInfo',this,false,true\\);\\s*$`),{timeout});
      const quoteCallback=await next.getAttribute('onclick')||'';
      const airportId=quoteCallback.match(/&airportId=(\d+)&/)![1];
      if(seen.has(airportId)){result.warnings.push('REPEATED_SUGGESTION');break;}
      seen.add(airportId);
      await next.click({timeout});
      const panel=page.locator('#newRouteInfo');
      await panel.waitFor({state:'visible',timeout});
      const codes=await panel.locator('.col-3.m-text > b').allTextContents();
      if(codes.length!==2||codes[0].trim()!==origin||!/^[A-Z]{3}$/.test(codes[1].trim()))throw new Error();
      const read=await readOpenCandidateQuote(page,{aircraftId:aircraft.aircraftId,registration:aircraft.registration,airportId,from:origin,to:codes[1].trim()});
      if(read.status!=='observed')throw new Error();
      result.quotes.push(read.quote);
      const back=panel.getByRole('button',{name:/Back$/});
      if(await back.count()!==1)throw new Error();
      // Confirm the inspected close-only callback before clicking. Never click Create route.
      if(!/^\$\('#newRouteInfo'\)\.hide\('fast'\);playSound\('neutral_click'\);(?:\/\*(?:(?!\*\/)[\s\S])*\*\/)?$/.test(await back.getAttribute('onclick')||''))throw new Error();
      await back.click({timeout});await panel.waitFor({state:'hidden',timeout});
    }
    result.status=result.quotes.length?'observed':'unavailable';
  } catch {result.status=result.quotes.length?'partial':'unavailable';result.warnings.push('SUGGESTION_LOADING_OR_IDENTITY_FAILED');}
  result.warnings.push('NATIVE_SUGGESTIONS_NOT_EXHAUSTIVE','REMAINING_DEMAND_AND_FULL_COSTS_MISSING');
  return result;
}
