import { test, expect } from '@playwright/test';
import { readRouteQuoteFieldDiagnostics } from '../../optimization/route-quote-diagnostics';

test('captures visible operational route fields without interacting with them',async({page})=>{
  await page.setContent(`
    <div id="newRouteInfo">
      <div id="runwayInfo">Runway 8,500 ft</div>
      <span id="departFuelInfo">12,345 lbs</span>
      <div>Daily pax demand</div>
      <input id="routeReg" value="TEST-1">
      <button id="btnCreateNewRoute">Create route</button>
      <div id="noise">hello</div>
      <div id="hiddenRunway" style="display:none">Runway 9,999 ft</div>
    </div>
  `);
  const r=await readRouteQuoteFieldDiagnostics(page);
  expect(r).toEqual(expect.arrayContaining([
    expect.objectContaining({id:'runwayInfo',label:'Runway 8,500 ft'}),
    expect.objectContaining({id:'departFuelInfo',label:'12,345 lbs'}),
    expect.objectContaining({label:'Daily pax demand'})
  ]));
  expect(r.some(x=>x.id==='noise')).toBe(false);
  expect(r.some(x=>x.id==='hiddenRunway')).toBe(false);
});
