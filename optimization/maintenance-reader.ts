import { Page } from '@playwright/test';
import { CollectionResult } from '../demand/types';
import { integerText } from '../demand/parsing';
import { closeReadOnlyPopup } from './cost-reference-reader';

export interface AircraftMaintenanceReference {
  aircraftId:string;registration:string;observedAt:string;
  flightHours:number;hoursToCheck:number;wearPercentage:number;atAnyBase:boolean;
  source:'inspected-maintenance-plan';effectiveCheckPrice:null;effectiveRepairPrice:null;
}
/** Reads the Plan TAB only. A-Check/Repair/Modify/Bulk controls are never clicked. */
export async function readAircraftMaintenanceReferences(page:Page,collection:CollectionResult,timeout=10000) {
  const report={status:'unavailable',observedAt:new Date().toISOString(),complete:false,uiClosed:false,
    aircraft:[] as AircraftMaintenanceReference[],warnings:[] as string[]};
  try {
    if (!Number.isSafeInteger(timeout)||timeout<1||timeout>30000 || !collection.complete ||
      collection.expectedRoutes!==collection.aircraft.length || !collection.aircraft.length ||
      new Set(collection.aircraft.map(a=>a.aircraftId)).size!==collection.aircraft.length) throw new Error();
    await closeReadOnlyPopup(page,timeout);
    const menu=page.locator('#smallMainMenu').getByText('Maintenance',{exact:true}).locator('../..');
    if(await menu.count()!==1||!await menu.isVisible()||(await menu.getAttribute('onclick')||'').replace(/\s/g,'')!==
      "hideAllWhenClick();popup('maintenance_main.php','Maintenance',false,false,true);") throw new Error();
    await menu.click({timeout});
    const plan=page.locator('#popBtn2');await plan.waitFor({state:'visible',timeout});
    if(await plan.count()!==1||(await plan.getAttribute('onclick')||'').replace(/\s/g,'')!==
      "$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('maint_plan.php','maintAction',this,false,false);") throw new Error();
    await plan.click({timeout});
    const rows=page.locator('#maintAction .maint-list-sort');await rows.first().waitFor({state:'visible',timeout});
    if((await page.locator('#maintAction #baseOnly').innerText()).trim()!=='Showing all') throw new Error();
    const raw=await rows.evaluateAll(elements=>elements.map(row=>{
      const visible=(e:Element)=>!!e.getClientRects().length;
      if(!visible(row))throw new Error();
      const value=(label:string)=>{
        const matches=Array.from(row.querySelectorAll('span.s-text')).filter(e=>e.textContent?.trim()===label&&visible(e));
        if(matches.length!==1)throw new Error();
        const next=matches[0].nextElementSibling?.nextElementSibling;
        if(!next?.matches('b')||!visible(next))throw new Error();
        return next.textContent?.trim()||'';
      };
      const controls=row.querySelectorAll('[id^="controls"]');if(controls.length!==1)throw new Error();
      const badges=Array.from(row.querySelectorAll('.badge')).filter(visible);if(badges.length!==1)throw new Error();
      return {controlsId:controls[0].id,registration:row.getAttribute('data-reg'),base:row.getAttribute('data-base'),
        wearAttribute:row.getAttribute('data-wear'),hoursAttribute:row.getAttribute('data-hours'),
        hours:value('Flight hours'),remaining:value('Hours to check'),wear:value('Wear'),baseLabel:badges[0].textContent?.trim()};
    }));
    const stamp=new Date().toISOString();
    const parsed=raw.map(r=>{
      const id=r.controlsId.match(/^controls([1-9]\d*)$/);const wear=r.wear.match(/^(\d+(?:\.\d+)?)%$/);
      const aircraft=collection.aircraft.find(a=>a.aircraftId===id?.[1]);
      if(!id||!wear||!aircraft||aircraft.registration!==r.registration||!['0','1'].includes(r.base||'')||
        r.baseLabel!==(r.base==='1'?'At base':'Not at base'))throw new Error();
      const flightHours=integerText(r.hours),hoursToCheck=integerText(r.remaining),wearPercentage=Number(wear[1]);
      if(hoursToCheck!==Number(r.hoursAttribute)||wearPercentage!==Number(r.wearAttribute)||wearPercentage<0||wearPercentage>100)throw new Error();
      return {aircraftId:id[1],registration:aircraft.registration,observedAt:stamp,flightHours,hoursToCheck,wearPercentage,
        atAnyBase:r.base==='1',source:'inspected-maintenance-plan' as const,effectiveCheckPrice:null,effectiveRepairPrice:null};
    });
    if(parsed.length!==collection.aircraft.length||new Set(parsed.map(a=>a.aircraftId)).size!==parsed.length)throw new Error();
    report.aircraft=parsed;report.observedAt=stamp;report.complete=true;report.status='observed';
  } catch {report.warnings.push('AIRCRAFT_MAINTENANCE_REFERENCE_UNAVAILABLE');}
  finally {try{await closeReadOnlyPopup(page,timeout);report.uiClosed=true;}catch{report.warnings.push('MAINTENANCE_CLOSE_UNVERIFIED');}}
  return report;
}
