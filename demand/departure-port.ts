import { Page } from '@playwright/test';
import { DeparturePort } from './executor';
import { AircraftSnapshot } from './types';
import { DemandReader } from './reader';
import { openFleetList,findFleetRoute } from './navigation';

/** Complete handler grammar observed in Actions 36917592989/36918147380 on 2026-10-01.
 * Only the native UI is clicked. No manual endpoint calls, parameters or cost-index edits.
 * Constant UI hide selectors/response target are syntactically constrained, not used as our selectors.
 */
export function verifiedDepartureHandler(callback:string,routeId:string):boolean {
  if(!/^[1-9]\d*$/.test(routeId))return false;
  const match=callback.trim().match(/^\$\('([^']+)'\)\.hide\(\);\s*hideFlightInfo\(\);\s*\$\('#routeViewDepart'\)\.hide\(\);\s*Ajax\('route_depart\.php\?id=([1-9]\d*)&ref=list&costIndex=(\d{1,3})','([A-Za-z_][A-Za-z0-9_-]{0,60})',this\);$/);
  return !!match && /^[#.A-Za-z0-9_\s,>-]+$/.test(match[1]) && match[2]===routeId && Number(match[3])<=200;
}
export class PlaywrightDeparturePort implements DeparturePort {
  private prepared:{aircraft:AircraftSnapshot;handler:string}|null=null;
  constructor(private readonly page:Page,private readonly timeout=15000){}
  async collect(){this.prepared=null;await openFleetList(this.page,this.timeout);return new DemandReader(this.page,this.timeout,true).collect();}
  async prepare(expected:AircraftSnapshot){
    this.prepared=null;
    await openFleetList(this.page,this.timeout);await findFleetRoute(this.page,expected,this.timeout);
    const fresh=await new DemandReader(this.page,this.timeout,true).readReadyAircraftDetails(expected);
    const control=this.page.locator('#detailsAction #routeViewDepart');
    const handler=await control.getAttribute('onclick')||'';
    if(await control.count()!==1||!await control.isVisible()||!await control.isEnabled()||!verifiedDepartureHandler(handler,fresh.routeId))throw Error('DEPARTURE_HANDLER_UNVERIFIED');
    this.prepared={aircraft:fresh,handler};return fresh;
  }
  async depart(expected:AircraftSnapshot){
    const prepared=this.prepared;this.prepared=null; // Consume before any operation, including failures.
    if(!prepared||prepared.aircraft.aircraftId!==expected.aircraftId||prepared.aircraft.routeId!==expected.routeId||
      prepared.aircraft.observedAt!==expected.observedAt||Date.now()-Date.parse(expected.observedAt)>20000)throw Error('DEPARTURE_CONTEXT_EXPIRED');
    const details=this.page.locator('#detailsAction'),control=details.locator('#routeViewDepart');
    if(await details.locator('#ff-name').innerText()!==expected.registration||await control.count()!==1||
      !await control.isVisible()||!await control.isEnabled()||await control.getAttribute('onclick')!==prepared.handler||
      !verifiedDepartureHandler(prepared.handler,expected.routeId))throw Error('DEPARTURE_CONTEXT_CHANGED');
    const response=this.page.waitForResponse(r=>{
      try{const u=new URL(r.url());return u.pathname.endsWith('/route_depart.php')&&u.searchParams.get('id')===expected.routeId;}catch{return false;}
    },{timeout:this.timeout});
    const results=await Promise.allSettled([response,control.click({timeout:this.timeout})]);
    if(results[0].status!=='fulfilled'||results[1].status!=='fulfilled'||!results[0].value.ok())throw Error('DEPARTURE_REQUEST_UNCONFIRMED');
  }
  async confirm(expected:AircraftSnapshot){
    // Never retry the departure click. We may, however, re-read the Fleet a few
    // times because the native request can succeed before the list/countdown has
    // finished propagating through the UI.
    let last:AircraftSnapshot|null=null;
    for(let attempt=0;attempt<3;attempt++){
      if(attempt>0)await this.page.waitForTimeout(attempt===1?1200:2200);
      try{
        const result=await this.collect();
        if(!result.complete)continue;
        const matches=result.aircraft.filter(a=>a.aircraftId===expected.aircraftId&&a.routeId===expected.routeId);
        if(matches.length!==1)continue;
        last=matches[0];
        if(last.state==='inflight')return last;
      }catch{
        // Safe read retry only; no mutation is repeated.
      }
    }
    return last;
  }
}
