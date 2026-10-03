import { test,expect } from '@playwright/test';
import { AircraftSnapshot,CollectionResult } from '../../demand/types';
import { CandidateQuote } from '../../optimization/quote-reader';
import { candidateReservationScenario,reservationConfig } from '../../optimization/reservations';
import { flightCountdownObservation } from '../../optimization/flight-timing';
const now=new Date('2026-10-01T12:00:00Z');
const quote={aircraftId:'1',registration:'SYNTHETIC-1',from:'AAA',to:'BBB',observedAt:now.toISOString()} as CandidateQuote;
function aircraft(id='1',state:AircraftSnapshot['state']='ready',reverse=false):AircraftSnapshot{return {
  aircraftId:id,registration:'SYNTHETIC-'+id,routeId:id,routeLabel:'AAA-BBB',from:reverse?'BBB':'AAA',to:reverse?'AAA':'BBB',state,
  capacity:{Y:40,J:10,F:0},remaining:{Y:200,J:50,F:0},dailyTotal:{Y:400,J:100,F:0},observedAt:now.toISOString(),
  operational:{rangeKm:5000,minRunwayFt:5000,flightHours:100,cycles:20,homeBase:null,flightId:null}};}
const collection=(...aircraft:AircraftSnapshot[]):CollectionResult=>({aircraft,complete:true,expectedRoutes:aircraft.length,warnings:[]});
test('first return-leg timing uses matching fresh countdown but cannot invent later departures',()=>{
 const b=aircraft('2','inflight');b.timing=flightCountdownObservation('2','2','00:18:37',now.toISOString());
 const r=candidateReservationScenario(quote,collection(aircraft(),b),now);
 expect(r.reservations[0]).toMatchObject({from:'BBB',to:'AAA',notBeforeEstimatedAt:'2026-10-01T12:18:37.000Z',availabilitySource:'flight-countdown-estimate'});
 expect(r.reservations[1]).toMatchObject({notBeforeEstimatedAt:null,availabilitySource:'unavailable'});
 expect(r.futureScheduleComplete).toBe(false);expect(r.futureCompetitionComplete).toBe(true);expect(r.comparisonReady).toBe(false);
});
for(const variant of ['identity','stale','inconsistent','elapsed'])test(`unverified countdown cannot schedule a reservation: ${variant}`,()=>{
 const b=aircraft('2','inflight');b.timing=flightCountdownObservation('2','2','00:18:37',now.toISOString())!;
 if(variant==='identity')b.timing.aircraftId='3';if(variant==='stale')b.timing.observedAt='2000-01-01T00:00:00Z';
 if(variant==='inconsistent')b.timing.arrivalEstimatedAt='2026-10-01T14:00:00Z';if(variant==='elapsed')b.timing.remainingSeconds=0;
 expect(candidateReservationScenario(quote,collection(aircraft(),b),now).reservations[0]).toMatchObject({notBeforeEstimatedAt:null,availabilitySource:'unavailable'});
});
test('reserves two future legs per other aircraft, excludes candidate, never consumes current onboard passengers',()=>{
 const data=collection(aircraft(),{...aircraft('2','inflight'),onboard:{Y:35,J:5,F:0}});
 const before=JSON.stringify(data);const r=candidateReservationScenario(quote,data,now);
 expect(r).toMatchObject({status:'scenario_only',forwardAfterReservations:{Y:120,J:30,F:0},comparisonReady:false,
  futureScheduleComplete:false,futureCompetitionComplete:true,demandNetOfOtherAircraft:true,currentFlightPassengersAlreadyDebited:true});
 expect(r.reservations.map(r=>[r.aircraftId,r.from,r.to])).toEqual([['2','BBB','AAA'],['2','AAA','BBB']]);
 expect(JSON.stringify(data)).toBe(before);expect(r.reservations.every(r=>r.aircraftId!=='1')).toBe(true);
});
test('airport-pair pool reuses the same verified forward balance for the return leg',()=>{
 const r=candidateReservationScenario(quote,collection(aircraft()),now,{nextLegs:2,poolScope:'airport-pair',maxAgeSeconds:300});
 expect(r).toMatchObject({
  status:'scenario_only',forwardAfterReservations:{Y:200,J:50,F:0},reverseAfterReservations:{Y:200,J:50,F:0},
  futureCompetitionComplete:true,demandNetOfOtherAircraft:true
 });
});
test('directional scenarios keep each direction separate and use reverse only for the next return flight',()=>{
 const data=collection(aircraft(),aircraft('2','inflight'),aircraft('3','ready',true));
 const r=candidateReservationScenario(quote,data,now,{nextLegs:1,poolScope:'directional',maxAgeSeconds:300});
 expect(r.forwardAfterReservations).toEqual({Y:200,J:50,F:0});expect(r.reverseAfterReservations).toEqual({Y:120,J:30,F:0});
});
test('same pair uses a conservative minimum instead of summing readings; exhausted classes remain zero',()=>{
 const a=aircraft('2','ready',true);a.remaining={Y:30,J:5,F:0};
 const r=candidateReservationScenario(quote,collection(aircraft(),a),now);
 expect(r.forwardAfterReservations).toEqual({Y:0,J:0,F:0});expect(r.reverseAfterReservations).toEqual({Y:0,J:0,F:0});
 expect(r.reservations[0].claimed).toEqual({Y:30,J:5,F:0});expect(r.reservations[1].claimed).toEqual({Y:0,J:0,F:0});
});
test('alternatives are independent scenarios and shuffled fleets give identical deterministic reservations',()=>{
 const a=aircraft(),b=aircraft('2'),c=aircraft('3');
 const first=candidateReservationScenario(quote,collection(a,b,c),now);
 expect(candidateReservationScenario(quote,collection(c,a,b),now)).toEqual(first);
 expect(candidateReservationScenario(quote,collection(a,b,c),now)).toEqual(first);
});
test('unknown forward demand never uses daily demand, zero A/C count, or reverse-only remaining',()=>{
 const a=aircraft();a.to='CCC';const b=aircraft('2','ready',true);
 const q={...quote,dailyDemand:{Y:1000,J:100,F:100},aircraftOnRoute:0};
 const r=candidateReservationScenario(q,collection(a,b),now);
 expect(r).toMatchObject({status:'remaining_unavailable',forwardAfterReservations:null});
 expect(candidateReservationScenario(q,collection(a),now)).toMatchObject({status:'remaining_unavailable',forwardAfterReservations:null,reason:'NO_EXISTING_ROUTE_OBSERVATION'});
});
for(const variant of ['incomplete','count','duplicate','route_duplicate','stale','future','unavailable','missing_capacity','missing_operational','issue','identity','overflow'])test(`unverified fleet blocks reservations: ${variant}`,()=>{
 const a=aircraft(),b=aircraft('2');const data=collection(a,b);
 if(variant==='incomplete')data.complete=false;if(variant==='count')data.expectedRoutes=3;
 if(variant==='duplicate')b.aircraftId=a.aircraftId;if(variant==='route_duplicate')b.routeId=a.routeId;
 if(variant==='stale')b.observedAt='2000-01-01T00:00:00Z';if(variant==='future')b.observedAt='2027-01-01T00:00:00Z';
 if(variant==='unavailable')b.state='unavailable';if(variant==='missing_capacity')b.capacity=null;
 if(variant==='missing_operational')b.operational=null;if(variant==='issue')b.issue='FAIL';if(variant==='identity')a.registration='OTHER';
 if(variant==='overflow')b.capacity={Y:Number.MAX_SAFE_INTEGER,J:1,F:0};
 expect(candidateReservationScenario(quote,data,now)).toMatchObject({status:'unavailable',forwardAfterReservations:null,reservations:[]});
});
test('configuration bounds and unknown pool scopes fail closed',()=>{
 for(const env of [{ROUTE_RESERVATION_NEXT_LEGS:'0'},{ROUTE_RESERVATION_NEXT_LEGS:'21'},{ROUTE_RESERVATION_NEXT_LEGS:'1.5'},
  {ROUTE_RESERVATION_POOL_SCOPE:'daily'},{DEMAND_MAX_AGE_SECONDS:'0'}])expect(()=>reservationConfig(env)).toThrow();
 expect(()=>candidateReservationScenario(quote,collection(aircraft()),now,{nextLegs:0,poolScope:'directional',maxAgeSeconds:300})).toThrow();
});


test('empty or absent injected pool scopes cannot silently default to another allocation policy',()=>{
 for(const poolScope of ['',undefined])expect(()=>candidateReservationScenario(quote,collection(aircraft()),now,
  {nextLegs:2,poolScope:poolScope as any,maxAgeSeconds:300})).toThrow('RESERVATION_CONFIG_INVALID');
});
