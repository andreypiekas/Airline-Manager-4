import { test,expect } from '@playwright/test';
import { readReputationDiagnostics } from '../../optimization/reputation-diagnostics';

test('captures visible reputation labels without assigning semantic meaning',async({page})=>{
  await page.setContent('<div id="rep">Pax Reputation 82.5%</div><div style="display:none">Reputation 99%</div>');
  const r=await readReputationDiagnostics(page);
  expect(r.status).toBe('observed');
  expect(r.entries).toEqual([expect.objectContaining({tag:'div',id:'rep',text:'Pax Reputation 82.5%'})]);
  expect(r.parsedPercentages).toEqual([82.5]);
  expect(r.comparisonReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
});

test('returns unavailable when no visible reputation label exists',async({page})=>{
  await page.setContent('<div>Fleet</div>');
  const r=await readReputationDiagnostics(page);
  expect(r).toMatchObject({status:'unavailable',entries:[],parsedPercentages:[],comparisonReady:false,mutationAuthorized:false});
});
