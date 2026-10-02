import { expect, Page } from '@playwright/test';
import { integerText } from '../demand/parsing';

export interface ModelCostReference {
  modelId:number;modelName:string;observedAt:string;aCheckPrice:number;checkIntervalHours:number;
  catalogFields?:Array<{label:string;value:string}>;
  acquisitionCost?:number;
  communityCrossCheck?:{
    verified:boolean;fieldsMatched:string[];fieldsConflicted:string[];reason:string;acquisitionCost:number|null;
  };
  source:'inspected-catalog'|'community-reference';effectiveAircraftMaintenanceCost:null;
}
export interface MarketPriceReference {
  commodity:'fuel'|'co2';pricePer1000:number;unit:'lbs'|'quotas';observedAt:string;
  source:'inspected-market';inventoryAcquisitionPrice:null;
}
const normalize=(s:string)=>s.replace(/\s/g,'');
async function checkedClick(page:Page,selector:string,callback:string,timeout:number){
  const c=page.locator(selector);
  if(await c.count()!==1||!await c.isVisible()||normalize(await c.getAttribute('onclick')||'')!==normalize(callback))throw new Error('REFERENCE_CONTROL_UNVERIFIED');
  await c.click({timeout});
}
export async function closeReadOnlyPopup(page:Page,timeout:number){
  const title=page.locator('#popTitle');
  if(!await title.isVisible())return;
  const close=title.locator('..').locator('[onclick]');
  if(await close.count()!==1||!await close.isVisible()||
    normalize(await close.getAttribute('onclick')||'')!=="closePop();document.getElementById('rewardPopup').style.display='none';")throw new Error('REFERENCE_CLOSE_UNVERIFIED');
  await close.click({timeout});await expect(title).not.toBeVisible({timeout});
}
export function verifiedCatalogControl(callback:string,modelId:number,modelName:string){
  if(!Number.isSafeInteger(modelId)||modelId<1||!modelName||!/^[A-Za-z0-9 .()/-]+$/.test(modelName))return false;
  const expected=`if(intro==0) { $('#modelSelection').html('${modelName}');playSound('neutral_click');$('#acListDetail').slideUp('slow');Ajax('ac_orders.php?mode=detail&id=${modelId}&charter=0','acModel',false,false,false);$('#acModel').html('<div class=text-center><img src=assets/img/loaders/flight_info_loader.gif></div>').show();}`;
  return normalize(callback)===normalize(expected);
}
/** Start on the Fleet popup. Opens catalog DETAILS only; never Order/Configuration. */
export type ModelCostReadResult = {modelId:number;status:'observed';reference:ModelCostReference} |
  {modelId:number;status:'not_in_inspected_catalog'|'unavailable';reference:null};
export async function readModelCostReferenceResult(page:Page,modelId:number,timeout=10000):Promise<ModelCostReadResult>{
  try {
    if(!Number.isSafeInteger(modelId)||modelId<1)throw new Error();
    await checkedClick(page,'#popBtn2',"$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('ac_orders.php?first=true','routeAction',this,false,true);",timeout);
    await page.locator('#acListItems [id^="listSection"]').first().waitFor({state:'visible',timeout});
    const rows=await page.locator('#acListItems [id^="listSection"]').evaluateAll(elements=>elements.map(e=>({id:e.id,name:e.querySelector('b')?.textContent?.trim()||'',callback:e.getAttribute('onclick')||''})));
    const listedIds=rows.map(r=>r.callback.match(/Ajax\('ac_orders\.php\?mode=detail&id=([1-9]\d*)&charter=0'/)?.[1]);
    if(!rows.length||listedIds.some(id=>!id))throw new Error();
    // Absence from this inspected list is an explicit data gap, not proof that a model does not exist.
    if(!listedIds.includes(String(modelId)))return {modelId,status:'not_in_inspected_catalog',reference:null};
    const matches=rows.filter(r=>verifiedCatalogControl(r.callback,modelId,r.name));
    if(matches.length!==1||!/^listSection\d+$/.test(matches[0].id))throw new Error();
    const selected=matches[0];const control=page.locator('#'+selected.id);
    if(await control.getAttribute('onclick')!==selected.callback)throw new Error();
    await control.click({timeout});
    const label=page.locator('#acModel').getByText('A-Check',{exact:true});
    await label.waitFor({state:'visible',timeout});
    if((await page.locator('#modelSelection').innerText()).trim()!==selected.name)throw new Error();
    const value=async(name:string)=>{
      const l=page.locator('#acModel').getByText(name,{exact:true});
      if(await l.count()!==1||!await l.isVisible())throw new Error();
      const cells=await l.locator('..').locator('td').allTextContents();
      if(cells.length!==2||cells[0].trim()!==name)throw new Error();return cells[1].trim();
    };
    const price=(await value('A-Check')).match(/^\$\s*([\d,]+)$/),hours=(await value('Maint check')).match(/^([\d,]+) Hours$/);
    if(!price||!hours)throw new Error();
    const catalogFields=await page.locator('#acModel table tr').evaluateAll(rows=>rows.flatMap(row=>{
      const cells=Array.from(row.querySelectorAll('td')).filter(e=>e.getClientRects().length).map(e=>(e.textContent||'').replace(/\s+/g,' ').trim());
      if(cells.length!==2||!cells[0]||!cells[1])return [];
      return [{label:cells[0].slice(0,80),value:cells[1].slice(0,120)}];
    }).slice(0,40));
    const aCheckPrice=integerText(price[1]),checkIntervalHours=integerText(hours[1]);
    if(aCheckPrice<=0||checkIntervalHours<=0)throw new Error();
    return {modelId,status:'observed',reference:{modelId,modelName:selected.name,observedAt:new Date().toISOString(),aCheckPrice,checkIntervalHours,catalogFields,source:'inspected-catalog',effectiveAircraftMaintenanceCost:null}};
  }catch{return {modelId,status:'unavailable',reference:null};}
}
export async function readModelCostReference(page:Page,modelId:number,timeout=10000):Promise<ModelCostReference|null>{
  return (await readModelCostReferenceResult(page,modelId,timeout)).reference;
}
/** Menu and tabs are queries only. No purchase input is read/filled or Purchase clicked. */
export async function readMarketPriceReferences(page:Page,timeout=10000){
  const result={fuel:null as MarketPriceReference|null,co2:null as MarketPriceReference|null,uiClosed:false,
    stage:'menu',warnings:[] as string[],unitLabels:[] as string[]};
  const menu=page.locator('#smallMainMenu').getByText('Fuel',{exact:true}).locator('../..');
  try {
    // An open Fleet popup intercepts menu clicks. Use the observed close-only
    // control first, rather than forcing a click through its overlay.
    result.stage='popup_close';
    await closeReadOnlyPopup(page,timeout);
    result.stage='menu';
    if(await menu.count()!==1||!await menu.isVisible()||normalize(await menu.getAttribute('onclick')||'')!=="hideAllWhenClick();popup('fuel.php','Fuel',false,false,true);")throw new Error();
    await menu.click({timeout});
    const read=async(commodity:'fuel'|'co2')=>{
      const panel=page.locator('#fuelMain');const name=commodity==='fuel'?'Current price':'Quota cost';
      result.stage=commodity+'_label';
      const label=panel.getByText(name,{exact:true});await label.waitFor({state:'visible',timeout});
      if(await label.count()!==1)throw new Error();
      result.stage=commodity+'_unit';
      const unitLabel=commodity==='fuel'?'Fuel price per 1,000 Lbs':'Co2 quota cost per 1,000';
      await panel.getByText(unitLabel,{exact:true}).waitFor({state:'visible',timeout});
      result.stage=commodity+'_price';
      const text=await label.locator('..').innerText();
      const match=text.trim().match(commodity==='fuel'?/^CURRENT PRICE\s+\$\s*([\d,]+)$/i:/^QUOTA COST\s+\$\s*([\d,]+)$/i);
      if(!match)throw new Error();const price=integerText(match[1]);if(price<=0)throw new Error();
      return {commodity,pricePer1000:price,unit:commodity==='fuel'?'lbs':'quotas',observedAt:new Date().toISOString(),source:'inspected-market',inventoryAcquisitionPrice:null} as MarketPriceReference;
    };
    result.fuel=await read('fuel');
    result.stage='co2_control';
    await checkedClick(page,'#popBtn2',"$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('co2.php','fuelMain',this,false,false);",timeout);
    result.co2=await read('co2');
    result.stage='observed';
  }catch{
    result.warnings.push('MARKET_REFERENCE_UNAVAILABLE:'+result.stage);
    // Only chart labels, never page HTML, form values, headers or session data.
    result.unitLabels=(await page.locator('#fuelMain svg text').allTextContents().catch(()=>[]))
      .filter(s=>/^(?:Fuel price per |Co2 quota cost per |Cost per )/.test(s.trim())).map(s=>s.trim().slice(0,80));
  }
  finally {
    try {
      if(await page.locator('#fuelMain').isVisible()){
        await closeReadOnlyPopup(page,timeout);
        await expect(page.locator('#fuelMain')).not.toBeVisible({timeout});
      }
      result.uiClosed=true;
    }catch{result.uiClosed=false;}
  }
  return result;
}
