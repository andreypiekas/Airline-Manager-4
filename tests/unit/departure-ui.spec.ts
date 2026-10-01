import { test,expect } from '@playwright/test';
import { IndividualDepartureExecutor } from '../../demand/executor';
import { PlaywrightDeparturePort } from '../../demand/departure-port';
import { readDemandConfig } from '../../demand/config';

async function ui(page:import('@playwright/test').Page,response='success'){
 let departures=0;
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname!=='synthetic.invalid')return route.abort();
  if(u.pathname.endsWith('/route_depart.php')){departures++;if(response==='failure')return route.fulfill({status:500,body:'error'});}
  await route.fulfill({status:200,contentType:'text/plain',body:'ok'});
 });
 await page.setContent(String.raw`<button id="popBtn1" onclick="$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('routes.php','routeAction',this,false,false);">Fleet</button>
 <div id="uiHints"></div><div id="routeAction"><div id="routesContainer"></div></div><div id="detailsAction" style="display:none"></div>
 <script>
 const intro=0;window.departed=false;function playSound(){}function hideFlightInfo(){}
 function $(selector){return {hide(){document.querySelectorAll(selector).forEach(e=>e.style.display='none')},removeClass(){},addClass(){}}}
 function render(){document.getElementById('detailsAction').style.display='none';document.getElementById('routeAction').style.display='block';
 const old=document.getElementById('routesContainer');const el=document.createElement('div');el.id='routesContainer';
 el.innerHTML='<button>Routes (1)</button><div class="row classPAX '+(window.departed?'':'listDepartable')+'" id="routeMainList10"><span class="s-text">AAA - GRU</span>'+
 '<a href="#" onclick="playSound(\'neutral_click\');Ajax(\'fleet_details.php?id=1\',\'detailsAction\');if(intro==0){$(\'#routeAction\').hide();}"><span id="acRegList1">TEST</span> - Test aircraft</a>'+
 (window.departed?'Onboard: 88 / 0 / 0':'<button id="listDepart10">Depart</button>')+'</div>';old.replaceWith(el);}
 function details(){const d=document.getElementById('detailsAction');d.style.display='block';document.getElementById('routeAction').style.display='none';
 d.innerHTML='<div id="route-name"><span class="glyphicons-chevron-left" onclick="document.getElementById(\'detailsAction\').style.display=\'none\';document.getElementById(\'routeAction\').style.display=\'block\'">Back</span></div><span id="ff-name">TEST</span>'+
 (window.departed?'<span id="timer">01:00:00</span><button onclick="/* fleet_details.php?id=1&mode=reg& */">Rename</button><button onclick="/* fleet_details.php?id=10&mode=routeReg& */">Route</button>':
 '<button id="routeViewDepart" onclick="$(\'#uiHints\').hide();hideFlightInfo();$(\'#routeViewDepart\').hide();Ajax(\'route_depart.php?id=10&ref=list&costIndex=0\',\'target\',this);">Depart</button><button id="routeViewGround_unground">Ground</button>')+
 '<div class="col-5"><span class="l-text">AAA</span></div><div class="col-5"><span class="l-text">GRU</span></div>'+
 '<div id="seat-layout">'+['economy','business','first'].map((c,i)=>'<div><img src="assets/'+c+'_seat.png">'+(i?0:100)+'</div>').join('')+'</div>'+
 '<div id="list-demand">'+['economy','business','first'].map((c,i)=>'<div><img src="assets/'+c+'_seat.png">'+(i?'0/100':'100/1000')+'</div>').join('')+'</div>';
 }
 async function Ajax(url){const r=await fetch('https://synthetic.invalid/'+url);await r.text();
 if(url==='routes.php')render();else if(url.startsWith('fleet_details.php'))details();else if(url.startsWith('route_depart.php')&&r.ok)window.departed=true;}
 render();
 </script>`);
 return ()=>departures;
}
test('complete Playwright path performs one intercepted departure and verifies fresh native inflight state',async({page})=>{
 const count=await ui(page);const states:string[]=[];
 const r=await new IndividualDepartureExecutor(new PlaywrightDeparturePort(page,1500),readDemandConfig({}),{dryRun:false,maxDepartures:1,aircraftOrigins:new Map(),airlineBases:['GRU']},async r=>{states.push(r.entries[0]?.status||'start');}).run();
 expect(count()).toBe(1);expect(r.summary.departed).toBe(1);expect(r.entries[0].actualOnboard?.Y).toBe(88);expect(states).toContain('attempting');
});
test('UI response failure stops after one intercepted request with unknown result',async({page})=>{
 const count=await ui(page,'failure');const r=await new IndividualDepartureExecutor(new PlaywrightDeparturePort(page,1500),readDemandConfig({}),{dryRun:false,maxDepartures:1,aircraftOrigins:new Map(),airlineBases:['GRU']},async()=>{}).run();
 expect(count()).toBe(1);expect(r.halted).toBe(true);expect(r.summary.unknown).toBe(1);
});
test('Playwright simulation traverses identical UI and never requests the departure endpoint',async({page})=>{
 const count=await ui(page);const r=await new IndividualDepartureExecutor(new PlaywrightDeparturePort(page,1500),readDemandConfig({}),{dryRun:true,maxDepartures:1,aircraftOrigins:new Map(),airlineBases:['GRU']},async()=>{}).run();expect(r.summary.simulated).toBe(1);expect(count()).toBe(0);
});
