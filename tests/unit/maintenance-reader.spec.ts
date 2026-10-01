import { test,expect,Page } from '@playwright/test';
import { readAircraftMaintenanceReferences } from '../../optimization/maintenance-reader';
import { CollectionResult } from '../../demand/types';
const collection:CollectionResult={complete:true,expectedRoutes:1,warnings:[],aircraft:[{aircraftId:'101',registration:'SYNTHETIC',
 routeId:'1',routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'ready',capacity:{Y:100,J:0,F:0},remaining:{Y:100,J:0,F:0},
 dailyTotal:{Y:200,J:0,F:0},observedAt:new Date().toISOString()}]};
async function fixture(page:Page,variant='') {
 await page.route('**/*',r=>r.abort());
 await page.setContent(`<div id="smallMainMenu"><div onclick="hideAllWhenClick();popup('maintenance_main.php','Maintenance',false,false,true);"><div><span>Maintenance</span></div></div></div><div id="rewardPopup"></div><div><h5 id="popTitle" style="display:none">Maintenance</h5><button onclick="closePop();document.getElementById('rewardPopup').style.display='none';">Close</button></div><button id="popBtn2" style="display:none"></button><div id="maintAction"></div><script>
 const variant=${JSON.stringify(variant)};window.queries=0;window.mutations=0;
 function closePop(){document.querySelector('#popTitle').style.display='none';document.querySelector('#maintAction').innerHTML='';}
 function hideAllWhenClick(){}function playSound(){}function $(s){return {removeClass(){},addClass(){},hide(){}}}
 function popup(){window.queries++;document.querySelector('#popTitle').style.display='block';const p=document.querySelector('#popBtn2');p.style.display='block';p.setAttribute('onclick',variant==='control'?'window.mutations++':"$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('maint_plan.php','maintAction',this,false,false);")}
 function Ajax(){window.queries++;if(variant==='loading')return;
 document.querySelector('#maintAction').innerHTML='<span id="baseOnly">'+(variant==='filter'?'At base only':'Showing all')+'</span><div class="maint-list-sort" data-reg="'+(variant==='identity'?'OTHER':'SYNTHETIC')+'" data-base="1" data-wear="5.50" data-hours="200"><div><span class="s-text">Flight hours</span><br><b>100</b><span class="badge">At base</span></div><div><span class="s-text">Hours to check</span><br><b>200</b><span class="s-text">Wear</span><br><b>5.50%</b></div><div id="controls101"><button onclick="window.mutations++">A-Check</button><button onclick="window.mutations++">Repair</button><button onclick="window.mutations++">Modify</button></div></div>';
 const row=document.querySelector('.maint-list-sort');if(variant==='hours')row.setAttribute('data-hours','201');if(variant==='wear')row.setAttribute('data-wear','6');
 if(variant==='duplicate')row.insertAdjacentHTML('afterend',row.outerHTML);if(variant==='id')row.querySelector('#controls101').id='controls102';if(variant==='base')row.setAttribute('data-base','0');
 if(variant==='hidden')row.style.display='none';
 }
 </script>`);
}
test('reads aircraft maintenance status independently from operational controls and closes the popup',async({page})=>{
 await fixture(page);const r=await readAircraftMaintenanceReferences(page,collection,300);
 expect(r).toMatchObject({status:'observed',complete:true,uiClosed:true,aircraft:[{aircraftId:'101',registration:'SYNTHETIC',flightHours:100,
  hoursToCheck:200,wearPercentage:5.5,atAnyBase:true,effectiveCheckPrice:null,effectiveRepairPrice:null}]});
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);expect(await page.locator('#popTitle').isVisible()).toBe(false);
});
for(const variant of ['control','loading','filter','identity','hours','wear','duplicate','id','base','hidden'])test(`maintenance source fails closed without invoking a service: ${variant}`,async({page})=>{
 await fixture(page,variant);const r=await readAircraftMaintenanceReferences(page,collection,100);
 expect(r).toMatchObject({status:'unavailable',complete:false,aircraft:[],uiClosed:true});
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('incomplete fleet blocks maintenance queries',async({page})=>{
 await fixture(page);expect((await readAircraftMaintenanceReferences(page,{...collection,complete:false},100)).complete).toBe(false);
 expect(await page.evaluate(()=>(window as any).queries)).toBe(0);
});
