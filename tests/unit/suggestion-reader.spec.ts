import { test,expect,Page } from '@playwright/test';
import { collectOpenRouteSuggestions, probeOpenRouteControl } from '../../optimization/suggestion-reader';
import { AircraftSnapshot } from '../../demand/types';
const aircraft:AircraftSnapshot={aircraftId:'101',registration:'SYNTHETIC',routeId:'1',routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'ready',capacity:{Y:100,J:0,F:0},remaining:{Y:1000,J:0,F:0},dailyTotal:{Y:1000,J:0,F:0},observedAt:new Date().toISOString()};
async function fixture(page:Page,unknown=false) {
 await page.route('**/*',r=>r.abort());
 await page.setContent(`<button id="introSuggest" onclick="${unknown?'danger()':"playSound('neutral_click');Ajax('add_airports.php?mode=suggest&id=101','runme',this,false,true);"}">Suggest route</button><div id="summary"></div><div id="newRouteInfo" style="display:none"></div><script>
 window.mutations=0;window.reads=0;
 function playSound(){}
 function danger(){window.mutations++}
 function Ajax(url){
 window.reads++;
 if(url.startsWith('add_airports.php'))document.querySelector('#summary').innerHTML=\`<button id="introSuggestm" onclick="playSound('neutral_click');Ajax('new_route_info.php?id=101&airportId=200&ferry=0','newRouteInfo',this,false,true);">Next</button><button id="introSuggestOR" onclick="playSound('neutral_click');Ajax('add_airports.php?mode=suggest&id=101','runme',this,false,true);">Suggest other routes</button>\`;
 else {
 const panel=document.querySelector('#newRouteInfo');panel.style.display='block';panel.innerHTML=\`<div class="blue-bg">SYNTHETIC<div>Close</div></div><div class="row p-0"><div class="col-3 m-text"><b>AAA</b></div><div class="col-2"><span class="s-text">1,000</span> km</div><div class="col-3 m-text"><b>BBB</b></div></div><table><tr><td>Daily pax demand</td></tr><tr><td><img src="assets/economy_seat.png"></td><td><img src="assets/business_seat.png"></td><td><img src="assets/first_seat.png"></td></tr><tr><td>1000</td><td>100</td><td>100</td></tr></table><div>A/C on route</div><div>0</div><span id="departFlightTimeInfo">02:00:00</span><span id="departFuelInfo">1000</span><span id="departCo2Info">0.14</span><span id="costIndexBar">200</span><div><b>Route fee</b></div><div>$ 1000</div><button id="introAuto" onclick="danger()">Autoprice</button><button id="btnCreateNewRoute" onclick="danger()">Create route</button><button id="back">Back</button>\`;
 const back=panel.querySelector('#back');back.setAttribute('onclick',"$('#newRouteInfo').hide('fast');playSound('neutral_click');");
 }
 }
 function $(selector){return {hide(){document.querySelector(selector).style.display='none'}}}
 </script>`);
}
test('collects an inspected quote and stops repeated suggestions without financial clicks',async({page})=>{
 await fixture(page);const r=await collectOpenRouteSuggestions(page,aircraft,'AAA',3,500);
 expect(r.status).toBe('observed');expect(r.quotes).toHaveLength(1);expect(r.quotes[0]).toMatchObject({remainingDemand:null,comparisonReady:false,mutationAuthorized:false});expect(r.warnings).toContain('REPEATED_SUGGESTION');expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('unknown suggestion callback is rejected before any click',async({page})=>{
 await fixture(page,true);expect((await collectOpenRouteSuggestions(page,aircraft,'AAA',3,500)).status).toBe('unavailable');expect(await page.evaluate(()=>(window as any).reads)).toBe(0);expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
for(const variant of ['away','inflight','missing-origin','issue'])test(`replacement research blocked ${variant}`,async({page})=>{
 await fixture(page);const a={...aircraft};if(variant==='away')a.from='BBB';if(variant==='inflight')a.state='inflight';if(variant==='issue')a.issue='failure';
 const r=await collectOpenRouteSuggestions(page,a,variant==='missing-origin'?null:'AAA',3,500);expect(r.warnings).toEqual(['AIRCRAFT_NOT_READY_AT_BASE']);expect(await page.evaluate(()=>(window as any).reads)).toBe(0);
});

test('diagnostic probe may inspect one suggestion away from home base without creating an optimization candidate',async({page})=>{
 await fixture(page);
 const away={...aircraft,from:'AAA',to:'BBB'};
 const r=await probeOpenRouteControl(page,away,'AAA',500);
 expect(r.status).toBe('observed');
 expect(r.observation).toMatchObject({
   airportId:'200',from:'AAA',to:'BBB',
   createControl:{observed:true,mutationAuthorized:false}
 });
 expect(r.mutationAuthorized).toBe(false);
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('diagnostic probe fails closed on current-airport mismatch before clicks',async({page})=>{
 await fixture(page);
 const r=await probeOpenRouteControl(page,aircraft,'CCC',500);
 expect(r.status).toBe('unavailable');
 expect(r.warnings).toEqual(['DIAGNOSTIC_AIRCRAFT_CONTEXT_INVALID']);
 expect(await page.evaluate(()=>(window as any).reads)).toBe(0);
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('expired aircraft observation blocks all research clicks',async({page})=>{
 await fixture(page);const r=await collectOpenRouteSuggestions(page,{...aircraft,observedAt:'2000-01-01T00:00:00Z'},'AAA',3,500);
 expect(r.warnings).toEqual(['AIRCRAFT_OBSERVATION_EXPIRED']);expect(await page.evaluate(()=>(window as any).reads)).toBe(0);
});

test('waits for replacement suggestion markup instead of accepting the previous Next button',async({page})=>{
 await fixture(page);
 await page.evaluate(()=>{
   const ajax=(window as any).Ajax;(window as any).suggestRequests=0;
   (window as any).Ajax=(url:string)=>{
     if(!url.startsWith('add_airports.php')){ajax(url);return;}
     (window as any).suggestRequests++;
     const n=(window as any).suggestRequests;
     setTimeout(()=>{ajax(url);if(n===2){const next=document.querySelector('#introSuggestm')!;next.setAttribute('onclick',next.getAttribute('onclick')!.replace('airportId=200','airportId=201'));}},50);
   };
 });
 const r=await collectOpenRouteSuggestions(page,aircraft,'AAA',2,500);
 expect(r.status).toBe('observed');expect(r.quotes.map(q=>q.airportId)).toEqual(['200','201']);expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('screens out a weak suggestion and continues until a viable ceiling candidate is found',async({page})=>{
 await fixture(page);
 await page.evaluate(()=>{
   const ajax=(window as any).Ajax;
   (window as any).suggestRequests=0;(window as any).quoteRequests=0;
   (window as any).Ajax=(url:string)=>{
     ajax(url);
     if(url.startsWith('add_airports.php')){
       (window as any).suggestRequests++;
       if((window as any).suggestRequests===2){
         const next=document.querySelector('#introSuggestm')!;
         next.setAttribute('onclick',next.getAttribute('onclick')!.replace('airportId=200','airportId=201'));
       }
     }
     if(url.startsWith('new_route_info.php')){
       (window as any).quoteRequests++;
       const demandRow=Array.from(document.querySelectorAll('#newRouteInfo table tr'))[2]!;
       demandRow.children[0].textContent=(window as any).quoteRequests===1?'20':'1000';
     }
   };
 });
 const r=await collectOpenRouteSuggestions(page,aircraft,'AAA',1,500,80,2);
 expect(r.quotes).toHaveLength(1);
 expect(r.quotes[0].airportId).toBe('201');
 expect(r.screenedOut).toHaveLength(1);
 expect(r.screenedOut[0]).toMatchObject({airportId:'200',to:'BBB',coverageCeilingPercent:20});
 expect(r.scanned).toBe(2);
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('rejects executable code disguised between multiple Back callback comments',async({page})=>{
 await fixture(page);await page.evaluate(()=>{
  const ajax=(window as any).Ajax;(window as any).Ajax=(url:string)=>{ajax(url);if(url.startsWith('new_route_info.php'))document.querySelector('#back')!.setAttribute('onclick',"$('#newRouteInfo').hide('fast');playSound('neutral_click');/*first*/danger();/*second*/");};
 });
 const r=await collectOpenRouteSuggestions(page,aircraft,'AAA',1,500);
 expect(r.status).toBe('partial');expect(r.warnings).toContain('SUGGESTION_LOADING_OR_IDENTITY_FAILED');expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
