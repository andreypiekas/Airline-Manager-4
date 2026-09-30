import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewWithReturnJournal } from '../../optimization/return-journal';
import { RouteReview } from '../../optimization/route-optimizer';
const now = new Date('2026-09-30T11:00:00Z');
function input(flightId='flight-1'): RouteReview {
  const leg={from:'AAA',to:'BBB',distanceKm:1000,durationHours:2,originRunwayFt:10000,destinationRunwayFt:10000,demandPool:'AAA-BBB',remaining:{Y:1000,J:0,F:0},automaticFares:{Y:1000,J:0,F:0},expectedLoadFactor:{Y:1,J:0,F:0},costs:{fuel:1000,co2:100,maintenance:100,airportAndOther:100}};
  return {position:{aircraftId:'1',homeBase:'AAA',airport:'AAA',state:'landed',flightId,destination:null,observedAt:now.toISOString()},previousPosition:{aircraftId:'1',homeBase:'AAA',airport:null,state:'inflight',flightId,destination:'AAA',observedAt:'2026-09-30T10:30:00Z'},capacity:{Y:100,J:0,F:0},rangeKm:5000,minRunwayFt:5000,enforceRunway:true,currentRouteId:'current',candidatesComplete:true,candidates:[{id:'current',observedAt:now.toISOString(),setupCost:0,demandNetOfOtherAircraft:true,legs:[leg,{...leg,from:'BBB',to:'AAA'}]}]};
}
let directory: string;
test.beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'am4-journal-'));});
test.afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
const options=()=>({directory,scope:'company-test',origin:'AAA'});
test('fresh instances retain reviews across process-style reopen',async()=>{
  expect((await reviewWithReturnJournal(input(),options(),now)).decision).toBe('keep_route');
  expect((await reviewWithReturnJournal(input(),options(),now)).decision).toBe('already_reviewed');
  const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));
  expect(saved.entries).toEqual([{aircraftId:'1',origin:'AAA',flightId:'flight-1',reviewedAt:now.toISOString(),decision:'keep_route'}]);
});
test('next flight is reviewed, old flight remains deduplicated',async()=>{
  await reviewWithReturnJournal(input(),options(),now);
  expect((await reviewWithReturnJournal(input('flight-2'),options(),now)).decision).toBe('keep_route');
  expect((await reviewWithReturnJournal(input(),options(),now)).decision).toBe('already_reviewed');
});
test('unavailable candidate data does not consume the return',async()=>{
  const r=input();r.candidatesComplete=false;
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('unavailable');
  expect((await reviewWithReturnJournal(input(),options(),now)).decision).toBe('keep_route');
});
test('landing at another airport does not consume return',async()=>{
  const r=input();r.position.airport='BBB';
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('not_at_base_return');
  expect((await reviewWithReturnJournal(input(),options(),now)).decision).toBe('keep_route');
});
test('corrupted state blocks and preserves evidence',async()=>{
  const p=join(directory,'return-journal.json');await writeFile(p,'broken');
  await expect(reviewWithReturnJournal(input(),options(),now)).rejects.toThrow('JOURNAL_UNAVAILABLE');expect(await readFile(p,'utf8')).toBe('broken');
});
test('different company cannot reuse journal',async()=>{
  await reviewWithReturnJournal(input(),options(),now);
  await expect(reviewWithReturnJournal(input(),{...options(),scope:'other-company'},now)).rejects.toThrow('JOURNAL_UNAVAILABLE');
});
test('wrong registered origin is rejected before review',async()=>{
  await expect(reviewWithReturnJournal(input(),{...options(),origin:'CCC'},now)).rejects.toThrow('JOURNAL_ORIGIN_MISMATCH');
});
test('concurrent transactions cannot both review one arrival',async()=>{
  const r=await Promise.allSettled([reviewWithReturnJournal(input(),options(),now),reviewWithReturnJournal(input(),options(),now)]);
  expect(r.filter(x=>x.status==='fulfilled' && x.value.decision==='keep_route')).toHaveLength(1);
  expect((await reviewWithReturnJournal(input(),options(),now)).decision).toBe('already_reviewed');
});
test('existing lock blocks without deleting another transaction lock',async()=>{
  await mkdir(join(directory,'.return-journal.lock'));
  await expect(reviewWithReturnJournal(input(),options(),now)).rejects.toThrow('[Lock]');
});
test('duplicate saved entries are invalid',async()=>{
  await reviewWithReturnJournal(input(),options(),now);const p=join(directory,'return-journal.json');const d=JSON.parse(await readFile(p,'utf8'));d.entries.push(d.entries[0]);await writeFile(p,JSON.stringify(d));
  await expect(reviewWithReturnJournal(input('flight-2'),options(),now)).rejects.toThrow('JOURNAL_UNAVAILABLE');
});
test('simulated hold is completed and deduplicated',async()=>{
  const r=input();r.candidates[0].legs.forEach(l=>l.remaining.Y=0);
  const plan=await reviewWithReturnJournal(r,options(),now);expect(plan.decision).toBe('hold');expect(plan.mutationAuthorized).toBe(false);
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('already_reviewed');
});
test('unreadable state destination blocks recommendations',async()=>{
  // A directory instead of the state file must not be treated as a first execution.
  await mkdir(join(directory,'return-journal.json'));
  await expect(reviewWithReturnJournal(input(),options(),now)).rejects.toThrow('JOURNAL_UNAVAILABLE');
});

test('daily review requires no fabricated flight ID and deduplicates across reopen', async () => {
  const r=input();r.trigger='daily';r.previousPosition=null;r.position.flightId=null;
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('keep_route');
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('already_reviewed');
  const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));
  expect(saved.entries[0].flightId).toBe('daily_20260930');
  const tomorrow=new Date('2026-10-01T11:00:00Z');r.position.observedAt=tomorrow.toISOString();r.candidates.forEach(c=>c.observedAt=tomorrow.toISOString());
  expect((await reviewWithReturnJournal(r,options(),tomorrow)).decision).toBe('keep_route');
});
test('failed daily comparison stays pending and is retryable the same day', async () => {
  const r=input();r.trigger='daily';r.previousPosition=null;r.position.flightId=null;r.candidatesComplete=false;
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('unavailable');
  r.candidatesComplete=true;
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('keep_route');
});
test('daily review away from base cannot be recorded', async () => {
  const r=input();r.trigger='daily';r.position.airport='BBB';
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('not_at_base_return');
  r.position.airport='AAA';
  expect((await reviewWithReturnJournal(r,options(),now)).decision).toBe('keep_route');
});
