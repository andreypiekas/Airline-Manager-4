import { test, expect } from '@playwright/test';
import { readCurrentRouteFieldDiagnostics } from '../../optimization/current-route-diagnostics';

test('captures visible current-route economic fields without interacting with controls',async({page})=>{
  await page.route('**/*',route=>route.abort());
  await page.setContent(`
    <div id="detailsAction">
      <span id="departFlightTimeInfo">01:22:33</span>
      <span id="departFuelInfo">44,321 Lbs</span>
      <span id="departCo2Info">0.17 kg/pax/km</span>
      <span id="costIndexBar">200</span>
      <div><b>Route fee</b><span>$ 77,700</span></div>
      <button onclick="window.mutations=(window.mutations||0)+1">Save</button>
    </div>`);
  const r=await readCurrentRouteFieldDiagnostics(page.locator('#detailsAction'));
  const serialized=JSON.stringify(r);
  expect(serialized).toContain('departFlightTimeInfo');
  expect(serialized).toContain('departFuelInfo');
  expect(serialized).toContain('departCo2Info');
  expect(serialized).toContain('costIndexBar');
  expect(serialized).toContain('Route fee');
  expect(await page.evaluate(()=>(window as any).mutations||0)).toBe(0);
});

test('hidden current-route details produce no diagnostics',async({page})=>{
  await page.setContent('<div id="detailsAction" style="display:none"><span id="departFuelInfo">1</span></div>');
  expect(await readCurrentRouteFieldDiagnostics(page.locator('#detailsAction'))).toEqual([]);
});
