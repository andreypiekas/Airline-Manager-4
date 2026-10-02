import { writeFile } from 'node:fs/promises';
import { test, expect, Page } from '@playwright/test';
import { AircraftSnapshot, CollectionResult } from '../../demand/types';
import { optimizationConfig } from '../../optimization/report';
import { researchConfig, researchFleetCandidates, writeRouteResearchReport } from '../../optimization/research-reader';

function snapshot(): AircraftSnapshot {
  return {aircraftId:'101',registration:'SYNTHETIC',routeId:'1',routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'ready',
    capacity:{Y:100,J:0,F:0},remaining:{Y:1000,J:100,F:100},dailyTotal:{Y:1000,J:100,F:100},observedAt:new Date().toISOString(),
    operational:{rangeKm:3440,minRunwayFt:7550,flightHours:682,cycles:206,homeBase:null,flightId:null}};
}
const settings = optimizationConfig({AIRLINE_BASES_JSON:'["AAA"]'});
const config = {...researchConfig({ENABLE_ROUTE_RESEARCH:'true'}),timeout:300};
function collection(a = snapshot()): CollectionResult {return {aircraft:[a],complete:true,expectedRoutes:1,warnings:[]};}

async function fixture(page:Page, options: Record<string,boolean> = {}) {
  await page.route('**/*',r=>r.abort());
  await page.setContent(`<div id="mapRoutes" onclick="hideAllWhenClick();menuFleet('Routes');">Fleet</div><div id="routeAction"><div id="routesContainer"></div></div><div id="detailsAction" style="display:none"></div><div id="flightInfoContainer" style="display:none"></div><div id="newRouteInfo" style="display:none"></div><script>
  const options=${JSON.stringify(options)}; const intro=0;window.mutations=0;window.researches=0;window.resets=0;
  function playSound(){} function closePop(){document.querySelector('#routeAction').style.display='none';document.querySelector('#detailsAction').style.display='none'}
  function hideAllWhenClick(){}
  function $(s){return {hide(){document.querySelector(s).style.display='none'},removeClass(){},addClass(){}}}
  function menuFleet(){if(options.toggle&&document.querySelector('#routeAction').style.display!=='none'){closePop();return}resetList()}
  function resetList(){window.resets++;if(options.restoreFailure&&window.resets>1)return;document.querySelector('#routeAction').innerHTML='<div id="routesContainer"></div>';document.querySelector('#routeAction').style.display='block';document.querySelector('#detailsAction').style.display='none';document.querySelector('#flightInfoContainer').style.display='none';document.querySelector('#newRouteInfo').style.display='none';render(0)}
  function render(index){document.querySelector('#routesContainer').innerHTML=index===0&&options.secondPage?\`<div id="routeMainList2">Other</div><ul class="pagination"><a href="#" onclick="Ajax('routes.php?start=20&sort=','routeAction',this);">Next</a></ul>\`:\`<div class="classPAX listDepartable" id="routeMainList1"><a href="#" onclick="playSound('neutral_click');Ajax('fleet_details.php?id=101','detailsAction');if(intro==0) {$('#routeAction').hide();}"><span id="acRegList101">SYNTHETIC</span> - Test aircraft</a><button id="listDepart1" onclick="window.mutations++">Depart</button></div>\`;
  if(options.badPagination&&index===0&&options.secondPage)document.querySelector('.pagination a').setAttribute('onclick','window.mutations++');
  if(options.badDetails&&!options.secondPage)document.querySelector('#routeMainList1 a').setAttribute('onclick','window.mutations++');}
  function Ajax(url){if(url==='routes.php'){resetList();return}if(url.startsWith('routes.php')){if(!options.loop)render(1);return}if(url.startsWith('fleet_details.php')){details();return}
  if(url.startsWith('add_airports.php')){document.querySelector('#flightInfoContainer').insertAdjacentHTML('beforeend',\`<button id="introSuggestm" onclick="playSound('neutral_click');Ajax('new_route_info.php?id=101&airportId=200&ferry=0','newRouteInfo',this,false,true);">Next</button>\`);return}
  if(url.startsWith('new_route_info.php'))quote();}
  function details(){const d=document.querySelector('#detailsAction');d.style.display='block';d.innerHTML=\`<span id="ff-name">SYNTHETIC</span><button id="routeViewDepart" onclick="window.mutations++;/* route_depart.php?id=1&ref=list */">Depart</button><button id="routeViewGround_unground" onclick="window.mutations++">Ground</button><div class="col-5"><span class="l-text">AAA</span></div><div class="col-5"><span class="l-text">BBB</span></div><div id="seat-layout">\`+['economy','business','first'].map((c,i)=>'<div><img src="assets/'+c+'_seat.png">'+(i?0:100)+'</div>').join('')+\`</div><div id="list-demand">\`+['economy','business','first'].map((c,i)=>'<div><img src="assets/'+c+'_seat.png">'+(i?'100/100':'1000/1000')+'</div>').join('')+\`</div><span class="s-text">Range</span><br><span class="m-text">3,440km</span><br><span class="s-text">Min runway</span><br><span class="m-text">7,550ft</span><br><span class="s-text">Flight hours/Cycles</span><br><span class="m-text">682 / 206</span><button id="reroute" onclick="showFlightInfo(this,101,8,false,true);closePop();">Reroute</button>\`;
  if(options.contextChanged)d.querySelector('.l-text').textContent='BBB';if(options.badPlanner)d.querySelector('#reroute').setAttribute('onclick','window.mutations++');}
  function showFlightInfo(){window.researches++;const p=document.querySelector('#flightInfoContainer');p.style.display='block';p.innerHTML=\`<button id="introSuggest" onclick="playSound('neutral_click');Ajax('add_airports.php?mode=suggest&id=101','runme',this,false,true);">Suggest route</button>\`;if(options.loadFailure)p.innerHTML='Loading';}
  function quote(){const q=document.querySelector('#newRouteInfo');q.style.display='block';q.innerHTML=\`<div class="blue-bg">SYNTHETIC<div>Close</div></div><div class="col-3 m-text"><b>AAA</b></div><div class="col-2"><span class="s-text">1000</span></div><div class="col-3 m-text"><b>CCC</b></div><table><tr><td>Daily pax demand</td></tr><tr>\`+['economy','business','first'].map(c=>'<td><img src="assets/'+c+'_seat.png"></td>').join('')+\`</tr><tr><td>1000</td><td>100</td><td>100</td></tr></table><div>A/C on route</div><div>0</div><span id="departFlightTimeInfo">02:00:00</span><span id="departFuelInfo">1000</span><span id="departCo2Info">0.14</span><span id="costIndexBar">200</span><div><b>Route fee</b></div><div>$1000</div><button id="introAuto" onclick="window.mutations++">Autoprice</button><button id="btnCreateNewRoute" onclick="window.mutations++">Create route</button><button id="back">Back</button>\`;q.querySelector('#back').setAttribute('onclick',"$('#newRouteInfo').hide('fast');playSound('neutral_click');");}
  render(0);
  if(options.toggle){const button=document.createElement('button');button.id='popBtn1';button.textContent='Fleet';button.setAttribute('onclick',"$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('routes.php','routeAction',this,false,false);");document.querySelector('#routeAction').prepend(button);}
  </script>`);
}

test('queries eligible aircraft, including second page, and restores a fresh list without mutations',async({page},testInfo)=>{
  await fixture(page,{secondPage:true});
  const report=await researchFleetCandidates(page,collection(),settings,{...config,maxSuggestions:1});
  expect(report).toMatchObject({uiRestored:true,candidatesComplete:false,comparisonReady:false,mutationAuthorized:false});
  expect(report.aircraft[0]).toMatchObject({status:'observed',result:{quotes:[{from:'AAA',to:'CCC',remainingDemand:null,comparisonReady:false}]}});
  expect(await page.locator('#routeMainList2').isVisible()).toBe(true);
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
  await writeRouteResearchReport(report,testInfo.outputPath('research'));
  await writeFile(testInfo.outputPath('simulation-report.json'),JSON.stringify(report,null,2)+'\n');
});

for(const variant of ['disabled','inflight','incomplete','duplicate','stale'])test(`skips research without any navigation: ${variant}`,async({page})=>{
  await fixture(page);const a=snapshot();const data=collection(a);
  if(variant==='away'){a.from='BBB';a.to='AAA'}if(variant==='inflight')a.state='inflight';if(variant==='incomplete')data.complete=false;
  if(variant==='duplicate')data.aircraft.push({...a});if(variant==='stale')a.observedAt='2000-01-01T00:00:00Z';
  const r=await researchFleetCandidates(page,data,settings,{...config,enabled:variant!=='disabled'});
  expect(r.aircraft.every(a=>a.status!=='queued')).toBe(true);expect(await page.evaluate(()=>(window as any).resets)).toBe(0);
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('away-from-base aircraft may run only the passive diagnostic probe and never mutate',async({page})=>{
  await fixture(page);
  const a=snapshot();a.from='BBB';a.to='AAA';
  const r=await researchFleetCandidates(page,collection(a),settings,{...config,maxSuggestions:1});
  expect(r.aircraft[0].status).toBe('pending_base_return');
  expect(r.diagnosticProbe).toBeNull();
  expect(r.warnings).toContain('DIAGNOSTIC_ROUTE_CONTROL_UNAVAILABLE:101');
  expect(await page.evaluate(()=>(window as any).resets)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

for(const option of ['badDetails','badPlanner','contextChanged','loadFailure','badPagination','loop'])test(`failure blocks research and restores the list: ${option}`,async({page})=>{
  await fixture(page,{[option]:true,secondPage:option==='badPagination'||option==='loop'});
  const r=await researchFleetCandidates(page,collection(),settings,{...config,maxSuggestions:1});
  expect(r.aircraft[0].status).toBe('unavailable');expect(r.uiRestored).toBe(true);
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('restoration failure stops the remaining research queue',async({page})=>{
  await fixture(page,{restoreFailure:true});const a=snapshot();const data=collection(a);data.aircraft.push({...a,aircraftId:'102',routeId:'2'});
  const r=await researchFleetCandidates(page,data,settings,{...config,maxSuggestions:1});
  expect(r.uiRestored).toBe(false);expect(r.warnings).toContain('RESEARCH_LIST_RESTORE_FAILED');expect(r.aircraft[1].status).toBe('deferred_restore_failure');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('bounded research defers extra aircraft and validates settings before clicking',async({page})=>{
  await fixture(page);const data=collection();data.aircraft.push({...snapshot(),aircraftId:'102',routeId:'2'});
  const r=await researchFleetCandidates(page,data,settings,{...config,maxAircraft:1,maxSuggestions:1});expect(r.aircraft[1].status).toBe('deferred_limit');
  for(const env of [{ENABLE_ROUTE_RESEARCH:'yes'},{ROUTE_RESEARCH_MAX_AIRCRAFT:'0'},{ROUTE_RESEARCH_MAX_SUGGESTIONS:'11'}])expect(()=>researchConfig(env)).toThrow('RESEARCH_CONFIG_INVALID');
  await expect(researchFleetCandidates(page,data,settings,{...config,maxAircraft:0})).rejects.toThrow('RESEARCH_CONFIG_INVALID');
});

test('uses the inspected Fleet tab when the main menu would toggle the open popup closed',async({page})=>{
  await fixture(page,{toggle:true});const r=await researchFleetCandidates(page,collection(),settings,{...config,maxSuggestions:1});
  expect(r.aircraft[0].status).toBe('observed');expect(r.uiRestored).toBe(true);expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
