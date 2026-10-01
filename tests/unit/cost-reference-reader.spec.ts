import { test,expect,Page } from '@playwright/test';
import { readMarketPriceReferences,readModelCostReference,readModelCostReferenceResult } from '../../optimization/cost-reference-reader';
import { collectCandidateData } from '../../optimization/research-reader';
const catalogTab="$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('ac_orders.php?first=true','routeAction',this,false,true);";
const fleetTab="$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('routes.php','routeAction',this,false,false);";
const catalog="if(intro==0) { $('#modelSelection').html('ATR 72-500');playSound('neutral_click');$('#acListDetail').slideUp('slow');Ajax('ac_orders.php?mode=detail&id=22&charter=0','acModel',false,false,false);$('#acModel').html('<div class=text-center><img src=assets/img/loaders/flight_info_loader.gif></div>').show();}";
async function fixture(page:Page,variant=''){
 await page.route('**/*',r=>r.abort());
 await page.setContent(`<style>#fuelMain span{display:block}#viewOverlay{position:fixed;inset:0;background:white;z-index:10}</style><div id="viewOverlay"></div><div style="position:relative;z-index:20"><h5 id="popTitle">Routes</h5><button id="closeView" onclick="closePop();document.getElementById('rewardPopup').style.display='none';">Close</button></div><div id="rewardPopup"></div><div id="smallMainMenu"><div onclick="hideAllWhenClick();popup('fuel.php','Fuel',false,false,true);"><div><span>Fuel</span></div></div><div onclick="hideAllWhenClick();popup('maintenance_main.php','Maintenance',false,false,true);"><div><span>Maintenance</span></div></div></div><button id="mapRoutes" onclick="hideAllWhenClick();menuFleet('Routes');">Fleet menu</button><button id="popBtn1"></button><button id="popBtn2"></button><div id="detailsAction"></div><div id="routeAction"></div><div id="fuelMain" style="display:none"></div><div id="maintAction" style="display:none"></div><script>
 const variant=${JSON.stringify(variant)};window.mutations=0;window.queries=0;const intro=0;
 function playSound(){}function hideAllWhenClick(){} function closePop(){document.querySelector('#popTitle').style.display='none';document.querySelector('#viewOverlay').style.display='none';document.querySelector('#fuelMain').style.display='none';document.querySelector('#maintAction').style.display='none';document.querySelector('#popBtn1').style.display='none';document.querySelector('#popBtn2').style.display='none'}
 function $(s){return {html(v){document.querySelector(s).innerHTML=v;return this},show(){return this},slideUp(){return this},hide(){},removeClass(){},addClass(){}}}
 function fleet(){document.querySelector('#popTitle').style.display='block';document.querySelector('#viewOverlay').style.display='none';document.querySelector('#popBtn1').style.display='block';document.querySelector('#popBtn2').style.display='block';document.querySelector('#popBtn1').setAttribute('onclick',${JSON.stringify(fleetTab)});document.querySelector('#popBtn2').setAttribute('onclick',${JSON.stringify(catalogTab)});document.querySelector('#routeAction').innerHTML='<div id="routesContainer"><div id="routeMainList1">SYNTHETIC</div></div>'}
 function menuFleet(){if(document.querySelector('#fuelMain').style.display!=='none'){document.querySelector('#fuelMain').style.display='none';return}fleet()}
 function popup(url){if(url==='maintenance_main.php'){document.querySelector('#popTitle').style.display='block';document.querySelector('#popBtn2').style.display='block';document.querySelector('#popBtn2').setAttribute('onclick',"$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('maint_plan.php','maintAction',this,false,false);");return}document.querySelector('#popTitle').style.display='block';document.querySelector('#popBtn2').style.display='block';fuel(false)}
 function fuel(co2){document.querySelector('#fuelMain').style.display='block';document.querySelector('#fuelMain').innerHTML='<div><span>'+ (co2?'Quota cost':'Current price')+'</span><b>$ '+(co2?'133':'1,280')+'</b></div><div>'+(variant==='units'?'Unverified unit':co2?'Co2 quota cost per 1,000':'Fuel price per 1,000 Lbs')+'</div><button onclick="window.mutations++">Purchase</button><input placeholder="Amount to purchase">';document.querySelector('#popBtn2').setAttribute('onclick',"$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('co2.php','fuelMain',this,false,false);")}
 function Ajax(url){window.queries++;if(url==='maint_plan.php'){const m=document.querySelector('#maintAction');m.style.display='block';m.innerHTML='<span id="baseOnly">Showing all</span><div class="maint-list-sort" data-reg="synthetic" data-base="1" data-wear="2" data-hours="100"><div class="col-sm-4">SYNTHETIC<br><span>Pax</span></div><span class="s-text">Flight hours</span><br><b>300</b><span class="badge">At base</span><span class="s-text">Hours to check</span><br><b>100</b><span class="s-text">Wear</span><br><b>2%</b><div id="controls101"><button onclick="window.mutations++">Repair</button></div></div>';return}if(url==='routes.php'){fleet();return}if(url==='co2.php'){fuel(true);return}if(url.includes('first=true')){document.querySelector('#routeAction').innerHTML='<div id="acListItems"><div id="listSection42"><b>ATR 72-500</b></div></div><div id="modelSelection"></div><div id="acListDetail"></div><div id="acModel"></div>';document.querySelector('#listSection42').setAttribute('onclick',variant==='control'?'window.mutations++':${JSON.stringify(catalog)});return}
 if(url.includes('mode=detail'))setTimeout(()=>{document.querySelector('#acModel').innerHTML='<table><tr><td>A-Check</td><td>$ '+(variant==='values'?'0':'20,125')+'</td></tr><tr><td>Maint check</td><td>480 Hours</td></tr></table><button onclick="window.mutations++">Order</button><button onclick="window.mutations++">Configuration</button>';if(variant==='identity')document.querySelector('#modelSelection').textContent='DC-9-10'},10)}
 fleet();if(variant==='overlay')document.querySelector('#viewOverlay').style.display='block';</script>`);
}
test('reads catalog maintenance reference and never applies an order or configuration',async({page})=>{
 await fixture(page);expect(await readModelCostReference(page,22,500)).toMatchObject({modelId:22,modelName:'ATR 72-500',aCheckPrice:20125,checkIntervalHours:480,effectiveAircraftMaintenanceCost:null});expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
for(const variant of ['control','values','identity'])test(`unverified catalog source remains unavailable: ${variant}`,async({page})=>{
 await fixture(page,variant);expect(await readModelCostReference(page,22,500)).toBeNull();expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('queries both markets, confirms units and closes the market without touching purchase forms',async({page})=>{
 await fixture(page,'overlay');expect(await readMarketPriceReferences(page,500)).toMatchObject({fuel:{pricePer1000:1280,unit:'lbs',inventoryAcquisitionPrice:null},co2:{pricePer1000:133,unit:'quotas'},uiClosed:true});expect(await page.locator('input').inputValue()).toBe('');expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('unknown units prevent interpreting a market price',async({page})=>{
 await fixture(page,'units');expect(await readMarketPriceReferences(page,100)).toMatchObject({fuel:null,co2:null,uiClosed:true});expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('full evidence pipeline restores Fleet and leaves missing costs and net profit unavailable',async({page})=>{
 await fixture(page);const stamp=new Date().toISOString();
 const research:any={config:{enabled:true,timeout:500},uiRestored:true,aircraft:[{result:{quotes:[{aircraftId:'101',from:'GRU',to:'XAP',observedAt:stamp,autopriceReference:{modelId:22},fuelLbs:1000,routeFee:10000}]}}]};
 const r=await collectCandidateData(page,{complete:true,expectedRoutes:0,warnings:[],aircraft:[]},research);
 expect(r).toMatchObject({uiRestored:true,models:[{aCheckPrice:20125}],candidates:[{demand:{remaining:null},costs:{fuelAtObservedMarketPrice:1280,co2:null,maintenance:null,airportAndOther:null},netProfit:null,comparisonReady:false}]});
 expect(await page.locator('#routesContainer').isVisible()).toBe(true);expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('unknown popup close callback blocks market navigation before any click',async({page})=>{
 await fixture(page,'overlay');await page.locator('#closeView').evaluate(e=>e.setAttribute('onclick','window.mutations++'));
 const r=await readMarketPriceReferences(page,100);expect(r).toMatchObject({fuel:null,co2:null,stage:'popup_close'});
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);expect(await page.evaluate(()=>(window as any).queries)).toBe(0);
});


test('validates markets and individual maintenance even without eligible route suggestions',async({page})=>{
 await fixture(page);const stamp=new Date().toISOString();
 const data:any={complete:true,expectedRoutes:1,warnings:[],aircraft:[{aircraftId:'101',registration:'SYNTHETIC',observedAt:stamp}]};
 const research:any={config:{enabled:true,timeout:500},uiRestored:true,aircraft:[]};
 const r=await collectCandidateData(page,data,research);
 expect(r).toMatchObject({uiRestored:true,candidates:[],models:[],market:{fuel:{pricePer1000:1280},co2:{pricePer1000:133}},
  maintenance:{status:'observed',complete:true,aircraft:[{aircraftId:'101',hoursToCheck:100,wearPercentage:2}]}});
 expect(await page.locator('#routesContainer').isVisible()).toBe(true);expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});


test('a model absent from the inspected catalog is reported as a cost gap without guessing another source',async({page})=>{
 await fixture(page);expect(await readModelCostReferenceResult(page,999,500)).toEqual({modelId:999,status:'not_in_inspected_catalog',reference:null});
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('broken catalog callbacks cannot masquerade as an intentionally absent model',async({page})=>{
 await fixture(page,'control');expect(await readModelCostReferenceResult(page,999,500)).toEqual({modelId:999,status:'unavailable',reference:null});
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
