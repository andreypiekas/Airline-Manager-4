import { Page } from '@playwright/test';
import { Cabin, CLASSES, AircraftSnapshot } from '../demand/types';
import { DemandReader } from '../demand/reader';
import { findFleetRoute, openFleetList } from '../demand/navigation';
import { inspectPricingSaveControl } from './control-evidence';
import type { PricingPort } from './executor';

const ids:Record<Cabin,string>={Y:'#eTicket',J:'#bTicket',F:'#fTicket'};

export class PlaywrightPricingPort implements PricingPort {
  private prepared:{aircraft:AircraftSnapshot;handler:string}|null=null;
  constructor(private readonly page:Page,private readonly timeout=15000){}

  async collect(){
    this.prepared=null;
    await openFleetList(this.page,this.timeout);
    return new DemandReader(this.page,this.timeout,true).collect();
  }

  async prepare(expected:AircraftSnapshot){
    this.prepared=null;
    await openFleetList(this.page,this.timeout);
    await findFleetRoute(this.page,expected,this.timeout);
    const fresh=await new DemandReader(this.page,this.timeout,true).readReadyAircraftDetails(expected);
    const details=this.page.locator('#detailsAction');
    const save=details.getByRole('button',{name:'Save',exact:true});
    if(await save.count()!==1||!await save.isVisible()||!await save.isEnabled())throw new Error('PRICING_SAVE_CONTROL_UNAVAILABLE');
    const handler=await save.getAttribute('onclick')||'';
    const evidence=inspectPricingSaveControl(handler,fresh.aircraftId,fresh.routeId);
    if(!evidence.endpointVerified||evidence.target!=='route'||!evidence.targetMatchesContext)throw new Error('PRICING_SAVE_CONTROL_UNVERIFIED');
    for(const k of CLASSES)if(await details.locator(ids[k]).count()!==1)throw new Error('PRICING_INPUTS_UNVERIFIED');
    this.prepared={aircraft:fresh,handler};
    return fresh;
  }

  async save(expected:AircraftSnapshot,desired:Record<Cabin,number>){
    const prepared=this.prepared;this.prepared=null; // Consume before any mutation attempt.
    if(!prepared||prepared.aircraft.aircraftId!==expected.aircraftId||prepared.aircraft.routeId!==expected.routeId||
      prepared.aircraft.registration!==expected.registration||prepared.aircraft.observedAt!==expected.observedAt||
      Date.now()-Date.parse(expected.observedAt)>20000)throw new Error('PRICING_CONTEXT_EXPIRED');

    const details=this.page.locator('#detailsAction');
    if((await details.locator('#ff-name').innerText()).trim()!==expected.registration)throw new Error('PRICING_IDENTITY_CHANGED');
    const save=details.getByRole('button',{name:'Save',exact:true});
    if(await save.count()!==1||!await save.isVisible()||!await save.isEnabled()||
      await save.getAttribute('onclick')!==prepared.handler)throw new Error('PRICING_CONTROL_CHANGED');
    const evidence=inspectPricingSaveControl(prepared.handler,expected.aircraftId,expected.routeId);
    if(!evidence.endpointVerified||evidence.target!=='route'||!evidence.targetMatchesContext)throw new Error('PRICING_CONTROL_CHANGED');

    for(const k of CLASSES){
      if(!Number.isSafeInteger(desired[k])||desired[k]<=0)throw new Error('PRICING_VALUE_INVALID');
      const input=details.locator(ids[k]);
      if(await input.count()!==1||!await input.isVisible()||!await input.isEnabled())throw new Error('PRICING_INPUT_CHANGED');
      await input.fill(String(desired[k]));
      if((await input.inputValue()).trim()!==String(desired[k]))throw new Error('PRICING_INPUT_NOT_CONFIRMED');
    }

    const response=this.page.waitForResponse(r=>{
      try{
        const u=new URL(r.url());
        return u.pathname.endsWith('/set_ticket_prices.php')&&
          u.searchParams.get('id')===expected.routeId&&
          u.searchParams.get('e')===String(desired.Y)&&
          u.searchParams.get('b')===String(desired.J)&&
          u.searchParams.get('f')===String(desired.F);
      }catch{return false;}
    },{timeout:this.timeout});
    const results=await Promise.allSettled([response,save.click({timeout:this.timeout})]);
    if(results[0].status!=='fulfilled'||results[1].status!=='fulfilled'||!results[0].value.ok())throw new Error('PRICING_REQUEST_UNCONFIRMED');
  }

  async confirm(expected:AircraftSnapshot,desired:Record<Cabin,number>){
    const result=await this.collect();
    if(!result.complete)return null;
    const matches=result.aircraft.filter(a=>a.aircraftId===expected.aircraftId&&a.routeId===expected.routeId);
    if(matches.length!==1)return null;
    const current=matches[0].fares?.current;
    return current&&CLASSES.every(k=>current[k]===desired[k])?matches[0]:null;
  }
}
