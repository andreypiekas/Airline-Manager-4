import { test,expect } from '@playwright/test';
import { candidateDemandEvidence } from '../../optimization/candidate-evidence';
import { AircraftSnapshot,CollectionResult } from '../../demand/types';
import { CandidateQuote } from '../../optimization/quote-reader';
const now=new Date('2026-10-01T12:00:00Z');
const quote={from:'GRU',to:'XAP',observedAt:now.toISOString()} as CandidateQuote;
function aircraft(id='1',reverse=false):AircraftSnapshot{return {aircraftId:id,registration:'SYNTHETIC',routeId:id,routeLabel:'GRU-XAP',from:reverse?'XAP':'GRU',to:reverse?'GRU':'XAP',state:'ready',capacity:{Y:44,J:9,F:0},remaining:{Y:100,J:20,F:0},dailyTotal:{Y:200,J:40,F:0},observedAt:now.toISOString(),operational:{rangeKm:2000,minRunwayFt:6000,flightHours:100,cycles:20,homeBase:null,flightId:null}};}
const collection=(...aircraft:AircraftSnapshot[]):CollectionResult=>({complete:true,expectedRoutes:aircraft.length,warnings:[],aircraft});
test('joins by direction and takes minimum across shared observations, never sums demand',()=>{
 const a=aircraft(),b=aircraft('2');b.remaining={Y:80,J:10,F:0};
 const r=candidateDemandEvidence(quote,collection(a,b,aircraft('3',true)),now);
 expect(r).toMatchObject({status:'direction_observed',remaining:{Y:80,J:10,F:0},reverseRemaining:{Y:100,J:20,F:0},comparisonReady:false,demandNetOfOtherAircraft:false});
 expect(r.sources).toHaveLength(3);
});
test('reverse-only source cannot supply demand for the candidate direction',()=>{
 expect(candidateDemandEvidence(quote,collection(aircraft('1',true)),now)).toMatchObject({status:'reverse_direction_only',remaining:null,reverseRemaining:{Y:100,J:20,F:0},reason:'REVERSE_DIRECTION_SHARING_UNCONFIRMED'});
});
test('no existing route does not convert daily demand or zero listed aircraft to remaining',()=>{
 const a=aircraft();a.to='BSB';expect(candidateDemandEvidence({...quote,dailyDemand:{Y:1000,J:50,F:10},aircraftOnRoute:0},collection(a),now).remaining).toBeNull();
});
test('verified fleet-history ledger can reconstruct pair remaining when no current route exists',()=>{
 const h=(relativeTime:string,from:string,to:string,Y:number,J:number,F:number)=>({relativeTime,from,to,registrationLabel:'X',co2Quotas:0,onboard:{Y,J,F},fuelLbs:0,revenue:0});
 const a=aircraft();a.to='BSB';a.operational!.cycles=2;a.flightHistory={status:'observed',observedAt:now.toISOString(),source:'inspected-aircraft-flight-history',complete:false,
  entries:[h('2 hours ago','GRU','XAP',20,2,0),h('23 hours ago','GRU','BSB',1,0,0)],comparisonReady:false,mutationAuthorized:false};
 const calibration:any={status:'verified',windows:[{pairKey:'AAA:BBB',includedMaxAgeMinutes:1200,excludedMinAgeMinutes:1260,
  consumed:{Y:80,J:5,F:3},observedAt:now.toISOString(),sourceAircraftIds:['1']}],warnings:[],comparisonReady:false,mutationAuthorized:false};
 const r=candidateDemandEvidence({...quote,dailyDemand:{Y:100,J:20,F:5}},collection(a),now,300,calibration);
 expect(r).toMatchObject({status:'historical_pair_reconstructed',remaining:{Y:80,J:18,F:5},reverseRemaining:{Y:80,J:18,F:5},
  reason:'HISTORICAL_PAIR_LEDGER_VERIFIED'});
});
for(const variant of ['stale','future','duplicate','missing','excess','negative','fraction','issue','unverified'])test(`invalid matching observations fail closed: ${variant}`,()=>{
 const a=aircraft();const c=collection(a);
 if(variant==='stale')a.observedAt='2000-01-01T00:00:00Z';if(variant==='future')a.observedAt='2027-01-01T00:00:00Z';
 if(variant==='duplicate')c.aircraft.push({...a});if(variant==='missing')a.remaining=null;if(variant==='excess')a.remaining!.Y=201;
 if(variant==='negative')a.remaining!.Y=-1;if(variant==='fraction')a.remaining!.Y=.5;if(variant==='issue')a.issue='DETAILS_UNAVAILABLE';if(variant==='unverified')a.operational=null;
 expect(candidateDemandEvidence(quote,c,now)).toMatchObject({status:'unavailable',remaining:null,reverseRemaining:null,sources:[]});
});
test('incomplete collection and expired quote block enrichment',()=>{
 expect(candidateDemandEvidence(quote,{...collection(aircraft()),complete:false},now).status).toBe('unavailable');
 expect(candidateDemandEvidence({...quote,observedAt:'2000-01-01T00:00:00Z'},collection(aircraft()),now).status).toBe('unavailable');
});
