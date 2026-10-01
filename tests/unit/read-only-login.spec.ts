import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loginForReadOnlyCollection } from '../../utils/read-only-login';

async function fixture(page:Page,broken=false) {
  const consoleMessages:string[]=[];
  page.on('console',m=>consoleMessages.push(m.text()));
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<button onclick="signup()">PLAY FREE NOW</button><script>
    window.operations=0;window.submissions=0;
    function signup(){document.body.insertAdjacentHTML('beforeend','<button id="menu" onclick="login()">Log in</button>');document.querySelector('button').remove()}
    function login(){document.querySelector('#menu').remove();document.body.insertAdjacentHTML('beforeend','<input id="lEmail" type="email"><input id="lPass" type="${broken?'text':'password'}"><button id="btnLogin" onclick="submit()">Log In</button>')}
    function submit(){window.submissions++;document.body.innerHTML='<div id="mapRoutes">Fleet</div><div id="am4-intro" style="display:none"></div><button onclick="window.operations++">Depart all</button>'}
    </script>`}));
  return consoleMessages;
}
test('normal isolated login does not log form values or execute any game operation',async({page})=>{
  const logs=await fixture(page);
  await loginForReadOnlyCollection(page,{EMAIL:'synthetic@example.invalid',PASSWORD:'synthetic-test-value'},500);
  expect(await page.evaluate(()=>(window as any).submissions)).toBe(1);
  expect(await page.evaluate(()=>(window as any).operations)).toBe(0);
  expect(logs).toEqual([]);
});
test('changed login field type stops before credentials are submitted and returns a generic error',async({page})=>{
  const logs=await fixture(page,true);
  await expect(loginForReadOnlyCollection(page,{EMAIL:'synthetic@example.invalid',PASSWORD:'synthetic-test-value'},500)).rejects.toThrow('READ_ONLY_LOGIN_OR_LOADING_FAILED');
  expect(await page.evaluate(()=>(window as any).submissions)).toBe(0);
  expect(await page.locator('#lEmail').inputValue()).toBe('');expect(logs).toEqual([]);
});
test('missing credentials stop before any navigation',async({page})=>{
  await page.route('**/*',r=>r.abort());
  await expect(loginForReadOnlyCollection(page,{},500)).rejects.toThrow('READ_ONLY_CREDENTIALS_MISSING');
  expect(page.url()).toBe('about:blank');
});
test('loading failure exposes only a generic error',async({page})=>{
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<p>Loading</p>'}));
  await expect(loginForReadOnlyCollection(page,{EMAIL:'synthetic@example.invalid',PASSWORD:'synthetic-test-value'},200)).rejects.toThrow('READ_ONLY_LOGIN_OR_LOADING_FAILED');
});
test('live workflow targets only isolated collection config and shares the account concurrency lock',async()=>{
  const workflow=await readFile('.github/workflows/validate-collection.yml','utf8');
  const entry=await readFile('tests/live/read-only-collection.spec.ts','utf8');
  expect(workflow).toContain('group: airline-manager-4-main');expect(workflow).toContain('playwright.collection.config.ts');
  expect(workflow).not.toContain('airlineManager.spec.ts');expect(workflow).not.toContain('GITHUB_TOKEN:');
  expect(entry).not.toMatch(/GeneralUtils|FleetUtils|FuelUtils|MaintenanceUtils|CampaignUtils/);
  expect(entry).toContain("DEMAND_DRY_RUN:'true'");expect(entry).toContain("DEMAND_FAIL_SAFE:'true'");
});
