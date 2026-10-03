import { test, expect } from '@playwright/test';
import { parseFlightHistoryRow, readFlightHistoryEvidence } from '../../optimization/flight-history';

test('parses inspected AM4 flight history row exactly',()=>{
  expect(parseFlightHistoryRow('49 mins ago GRU-DEL 340-200-6 624,220 Quotas Y161 J12 F4 266,939 Lbs $1,284,400')).toEqual({
    relativeTime:'49 mins ago',from:'GRU',to:'DEL',registrationLabel:'340-200-6',
    co2Quotas:624220,onboard:{Y:161,J:12,F:4},fuelLbs:266939,revenue:1284400
  });
});

test('historical registration labels may differ without changing route evidence',()=>{
  const r=parseFlightHistoryRow('3 days ago GRU-MLE A340-200-5 428,586 Quotas Y116 J8 F5 238,428 Lbs $882,500');
  expect(r).toMatchObject({from:'GRU',to:'MLE',registrationLabel:'A340-200-5',onboard:{Y:116,J:8,F:5}});
});

for(const bad of [
  '49 mins ago GRU-GRU X 1 Quotas Y1 J1 F1 1 Lbs $1',
  '49 mins ago GRU-DEL X NaN Quotas Y1 J1 F1 1 Lbs $1',
  '49 mins ago GRU-DEL X 1 Quotas Y-1 J1 F1 1 Lbs $1',
  'GRU-DEL X 1 Quotas Y1 J1 F1 1 Lbs $1'
]) test('rejects malformed flight-history row '+bad,()=>expect(parseFlightHistoryRow(bad)).toBeNull());

test('reads visible flight-history window without clicks',async({page})=>{
  await page.setContent(`
    <div id="detailsAction">
      <div id="flight-history">
        <div class="row bg-light m-text p-1 border">49 mins ago GRU-DEL 340-200-6 624,220 Quotas Y161 J12 F4 266,939 Lbs $1,284,400</div>
        <div class="row bg-light m-text p-1 border">12 hours ago DEL-GRU 340-200-6 456,340 Quotas Y115 J10 F3 266,939 Lbs $938,850</div>
      </div>
      <button onclick="window.mutations=(window.mutations||0)+1">History</button>
    </div>`);
  const r=await readFlightHistoryEvidence(page.locator('#detailsAction'));
  expect(r.status).toBe('observed');
  expect(r.complete).toBe(false);
  expect(r.entries).toHaveLength(2);
  expect(r.entries[0].revenue).toBe(1284400);
  expect(r.navigationDiagnostics).toEqual([expect.objectContaining({tag:'button',text:'History',onclick:expect.stringContaining('window.mutations')})]);
  expect(r.comparisonReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
  expect(await page.evaluate(()=>(window as any).mutations||0)).toBe(0);
});

test('one unrecognized visible history row fails the evidence closed',async({page})=>{
  await page.setContent('<div id="detailsAction"><div id="flight-history"><div class="row bg-light m-text p-1 border">unknown history format</div></div></div>');
  expect((await readFlightHistoryEvidence(page.locator('#detailsAction'))).status).toBe('unavailable');
});
