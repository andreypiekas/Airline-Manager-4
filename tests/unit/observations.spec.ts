import { test, expect, Page } from '@playwright/test';
import { readOpenCandidateQuote, QuoteIdentity } from '../../optimization/quote-reader';
import { readOperationalObservation } from '../../optimization/observations';

const identity: QuoteIdentity = { aircraftId: '101', registration: 'TEST-1', airportId: '200', from: 'AAA', to: 'BBB' };
async function fixture(page: Page) {
  await page.route('**/*', route => route.abort());
  await page.setContent(`<script>window.mutations=0</script>
  <button id="introSuggestm" onclick="playSound('neutral_click');Ajax('new_route_info.php?id=101&airportId=200&ferry=0','newRouteInfo',this,false,true);">Next</button>
  <div id="newRouteInfo"><div id="newRouteContainer">
    <div class="blue-bg">TEST-1<div><span>Close</span></div></div>
    <div class="col-3 m-text"><b>AAA</b></div><div class="col-2"><span class="s-text">1,955</span>km</div><div class="col-3 m-text"><b>BBB</b></div>
    <table><tr><td colspan="3">Daily pax demand</td></tr><tr>${['economy','business','first'].map(n=>`<td><img src="assets/${n}_seat.png"></td>`).join('')}</tr><tr><td>431</td><td>169</td><td>162</td></tr></table>
    <div><div>A/C on route</div><div>0</div></div>
    <span id="departFlightTimeInfo">01:38:14</span><span id="departFuelInfo">23,695</span><span id="departCo2Info">0.15</span><div id="costIndexBar">200</div>
    <div><div><b>Route fee</b></div><div>$ 45,716</div></div>
    <button id="introAuto" onclick="window.mutations++">Autoprice</button><input id="eSeat" value="999"><input id="routeReg" value="TEST">
    <button id="btnCreateNewRoute" onclick="window.mutations++">Create route</button>
  </div></div>`);
}
test('reads inspected quote without treating daily demand as remaining or clicking any control', async ({ page }) => {
  await fixture(page);
  const r = await readOpenCandidateQuote(page, identity);
  expect(r).toMatchObject({ status: 'observed', quote: { ...identity, distanceKm: 1955, durationSeconds: 5894, fuelLbs: 23695, co2KgPerPaxKm: .15, costIndex: 200, routeFee: 45716, aircraftOnRoute: 0, dailyDemand: {Y:431,J:169,F:162}, remainingDemand: null, netProfit: null, comparisonReady: false, mutationAuthorized: false } });
  expect(await page.locator('#eSeat').inputValue()).toBe('999');
  expect(await page.locator('#routeReg').inputValue()).toBe('TEST');
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
  expect(await readOperationalObservation(page.locator('#details'))).toEqual({rangeKm:3440,minRunwayFt:7550,flightHours:682,cycles:206,homeBase:null,flightId:null});
  await page.locator('span.m-text').first().evaluate(e=>e.textContent='3,440miles');
  expect(await readOperationalObservation(page.locator('#details'))).toBeNull();
});
test('missing and duplicate operational labels fail closed', async ({ page }) => {
  await page.setContent('<div id="details"><span class="s-text">Range</span><span class="s-text">Range</span></div>');
  expect(await readOperationalObservation(page.locator('#details'))).toBeNull();
});
