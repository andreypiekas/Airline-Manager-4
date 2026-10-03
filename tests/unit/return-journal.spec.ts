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
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0]).toMatchObject({aircraftId:'1',origin:'AAA',flightId:'flight-1',reviewedAt:now.toISOString(),decision:'keep_route',reviewEvidence:{trigger:'return',reviewedRouteId:'current',selectedRouteId:'current',result:'keep_route'}});
  expect(saved.entries[0].reviewEvidence.routePerformance).toEqual([{routeId:'current',viable:true,netProfit:217400,netProfitPerHour:54350,occupancyPercentages:[100,100]}]);
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

test('legacy entry remains valid while new entries append enriched evidence',async()=>{
  const p=join(directory,'return-journal.json');
  await writeFile(p,JSON.stringify({schemaVersion:1,scope:'company-test',entries:[{aircraftId:'1',origin:'AAA',flightId:'legacy',reviewedAt:'2026-09-29T11:00:00.000Z',decision:'keep_route'}]}));
  expect((await reviewWithReturnJournal(input('flight-new'),options(),now)).decision).toBe('keep_route');
  const saved=JSON.parse(await readFile(p,'utf8'));
  expect(saved.entries[0]).toEqual({aircraftId:'1',origin:'AAA',flightId:'legacy',reviewedAt:'2026-09-29T11:00:00.000Z',decision:'keep_route'});
  expect(saved.entries[1].reviewEvidence).toMatchObject({trigger:'return',reviewedRouteId:'current',result:'keep_route'});
});

test('confirmed departure history is append-only and deduplicated by run aircraft route',async()=>{
  await reviewWithReturnJournal(input(),options(),now);
  const {appendConfirmedDepartures}=await import('../../optimization/return-journal');
  const report:any={entries:[{aircraftId:'1',registration:'TEST-1',routeId:'current',from:'AAA',to:'BBB',status:'departed',reason:'NATIVE_INFLIGHT_IDENTITY_COUNTDOWN_AND_ONBOARD_CONFIRMED',
    actualOnboard:{Y:88,J:0,F:0},demand:{availableBefore:{Y:100,J:0,F:0},possiblePassengers:{Y:100,J:0,F:0},occupancyPercentage:100}}]};
  expect(await appendConfirmedDepartures(directory,'company-test','123',report,now)).toBe(1);
  expect(await appendConfirmedDepartures(directory,'company-test','123',report,now)).toBe(0);
  const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));
  expect(saved.events).toEqual([{eventId:'dep_123_1_current',type:'departure',aircraftId:'1',registration:'TEST-1',routeId:'current',from:'AAA',to:'BBB',observedAt:now.toISOString(),result:'departed',demand:{availableBefore:{Y:100,J:0,F:0},possiblePassengers:{Y:100,J:0,F:0},occupancyPercentage:100},actualOnboard:{Y:88,J:0,F:0}}]);
});
test('hold and uncertain departure never become confirmed history',async()=>{
  await reviewWithReturnJournal(input(),options(),now);const {appendConfirmedDepartures}=await import('../../optimization/return-journal');
  expect(await appendConfirmedDepartures(directory,'company-test','124',{entries:[{status:'held'},{status:'outcome_unknown'}]} as any,now)).toBe(0);
  const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));expect(saved.events).toBeUndefined();
});

test('verified supply observations append once per run and kind',async()=>{
 await reviewWithReturnJournal(input(),options(),now);const {appendSupplyObservation}=await import('../../optimization/return-journal');
 const snap={pricePer1000:500,holding:1000,remainingCapacity:2000,balance:3000};
 expect(await appendSupplyObservation(directory,'company-test','200','fuel',snap,now)).toBe(true);
 expect(await appendSupplyObservation(directory,'company-test','200','fuel',snap,now)).toBe(false);
 expect(await appendSupplyObservation(directory,'company-test','200','co2',{...snap,pricePer1000:110},now)).toBe(true);
 const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));expect(saved.supplyObservations).toHaveLength(2);expect(saved.supplyObservations[0]).toMatchObject({eventId:'sup_200_fuel',kind:'fuel',pricePer1000:500});
});

test('verified demand holds append only when executor observed insufficient demand',async()=>{
 await reviewWithReturnJournal(input(),options(),now);const {appendDemandHoldObservations}=await import('../../optimization/return-journal');
 const report={entries:[{status:'held',aircraftId:'1',routeId:'10',demand:{decision:'hold_insufficient',occupancyPercentage:25}},{status:'held',aircraftId:'2',routeId:'20',demand:null},{status:'departed',aircraftId:'3',routeId:'30',demand:{decision:'would_depart',occupancyPercentage:100}}]};
 expect(await appendDemandHoldObservations(directory,'company-test','300',report,now)).toBe(1);expect(await appendDemandHoldObservations(directory,'company-test','300',report,now)).toBe(0);
 const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));expect(saved.holdObservations).toEqual([{eventId:'hold_300_1_10',type:'demand-hold',aircraftId:'1',routeId:'10',observedAt:now.toISOString(),occupancyPercentage:25,reason:'hold_insufficient'}]);
});

test('verified variable KEEP closes daily review without consuming reroute decisions',async()=>{
 await reviewWithReturnJournal(input(),options(),now);const {appendVerifiedKeepRouteDecisions}=await import('../../optimization/return-journal');const tomorrow=new Date('2026-10-03T20:00:00Z');const fleet=[{aircraftId:'1',routeId:'10',from:'GRU',to:'SCL',state:'ready',issue:null}];const cycle={aircraftId:'1',from:'GRU',to:'SCL',comparisonReady:true,recurringCycleProfit:{expected:1000},recurringCycleProfitPerHour:{expected:500}};const candidates=[{aircraftId:'1',comparisonReady:true,variableCycleComparison:{status:'keep_current',comparisonReady:true,current:cycle}},{aircraftId:'1',comparisonReady:true,variableCycleComparison:{status:'keep_current',comparisonReady:true,current:cycle}}];const keep=[{aircraftId:'1',decision:'keep_route',selected:null,compared:2,reason:'NO_INSPECTED_CANDIDATE_PROVES_CONSERVATIVE_DOMINANCE'}];expect(await appendVerifiedKeepRouteDecisions(directory,'company-test',keep,candidates,fleet,new Map([['1','GRU']]),'America/Sao_Paulo',tomorrow)).toBe(1);expect(await appendVerifiedKeepRouteDecisions(directory,'company-test',keep,candidates,fleet,new Map([['1','GRU']]),'America/Sao_Paulo',tomorrow)).toBe(0);const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));expect(saved.entries.at(-1)).toMatchObject({aircraftId:'1',origin:'GRU',flightId:'daily_20261003',decision:'keep_route',reviewEvidence:{reviewedRouteId:'10',result:'keep_route'}});const reroute=[{...keep[0],decision:'would_reroute',selected:{from:'GRU',to:'AAA',airportId:'99'}}];expect(await appendVerifiedKeepRouteDecisions(directory,'company-test',reroute,candidates,fleet,new Map([['1','GRU']]),'America/Sao_Paulo',new Date('2026-10-04T20:00:00Z'))).toBe(0);
});

test('reroute review is persisted only after a fresh confirmed route id',async()=>{
 await reviewWithReturnJournal(input(),options(),now);const {appendConfirmedRerouteReviews}=await import('../../optimization/return-journal');const when=new Date('2026-10-05T20:00:00Z'),fleet=[{aircraftId:'1',routeId:'10',from:'GRU',to:'SCL',state:'ready',issue:null}],current={aircraftId:'1',from:'GRU',to:'SCL',comparisonReady:true,recurringCycleProfit:{expected:1000},recurringCycleProfitPerHour:{expected:500}},candidate={aircraftId:'1',from:'GRU',to:'AAA',comparisonReady:true,recurringCycleProfit:{expected:3000},recurringCycleProfitPerHour:{expected:900}};const decisions=[{aircraftId:'1',decision:'would_reroute',selected:{from:'GRU',to:'AAA',airportId:'99'},compared:1,dominating:1}],candidates=[{aircraftId:'1',from:'GRU',to:'AAA',airportId:'99',comparisonReady:true,variableCycleComparison:{status:'candidate_dominates',comparisonReady:true,current},candidateVariableCycle:candidate}],entry={aircraftId:'1',status:'rerouted',reason:'NATIVE_REROUTE_AND_FRESH_ROUTE_CONFIRMED',previousRouteId:'10',previousFrom:'GRU',previousTo:'SCL',targetFrom:'GRU',targetTo:'AAA',targetAirportId:'99',confirmedRouteId:'20'};expect(await appendConfirmedRerouteReviews(directory,'company-test',decisions,candidates,fleet,new Map([['1','GRU']]),{halted:false,entries:[{...entry,status:'outcome_unknown'}]},'America/Sao_Paulo',when)).toBe(0);expect(await appendConfirmedRerouteReviews(directory,'company-test',decisions,candidates,fleet,new Map([['1','GRU']]),{halted:false,entries:[entry]},'America/Sao_Paulo',when)).toBe(1);const saved=JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8'));expect(saved.entries.at(-1)).toMatchObject({flightId:'daily_20261005',decision:'would_reroute',reviewEvidence:{reviewedRouteId:'10',selectedRouteId:'20',result:'would_reroute'}});
});

test('modern daily KEEP does not duplicate a completed return review from the same day',async()=>{
 const {appendVerifiedKeepRouteDecisions}=await import('../../optimization/return-journal');const when=new Date('2026-10-06T20:00:00Z');await mkdir(directory,{recursive:true});await writeFile(join(directory,'return-journal.json'),JSON.stringify({schemaVersion:1,scope:'company-test',entries:[{aircraftId:'1',origin:'GRU',flightId:'flight_123',reviewedAt:'2026-10-06T15:00:00Z',decision:'keep_route'}]})+'\n');const fleet=[{aircraftId:'1',routeId:'10',from:'GRU',to:'SCL',state:'ready',issue:null}],cycle={aircraftId:'1',from:'GRU',to:'SCL',comparisonReady:true,recurringCycleProfit:{expected:1000},recurringCycleProfitPerHour:{expected:500}},candidates=[{aircraftId:'1',comparisonReady:true,variableCycleComparison:{status:'keep_current',comparisonReady:true,current:cycle}}],decisions=[{aircraftId:'1',decision:'keep_route',selected:null,compared:1,reason:'NO_INSPECTED_CANDIDATE_PROVES_CONSERVATIVE_DOMINANCE'}];expect(await appendVerifiedKeepRouteDecisions(directory,'company-test',decisions,candidates,fleet,new Map([['1','GRU']]),'America/Sao_Paulo',when)).toBe(0);
});
