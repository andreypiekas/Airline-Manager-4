import { test, expect, Page } from '@playwright/test';
import { readOpenCandidateQuote, readOpenCandidateQuoteAfterVerifiedAjax, QuoteIdentity, parseQuoteAutoprice } from '../../optimization/quote-reader';
import { parseDeliveredAgeMinutes, readOperationalObservation } from '../../optimization/observations';

const identity: QuoteIdentity = { aircraftId: '101', registration: 'TEST-1', airportId: '200', from: 'AAA', to: 'BBB' };
async function fixture(page: Page) {
  await page.route('**/*', route => route.abort());
  await page.setContent(`<script>window.mutations=0</script>
  <button id="introSuggestm" onclick="playSound('neutral_click');Ajax('new_route_info.php?id=101&airportId=200&ferry=0','newRouteInfo',this,false,true);">Next</button>
  <div id="newRouteInfo"><div id="newRouteContainer">
    <div class="blue-bg">TEST-1<div><span>Close</span></div></div>
    <div class="row p-0"><div class="col-3 m-text"><b>AAA</b></div><div class="col-2"><span class="s-text">1,955</span>km</div><div class="col-3 m-text"><b>BBB</b></div></div>
    <table><tr><td colspan="3">Daily pax demand</td></tr><tr>${['economy','business','first'].map(n=>`<td><img src="assets/${n}_seat.png"></td>`).join('')}</tr><tr><td>431</td><td>169</td><td>162</td></tr></table>
    <div><div>A/C on route</div><div>0</div></div>
    <span id="departFlightTimeInfo">01:38:14</span><span id="departFuelInfo">23,695</span><span id="departCo2Info">0.15</span><div id="costIndexBar">200</div>
    <div><div><b>Route fee</b></div><div>$ 45,716</div></div>
    <button id="introAuto" onclick="window.mutations++">Autoprice</button><input id="eSeat" value="999"><input id="routeReg" value="TEST">
    <button id="btnCreateNewRoute" onclick="window.mutations++">Create route</button>
  </div></div>`);
}
test('verified direct Ajax reader relies on rendered identity instead of stale suggestion control',async({page})=>{
  await fixture(page);
  await page.locator('#introSuggestm').evaluate(e=>e.setAttribute('onclick','staleSuggestion(999,888)'));
  const r=await readOpenCandidateQuoteAfterVerifiedAjax(page,identity);
  expect(r).toMatchObject({status:'observed',quote:{aircraftId:'101',registration:'TEST-1',from:'AAA',to:'BBB',airportId:'200'}});
  expect((await readOpenCandidateQuote(page,identity)).status).toBe('unavailable');
  expect((await readOpenCandidateQuoteAfterVerifiedAjax(page,{...identity,registration:'OTHER'})).status).toBe('unavailable');
  expect((await readOpenCandidateQuoteAfterVerifiedAjax(page,{...identity,to:'CCC'})).status).toBe('unavailable');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('reads inspected quote without treating daily demand as remaining or clicking any control', async ({ page }) => {
  await fixture(page);
  const r = await readOpenCandidateQuote(page, identity);
  expect(r).toMatchObject({ status: 'observed', quote: { ...identity, distanceKm: 1955, durationSeconds: 5894, fuelLbs: 23695, co2KgPerPaxKm: .15, costIndex: 200, routeFee: 45716, aircraftOnRoute: 0, dailyDemand: {Y:431,J:169,F:162}, remainingDemand: null, netProfit: null, comparisonReady: false, mutationAuthorized: false,
    createControl:{observed:true,visible:true,enabled:true,id:'btnCreateNewRoute',label:'Create route',onclickShape:'window.mutations++',phpEndpoints:[],ajaxTargets:[],mutationAuthorized:false} } });
  expect(await page.locator('#eSeat').inputValue()).toBe('999');
  expect(await page.locator('#routeReg').inputValue()).toBe('TEST');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('discovers Create route by accessible label even when the live control has no stable id',async({page})=>{
  await fixture(page);
  await page.locator('#btnCreateNewRoute').evaluate(e=>e.removeAttribute('id'));
  const r=await readOpenCandidateQuote(page,identity);
  expect(r).toMatchObject({status:'observed',quote:{createControl:{
    observed:true,visible:true,enabled:true,id:null,label:'Create route',onclickShape:'window.mutations++',mutationAuthorized:false
  }}});
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('discovers Create route when the live control is a non-button element with onclick',async({page})=>{
  await fixture(page);
  await page.locator('#btnCreateNewRoute').evaluate(e=>{
    const a=document.createElement('a');
    a.textContent='Create route';
    a.setAttribute('onclick',e.getAttribute('onclick')||'');
    e.replaceWith(a);
  });
  const r=await readOpenCandidateQuote(page,identity);
  expect(r).toMatchObject({status:'observed',quote:{createControl:{
    observed:true,visible:true,enabled:true,id:null,label:'Create route',onclickShape:'window.mutations++',mutationAuthorized:false
  }}});
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('passive listener diagnostics capture registered route handlers without executing them',async({page})=>{
  await fixture(page);
  await page.locator('#btnCreateNewRoute').evaluate((e)=>{
    e.removeAttribute('onclick');
    e.addEventListener('click',()=>fetch('route_create.php?id=123&token=SECRET'));
  });
  const r=await readOpenCandidateQuote(page,identity);
  expect(r.status).toBe('observed');
  if(r.status!=='observed')return;
  const serialized=JSON.stringify(r.quote.routeListenerDiagnostics);
  expect(serialized).toContain('route_create.php');
  expect(serialized).toContain('id=<value>');
  expect(serialized).toContain('token=<value>');
  expect(serialized).not.toContain('SECRET');
  expect(serialized).not.toContain('123');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('passive jQuery event diagnostics expose delegated Create route handler without executing it',async({page})=>{
  await fixture(page);
  await page.locator('#btnCreateNewRoute').evaluate(e=>e.removeAttribute('onclick'));
  await page.evaluate(()=>{
    const handler=function(){ return "Ajax('create_route.php?id=123&token=SECRET','newRouteInfo',this)"; };
    const jq:any=function(){};
    jq._data=(element:any,key:string)=>{
      if(key!=='events')return null;
      if(element===document)return {click:[{selector:'#btnCreateNewRoute',handler}]};
      return null;
    };
    (window as any).$=jq;
    (window as any).jQuery=jq;
  });
  const r=await readOpenCandidateQuote(page,identity);
  expect(r.status).toBe('observed');
  if(r.status!=='observed')return;
  const serialized=JSON.stringify(r.quote.routeListenerDiagnostics);
  expect(serialized).toContain('jquery-event');
  expect(serialized).toContain('#btnCreateNewRoute');
  expect(serialized).toContain('create_route.php');
  expect(serialized).toContain('id=<value>');
  expect(serialized).toContain('token=<value>');
  expect(serialized).not.toContain('SECRET');
  expect(serialized).not.toContain('123');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('jQuery handler diagnostics scan the full handler for a late route endpoint',async({page})=>{
  await fixture(page);
  await page.locator('#btnCreateNewRoute').evaluate(e=>e.removeAttribute('onclick'));
  await page.evaluate(()=>{
    const filler='x'.repeat(5000);
    const handler=new Function(`const filler="${filler}"; return "Ajax('late_route.php?id=123','routeAction',this)";`);
    const jq:any=function(){};
    jq._data=(element:any,key:string)=>{
      if(key!=='events')return null;
      if(element===document)return {click:[{selector:'#btnCreateNewRoute',handler}]};
      return null;
    };
    (window as any).$=jq;(window as any).jQuery=jq;
  });
  const r=await readOpenCandidateQuote(page,identity);
  expect(r.status).toBe('observed');
  if(r.status!=='observed')return;
  const listener=r.quote.routeListenerDiagnostics?.find(x=>x.source==='jquery-event'&&x.selector==='#btnCreateNewRoute');
  expect(listener?.phpEndpoints).toContain('late_route.php');
  expect(listener?.sourceLength).toBeGreaterThan(5000);
  expect(listener?.handlerTailShape).toContain('late_route.php');
  expect(JSON.stringify(listener)).not.toContain('123');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('route action diagnostics retain endpoint shape but redact query values',async({page})=>{
  await fixture(page);
  await page.locator('#btnCreateNewRoute').evaluate(e=>e.setAttribute(
    'onclick',
    "Ajax('route_create.php?id=123&token=SECRET','routeAction',this);"
  ));
  const r=await readOpenCandidateQuote(page,identity);
  expect(r.status).toBe('observed');
  if(r.status!=='observed')return;
  const serialized=JSON.stringify(r.quote.routeActionDiagnostics);
  expect(serialized).toContain('route_create.php');
  expect(serialized).toContain('id=<value>');
  expect(serialized).toContain('token=<value>');
  expect(serialized).not.toContain('SECRET');
  expect(serialized).not.toContain('123');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

test('rejects candidate when the independent rendered route header disagrees with primary codes',async({page})=>{
  await fixture(page);
  await page.locator('.row.p-0 .col-3.m-text').last().evaluate(e=>e.innerHTML='<b>CCC</b>');
  const r=await readOpenCandidateQuote(page,identity);
  expect(r.status).toBe('unavailable');
  expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});

for (const mismatch of [{ aircraftId:'102' }, { airportId:'201' }, { registration:'OTHER' }, { from:'BBB',to:'AAA' }]) {
  test(`rejects mismatched quote identity ${JSON.stringify(mismatch)}`, async ({ page }) => {
    await fixture(page); expect((await readOpenCandidateQuote(page,{...identity,...mismatch})).status).toBe('unavailable');
  });
}
for (const [selector, value] of [['#departFlightTimeInfo','01:99:00'],['#departFuelInfo','23,69'],['#departCo2Info','NaN'],['#costIndexBar','201']]) {
  test(`rejects invalid quote value ${selector}`, async ({ page }) => {
    await fixture(page); await page.locator(selector).evaluate((e,v)=>e.textContent=v,value);
    expect((await readOpenCandidateQuote(page,identity)).status).toBe('unavailable');
  });
}
test('unknown callback cannot link quote to aircraft', async ({ page }) => {
  await fixture(page); await page.locator('#introSuggestm').evaluate(e=>e.setAttribute('onclick','unknown(101,200)'));
  expect((await readOpenCandidateQuote(page,identity)).status).toBe('unavailable');
});
test('daily demand class order is validated, never guessed', async ({ page }) => {
  await fixture(page); await page.locator('img').first().evaluate(e=>e.setAttribute('src','assets/business_seat.png'));
  expect((await readOpenCandidateQuote(page,identity)).status).toBe('unavailable');
});
test('hidden stale quote is unavailable', async ({ page }) => {
  await fixture(page); await page.locator('#newRouteInfo').evaluate(e=>(e as HTMLElement).style.display='none');
  expect((await readOpenCandidateQuote(page,identity)).status).toBe('unavailable');
});
test('missing quote is unavailable without waiting or navigation', async ({ page }) => {
  await page.setContent('<p>Loading</p>'); expect((await readOpenCandidateQuote(page,identity)).status).toBe('unavailable');
});
test('operational labels read observed units; cycles do not become a flight ID or home base', async ({ page }) => {
  await page.setContent('<div id="details"><span class="s-text">Range</span><br><span class="m-text">3,440km</span><br><span class="s-text">Min runway</span><br><span class="m-text">7,550ft</span><br><span class="s-text">Flight hours/Cycles</span><br><span class="m-text">682 / 206</span></div>');
  expect(await readOperationalObservation(page.locator('#details'))).toEqual({rangeKm:3440,minRunwayFt:7550,flightHours:682,cycles:206,deliveredAgeMinutes:null,homeBase:null,flightId:null});
  await page.locator('span.m-text').first().evaluate(e=>e.textContent='3,440miles');
  expect(await readOperationalObservation(page.locator('#details'))).toBeNull();
});
test('delivery age telemetry is bounded and never guesses coarse month labels',async({page})=>{
  expect(parseDeliveredAgeMinutes('18 mins ago')).toBe(18);
  expect(parseDeliveredAgeMinutes('12 hours ago')).toBe(720);
  expect(parseDeliveredAgeMinutes('1 day ago')).toBe(1440);
  expect(parseDeliveredAgeMinutes('1 month ago')).toBeNull();
  await page.setContent('<div id="details"><span class="s-text">Range</span><br><span class="m-text">3,440km</span><br><span class="s-text">Min runway</span><br><span class="m-text">7,550ft</span><br><span class="s-text">Flight hours/Cycles</span><br><span class="m-text">63 / 3</span><br><span class="s-text">Delivered</span><br><span class="m-text">12 hours ago</span></div>');
  expect(await readOperationalObservation(page.locator('#details'))).toMatchObject({cycles:3,deliveredAgeMinutes:720});
});

test('missing and duplicate operational labels fail closed', async ({ page }) => {
  await page.setContent('<div id="details"><span class="s-text">Range</span><span class="s-text">Range</span></div>');
  expect(await readOperationalObservation(page.locator('#details'))).toBeNull();
});

test('quote Autoprice callback is read without execution or assuming effective VIP fare',async({page})=>{
 await fixture(page);await page.locator('#introAuto').evaluate(e=>e.setAttribute('onclick',"playSound('neutral_click');autoPrice(783,1786,3039,22);"));
 const r=await readOpenCandidateQuote(page,identity);
 expect(r).toMatchObject({status:'observed',quote:{autopriceReference:{base:{Y:783,J:1786,F:3039},modelId:22,effectiveFares:null},comparisonReady:false}});
 expect(await page.evaluate(()=>(window as any).mutations)).toBe(0);
});
test('unrecognized or invalid quote pricing callback stays unknown',()=>{
 for(const s of ['autoPrice(-1,2,3,22);','autoPrice(1,2,3,22);danger();','unknown(1,2,3,22);','autoPrice(999999999999999999,2,3,22);'])expect(parseQuoteAutoprice(s)).toBeNull();
});
