import { expect, Page } from '@playwright/test';
import { AircraftSnapshot } from '../demand/types';
import { CandidateQuote, readOpenCandidateQuote } from './quote-reader';
import { screenCandidateEconomics } from './economic-screen';
import { inspectRouteQuoteResponse } from './route-response-diagnostics';

/** Bounded native suggestions from an ALREADY OPEN planner. Only inspection clicks. */
export async function collectOpenRouteSuggestions(page: Page, aircraft: AircraftSnapshot, origin: string | null, limit=3, timeout=10000, minCoveragePercent=80, scanLimit=Math.min(10,Math.max(limit,limit*3))) {
  const result={aircraftId:aircraft.aircraftId,quotes:[] as CandidateQuote[],screenedOut:[] as {airportId:string;to:string;coverageCeilingPercent:number|null;reason:string}[],
    scanned:0,status:'unavailable',warnings:[] as string[],stage:'init' as string,candidatesComplete:false,comparisonReady:false,mutationAuthorized:false};
  if(!Number.isSafeInteger(limit)||limit<1||limit>10||!Number.isSafeInteger(timeout)||timeout<1||timeout>30000||
    !Number.isFinite(minCoveragePercent)||minCoveragePercent<=0||minCoveragePercent>100||
    !Number.isSafeInteger(scanLimit)||scanLimit<limit||scanLimit>20)throw new Error('SUGGESTION_CONFIG_INVALID');
  // Never research a replacement for a plane away from its own confirmed origin.
  const age=Date.now()-Date.parse(aircraft.observedAt);
  if(!Number.isFinite(age)||age<0||age>300000){result.warnings.push('AIRCRAFT_OBSERVATION_EXPIRED');return result;}
  if(!origin || aircraft.state!=='ready' || aircraft.issue || aircraft.from!==origin || !/^[A-Z]{3}$/.test(origin) || !/^\d+$/.test(aircraft.aircraftId) || !aircraft.registration) {
    result.warnings.push('AIRCRAFT_NOT_READY_AT_BASE');return result;
  }
  const seen=new Set<string>();
  try {
    for(let i=0;i<scanLimit && result.quotes.length<limit;i++) {
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
      result.stage='next_control';
    const next=page.locator('#introSuggestm');
      await expect(next).toHaveAttribute('onclick',new RegExp(`^playSound\\('neutral_click'\\);Ajax\\('new_route_info\\.php\\?id=${aircraft.aircraftId}&airportId=\\d+&ferry=0','newRouteInfo',this,false,true\\);\\s*$`),{timeout});
      const quoteCallback=await next.getAttribute('onclick')||'';
      const airportId=quoteCallback.match(/&airportId=(\d+)&/)![1];
      if(seen.has(airportId)){result.warnings.push('REPEATED_SUGGESTION');break;}
      seen.add(airportId);
      result.stage='quote_click';
    const responsePromise=page.waitForResponse(r=>{
        try{
          const u=new URL(r.url());
          return u.pathname.endsWith('/new_route_info.php')&&u.searchParams.get('id')===aircraft.aircraftId&&
            u.searchParams.get('airportId')===airportId&&u.searchParams.get('ferry')==='0';
        }catch{return false;}
      },{timeout});
      const [responseResult]=await Promise.allSettled([responsePromise,next.click({timeout})]);
      result.stage='quote_panel';
    const panel=page.locator('#newRouteInfo');
      await panel.waitFor({state:'visible',timeout});
      const codes=await panel.locator('.col-3.m-text > b').allTextContents();
      if(codes.length!==2||codes[0].trim()!==origin||!/^[A-Z]{3}$/.test(codes[1].trim()))throw new Error();
      result.stage='quote_read';
    const read=await readOpenCandidateQuote(page,{aircraftId:aircraft.aircraftId,registration:aircraft.registration,airportId,from:origin,to:codes[1].trim()});
      if(read.status!=='observed')throw new Error();
      if(responseResult.status==='fulfilled'&&responseResult.value.ok()){
        try{read.quote.routeResponseDiagnostics=inspectRouteQuoteResponse(await responseResult.value.text());}
        catch{read.quote.routeResponseDiagnostics=inspectRouteQuoteResponse('');}
      }else read.quote.routeResponseDiagnostics=inspectRouteQuoteResponse('');
      result.scanned++;
      const screening=screenCandidateEconomics(read.quote,aircraft.capacity,minCoveragePercent,new Date(),300);
      if(screening.demandStatus==='cannot_meet_threshold') {
        result.screenedOut.push({airportId,to:read.quote.to,coverageCeilingPercent:screening.coverageCeilingPercent,reason:screening.reason});
      } else {
        result.quotes.push(read.quote);
      }
      result.stage='back_control';
    const back=panel.getByRole('button',{name:/Back$/});
      if(await back.count()!==1)throw new Error();
      // Confirm the inspected close-only callback before clicking. Never click Create route.
      if(!/^\$\('#newRouteInfo'\)\.hide\('fast'\);playSound\('neutral_click'\);(?:\/\*(?:(?!\*\/)[\s\S])*\*\/)?$/.test(await back.getAttribute('onclick')||''))throw new Error();
      await back.click({timeout});await panel.waitFor({state:'hidden',timeout});
    }
    result.status=result.quotes.length?'observed':'unavailable';
  } catch {result.status=result.quotes.length?'partial':'unavailable';result.warnings.push('SUGGESTION_LOADING_OR_IDENTITY_FAILED');}
  if(result.screenedOut.length)result.warnings.push(`SCREENED_OUT_BELOW_DAILY_DEMAND_CEILING:${result.screenedOut.length}`);
  if(result.scanned>=scanLimit&&result.quotes.length<limit)result.warnings.push('SUGGESTION_SCAN_LIMIT_REACHED');
  result.warnings.push('NATIVE_SUGGESTIONS_NOT_EXHAUSTIVE','REMAINING_DEMAND_AND_FULL_COSTS_MISSING');
  return result;
}


/**
 * Read-only fallback probe used only when no aircraft is currently ready at its
 * confirmed base. It may inspect one suggestion from the aircraft's current
 * airport to discover the live route-action control shape. The observation is
 * never returned as an optimization candidate and can never authorize reroute.
 */
export async function probeOpenRouteControl(page:Page,aircraft:AircraftSnapshot,currentAirport:string,timeout=10000){
  const result={
    aircraftId:aircraft.aircraftId,
    registration:aircraft.registration,
    currentAirport,
    status:'unavailable' as 'observed'|'unavailable',
    observation:null as null|{
      airportId:string;from:string;to:string;
      createControl:CandidateQuote['createControl']|null;
      routeActionDiagnostics:NonNullable<CandidateQuote['routeActionDiagnostics']>;
      routeListenerDiagnostics:NonNullable<CandidateQuote['routeListenerDiagnostics']>;
      routeMutationControl:CandidateQuote['routeMutationControl']|null;
      autopriceFunctionEvidence:CandidateQuote['autopriceFunctionEvidence']|null;
      quoteFieldDiagnostics:NonNullable<CandidateQuote['quoteFieldDiagnostics']>;
      routeResponseDiagnostics:NonNullable<CandidateQuote['routeResponseDiagnostics']>;
    },
    warnings:[] as string[],
    stage:'init' as string,
    mutationAuthorized:false as false
  };
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30000)throw new Error('SUGGESTION_CONFIG_INVALID');
  const age=Date.now()-Date.parse(aircraft.observedAt);
  if(!Number.isFinite(age)||age<0||age>300000){result.warnings.push('AIRCRAFT_OBSERVATION_EXPIRED');return result;}
  if(aircraft.state!=='ready'||aircraft.issue||aircraft.from!==currentAirport||!/^[A-Z]{3}$/.test(currentAirport)||
    !/^\d+$/.test(aircraft.aircraftId)||!aircraft.registration){
    result.warnings.push('DIAGNOSTIC_AIRCRAFT_CONTEXT_INVALID');return result;
  }
  try{
    result.stage='suggest_control';
    const suggest=page.locator('#introSuggest');
    if(await suggest.count()!==1||!await suggest.isVisible()||!await suggest.isEnabled())throw new Error();
    const callback=(await suggest.getAttribute('onclick')||'').trim();
    const allowed=`playSound('neutral_click');Ajax('add_airports.php?mode=suggest&id=${aircraft.aircraftId}','runme',this,false,true);`;
    const tail=callback.slice(allowed.length).replace(/\s/g,'');
    if(!callback.startsWith(allowed)||!(tail===''||tail==='isItrouteClick=true;hideAirpAndHubs();remPrevClickedMarkerAirc();'))throw new Error();

    result.stage='suggest_click';
    const previousNext=await page.locator('#introSuggestm').count()===1?await page.locator('#introSuggestm').elementHandle():null;
    try{
      await suggest.click({timeout});
      if(previousNext)await expect.poll(()=>previousNext.evaluate(e=>e.isConnected),{timeout}).toBe(false);
    }finally{await previousNext?.dispose();}

    const next=page.locator('#introSuggestm');
    await expect(next).toHaveAttribute('onclick',new RegExp(
      `^playSound\\('neutral_click'\\);Ajax\\('new_route_info\\.php\\?id=${aircraft.aircraftId}&airportId=\\d+&ferry=0','newRouteInfo',this,false,true\\);\\s*$`
    ),{timeout});
    const quoteCallback=await next.getAttribute('onclick')||'';
    const airportId=quoteCallback.match(/&airportId=(\d+)&/)![1];
    const responsePromise=page.waitForResponse(r=>{
      try{
        const u=new URL(r.url());
        return u.pathname.endsWith('/new_route_info.php')&&u.searchParams.get('id')===aircraft.aircraftId&&
          u.searchParams.get('airportId')===airportId&&u.searchParams.get('ferry')==='0';
      }catch{return false;}
    },{timeout});
    const [responseResult]=await Promise.allSettled([responsePromise,next.click({timeout})]);
    const panel=page.locator('#newRouteInfo');
    await panel.waitFor({state:'visible',timeout});
    const codes=(await panel.locator('.col-3.m-text > b').allTextContents()).map(s=>s.trim());
    if(codes.length!==2||codes[0]!==currentAirport||!/^[A-Z]{3}$/.test(codes[1]))throw new Error();
    const read=await readOpenCandidateQuote(page,{
      aircraftId:aircraft.aircraftId,registration:aircraft.registration,airportId,from:currentAirport,to:codes[1]
    });
    if(read.status!=='observed')throw new Error();
    if(responseResult.status==='fulfilled'&&responseResult.value.ok()){
      try{read.quote.routeResponseDiagnostics=inspectRouteQuoteResponse(await responseResult.value.text());}
      catch{read.quote.routeResponseDiagnostics=inspectRouteQuoteResponse('');}
    }else read.quote.routeResponseDiagnostics=inspectRouteQuoteResponse('');
    result.stage='observed';
    result.observation={
      airportId,from:read.quote.from,to:read.quote.to,
      createControl:read.quote.createControl||null,
      routeActionDiagnostics:read.quote.routeActionDiagnostics||[],
      routeListenerDiagnostics:read.quote.routeListenerDiagnostics||[],
      routeMutationControl:read.quote.routeMutationControl||null,
      autopriceFunctionEvidence:read.quote.autopriceFunctionEvidence||null,
      quoteFieldDiagnostics:read.quote.quoteFieldDiagnostics||[],
      routeResponseDiagnostics:read.quote.routeResponseDiagnostics||inspectRouteQuoteResponse('')
    };
    result.status='observed';

    const back=panel.getByRole('button',{name:/Back$/});
    if(await back.count()!==1||!/^\$\('#newRouteInfo'\)\.hide\('fast'\);playSound\('neutral_click'\);(?:\/\*(?:(?!\*\/)[\s\S])*\*\/)?$/.test(await back.getAttribute('onclick')||''))throw new Error();
    await back.click({timeout});await panel.waitFor({state:'hidden',timeout});
    result.stage='complete';
  }catch{
    result.status='unavailable';
    result.warnings.push('DIAGNOSTIC_ROUTE_CONTROL_PROBE_FAILED:'+result.stage);
  }
  return result;
}
