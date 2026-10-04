import { Page, Request } from '@playwright/test';
import { CLASSES, type AircraftSnapshot, type Cabins } from '../demand/types';
import { DemandReader } from '../demand/reader';
import { findFleetRoute, openFleetList } from '../demand/navigation';
import { readOpenCandidateQuoteAfterVerifiedAjax } from './quote-reader';
import { readRouteMutationControl } from './route-mutation-control';
import type { RouteExecutionCandidate, RouteExecutionPort } from './route-executor';

export function routePrepareStepTimeout(timeout:number){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>60_000)throw new Error('ROUTE_TIMEOUT_INVALID');
  return Math.min(timeout,5_000);
}

const sameCabins=(a:Cabins,b:Cabins)=>CLASSES.every(k=>a[k]===b[k]);
const sameTarget=(a:RouteExecutionCandidate,b:RouteExecutionCandidate)=>
  a.aircraftId===b.aircraftId&&a.from===b.from&&a.to===b.to&&a.airportId===b.airportId&&
  a.costIndex===b.costIndex&&a.distanceKm===b.distanceKm&&a.durationSeconds===b.durationSeconds&&
  a.fuelLbs===b.fuelLbs&&a.co2KgPerPaxKm===b.co2KgPerPaxKm&&a.routeFee===b.routeFee&&
  sameCabins(a.capacity,b.capacity)&&sameCabins(a.autoFares,b.autoFares);

const strictContext=(a:AircraftSnapshot,b:AircraftSnapshot)=>
  a.aircraftId===b.aircraftId&&a.registration===b.registration&&a.routeId===b.routeId&&
  a.from===b.from&&a.to===b.to&&a.state==='ready'&&b.state==='ready'&&!a.issue&&!b.issue;

const numericInput=async(page:Page,id:string)=>{
  const input=page.locator('#newRouteInfo '+id);
  if(await input.count()!==1||!await input.isVisible()||!await input.isEnabled())throw new Error('ROUTE_INPUT_UNAVAILABLE');
  const raw=(await input.inputValue()).trim();
  if(!/^[1-9]\d*$/.test(raw))throw new Error('ROUTE_INPUT_INVALID');
  const n=Number(raw);
  if(!Number.isSafeInteger(n)||n<=0)throw new Error('ROUTE_INPUT_INVALID');
  return n;
};

export class PlaywrightRouteExecutionPort implements RouteExecutionPort {
  private prepared:{aircraft:AircraftSnapshot;target:RouteExecutionCandidate;routeRegistration:string}|null=null;

  constructor(private readonly page:Page,private readonly timeout=15000){}

  private async openTarget(expected:AircraftSnapshot,target:RouteExecutionCandidate){
    this.prepared=null;
    const timeout=routePrepareStepTimeout(this.timeout);
    // Several passive locator reads inside the fresh-context verification do not
    // carry their own timeout. Bound those reads as well so a stale/partial UI
    // cannot consume the whole workflow deadline before any mutation attempt.
    this.page.setDefaultTimeout(timeout);
    try{
    await openFleetList(this.page,timeout);
    await findFleetRoute(this.page,expected,timeout);
    const fresh=await new DemandReader(this.page,timeout,true).readReadyAircraftDetails(expected);
    if(!strictContext(expected,fresh))throw new Error('ROUTE_CURRENT_CONTEXT_CHANGED');

    const reroute=this.page.locator('#detailsAction').getByRole('button',{name:/^Reroute$/});
    const callback=await reroute.getAttribute('onclick')||'';
    const match=callback.match(/^showFlightInfo\(this,(\d+),(\d+),false,true\);closePop\(\);$/);
    if(await reroute.count()!==1||!await reroute.isVisible()||!await reroute.isEnabled()||
      !match||match[1]!==fresh.aircraftId)throw new Error('ROUTE_PLANNER_CONTROL_UNVERIFIED');
    await reroute.click({timeout});

    const suggest=this.page.locator('#flightInfoContainer #introSuggest');
    await suggest.waitFor({state:'visible',timeout});
    const suggestCallback=(await suggest.getAttribute('onclick')||'').replace(/\s/g,'');
    const expectedSuggest=`playSound('neutral_click');Ajax('add_airports.php?mode=suggest&id=${fresh.aircraftId}','runme',this,false,true);`;
    if(!suggestCallback.startsWith(expectedSuggest.replace(/\s/g,'')))throw new Error('ROUTE_PLANNER_CONTEXT_UNVERIFIED');

    const requestUrl=`new_route_info.php?id=${fresh.aircraftId}&airportId=${target.airportId}&ferry=0`;
    const responsePromise=this.page.waitForResponse(r=>{
      try{
        const u=new URL(r.url());
        return u.pathname.endsWith('/new_route_info.php')&&u.searchParams.get('id')===fresh.aircraftId&&
          u.searchParams.get('airportId')===target.airportId&&u.searchParams.get('ferry')==='0'&&!u.searchParams.has('mode');
      }catch{return false;}
    },{timeout});
    await this.page.evaluate(({url})=>{
      const trigger=document.querySelector('#introSuggest');
      const ajax=(window as any).Ajax;
      if(typeof ajax!=='function'||!trigger)throw new Error('ROUTE_AJAX_UNAVAILABLE');
      ajax(url,'newRouteInfo',trigger,false,true);
    },{url:requestUrl});
    const response=await responsePromise;
    if(!response.ok())throw new Error('ROUTE_QUOTE_REQUEST_FAILED');

    await this.page.locator('#newRouteInfo').waitFor({state:'visible',timeout});
    const read=await readOpenCandidateQuoteAfterVerifiedAjax(this.page,{
      aircraftId:fresh.aircraftId,registration:fresh.registration,airportId:target.airportId,from:target.from,to:target.to
    });
    if(read.status!=='observed')throw new Error('ROUTE_TARGET_QUOTE_UNAVAILABLE');
    const q=read.quote;
    const effectiveFares=q.autopriceReference?.effectiveFares;
    if(!effectiveFares)throw new Error('ROUTE_TARGET_QUOTE_UNAVAILABLE');
    const next:RouteExecutionCandidate={
      ...target,observedAt:q.observedAt,costIndex:q.costIndex,distanceKm:q.distanceKm,durationSeconds:q.durationSeconds,
      fuelLbs:q.fuelLbs,co2KgPerPaxKm:q.co2KgPerPaxKm,routeFee:q.routeFee,
      autoFares:{...effectiveFares},routeMutationControl:q.routeMutationControl||null
    };
    if(!sameTarget(target,next))throw new Error('ROUTE_TARGET_FINGERPRINT_CHANGED');

    const routeReg=this.page.locator('#newRouteInfo #routeReg');
    if(await routeReg.count()!==1||!await routeReg.isVisible()||!await routeReg.isEnabled())throw new Error('ROUTE_REGISTRATION_UNAVAILABLE');
    const routeRegistration=(await routeReg.inputValue()).trim();
    if(!routeRegistration||routeRegistration.length>100)throw new Error('ROUTE_REGISTRATION_INVALID');

    this.prepared={aircraft:fresh,target:next,routeRegistration};
    return {aircraft:fresh,target:next};
    } finally {
      // Playwright Test actionTimeout defaults to 0 (no limit). Restore the
      // original project behavior so only reroute preparation is aggressively bounded.
      this.page.setDefaultTimeout(0);
    }
  }

  async prepare(expected:AircraftSnapshot,target:RouteExecutionCandidate){
    return this.openTarget(expected,target);
  }

  async reroute(expected:AircraftSnapshot,target:RouteExecutionCandidate){
    const prepared=this.prepared;
    this.prepared=null; // Consume before the first mutation attempt.
    if(!prepared||!strictContext(prepared.aircraft,expected)||!sameTarget(prepared.target,target))
      throw new Error('ROUTE_PREPARED_CONTEXT_MISSING');

    const panel=this.page.locator('#newRouteInfo');
    if(await panel.count()!==1||!await panel.isVisible())throw new Error('ROUTE_TARGET_PANEL_CLOSED');
    const routeReg=panel.locator('#routeReg');
    if(await routeReg.count()!==1||!await routeReg.isVisible()||!await routeReg.isEnabled()||
      (await routeReg.inputValue()).trim()!==prepared.routeRegistration)throw new Error('ROUTE_REGISTRATION_CHANGED');

    const liveControl=await readRouteMutationControl(this.page,{
      aircraftId:target.aircraftId,registration:expected.registration,airportId:target.airportId,from:target.from,to:target.to
    });
    if(!liveControl.nativeClickReady||!liveControl.directRouteVerified||!target.routeMutationControl||
      liveControl.shape!==target.routeMutationControl.shape)throw new Error('ROUTE_CREATE_CONTROL_CHANGED');

    const auto=panel.locator('#introAuto');
    if(await auto.count()!==1||!await auto.isVisible()||!await auto.isEnabled())throw new Error('ROUTE_AUTOPRICE_CONTROL_UNAVAILABLE');

    // Native Auto only writes the three local fare fields. The previously
    // inspected function permits only its known telemetry endpoint.
    const requests:string[]=[];
    const listener=(req:Request)=>requests.push(req.url());
    this.page.on('request',listener);
    try{
      await auto.click({timeout:this.timeout});
      await this.page.waitForTimeout(150);
    }finally{
      this.page.off('request',listener);
    }
    const unexpected=requests.filter(raw=>{
      try{
        const u=new URL(raw);
        return u.pathname.endsWith('.php')&&!u.pathname.endsWith('/ddna_logger.php');
      }catch{return false;}
    });
    if(unexpected.length)throw new Error('ROUTE_AUTOPRICE_UNEXPECTED_NETWORK');

    const values={
      Y:await numericInput(this.page,'#eSeat'),
      J:await numericInput(this.page,'#bSeat'),
      F:await numericInput(this.page,'#fSeat')
    };
    if(!sameCabins(values,target.autoFares))throw new Error('ROUTE_AUTOPRICE_VALUE_CHANGED');

    const costText=(await panel.locator('#costIndexBar').innerText()).trim();
    if(!/^\d+$/.test(costText)||Number(costText)!==target.costIndex)throw new Error('ROUTE_COST_INDEX_CHANGED');
    const globalCost=await this.page.evaluate(()=>Number((window as any).endCostIndex));
    if(!Number.isFinite(globalCost)||globalCost!==target.costIndex)throw new Error('ROUTE_COST_INDEX_GLOBAL_CHANGED');

    const create=panel.locator('#btnCreateNewRoute');
    if(await create.count()!==1||!await create.isVisible()||!await create.isEnabled())throw new Error('ROUTE_CREATE_CONTROL_UNAVAILABLE');
    const expectedReg=prepared.routeRegistration;
    const responsePromise=this.page.waitForResponse(r=>{
      try{
        const u=new URL(r.url());
        return u.pathname.endsWith('/new_route_info.php')&&u.searchParams.get('mode')==='do'&&
          u.searchParams.get('id')===target.aircraftId&&u.searchParams.get('airportId')===target.airportId&&
          u.searchParams.get('reg')===expectedReg&&u.searchParams.get('e')===String(target.autoFares.Y)&&
          u.searchParams.get('b')===String(target.autoFares.J)&&u.searchParams.get('f')===String(target.autoFares.F)&&
          u.searchParams.get('endCostIndex')===String(target.costIndex)&&u.searchParams.get('stopoverId')==='0'&&
          u.searchParams.get('ferry')==='0'&&!u.searchParams.has('charter');
      }catch{return false;}
    },{timeout:this.timeout});

    const results=await Promise.allSettled([responsePromise,create.click({timeout:this.timeout})]);
    if(results[0].status!=='fulfilled'||results[1].status!=='fulfilled'||!results[0].value.ok())
      throw new Error('ROUTE_CREATE_REQUEST_UNCONFIRMED');
  }

  async confirm(expected:AircraftSnapshot,target:RouteExecutionCandidate){
    for(let attempt=0;attempt<3;attempt++){
      if(attempt)await this.page.waitForTimeout(attempt===1?1200:2200);
      try{
        await openFleetList(this.page,this.timeout);
        const result=await new DemandReader(this.page,this.timeout,true).collect();
        if(!result.complete)continue;
        const matches=result.aircraft.filter(a=>a.aircraftId===expected.aircraftId&&a.registration===expected.registration);
        if(matches.length!==1)continue;
        const after=matches[0];
        if(after.routeId!==expected.routeId&&after.from===target.from&&after.to===target.to)return after;
      }catch{
        // Read-only confirmation retry only. The route mutation is never repeated.
      }
    }
    return null;
  }
}
