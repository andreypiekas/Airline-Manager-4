import { test,expect } from '@playwright/test';
import { calibrateDemandResetWindows,historicalRemainingForCandidate,relativeAgeMinutes } from '../../optimization/demand-reset-ledger';
import type { AircraftSnapshot, CollectionResult } from '../../demand/types';
import type { DemandLabelCalibrationReport } from '../../optimization/demand-label-calibration';

const stamp=new Date().toISOString();
const hist=(entries:any[])=>({status:'observed' as const,observedAt:stamp,source:'inspected-aircraft-flight-history' as const,complete:false as const,
  entries,comparisonReady:false as const,mutationAuthorized:false as const});
const ac=(id:string,entries:any[],cycles=50):AircraftSnapshot=>({
  aircraftId:id,registration:'AC-'+id,routeId:'R'+id,routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'ready',
  capacity:{Y:100,J:10,F:5},remaining:{Y:20,J:5,F:2},dailyTotal:{Y:100,J:10,F:5},observedAt:stamp,
  operational:{rangeKm:5000,minRunwayFt:5000,flightHours:100,cycles,homeBase:null,flightId:null},
  flightHistory:hist(entries)
});
const e=(age:string,from='AAA',to='BBB',Y=0,J=0,F=0)=>({relativeTime:age,from,to,registrationLabel:'X',co2Quotas:0,onboard:{Y,J,F},fuelLbs:0,revenue:0});
const labels=(sample:any):DemandLabelCalibrationReport=>({
  status:'observed',observedAt:stamp,samples:[sample],classification:'daily_total',comparisonReady:false,mutationAuthorized:false,uiRestored:true,warnings:[]
});

test('parses observed relative ages conservatively into minute buckets',()=>{
 expect(relativeAgeMinutes('4 hours ago')).toBe(240);
 expect(relativeAgeMinutes('1 day ago')).toBe(1440);
 expect(relativeAgeMinutes('23 minutes ago')).toBe(23);
 expect(relativeAgeMinutes('28 mins ago')).toBe(28);
 expect(relativeAgeMinutes('21 secs ago')).toBeCloseTo(21/60);
 expect(relativeAgeMinutes('59 seconds ago')).toBeCloseTo(59/60);
 expect(relativeAgeMinutes('a second ago')).toBeCloseTo(1/60);
 expect(relativeAgeMinutes('1 min ago')).toBe(1);
 expect(relativeAgeMinutes('2 hrs ago')).toBe(120);
 expect(relativeAgeMinutes('unknown')).toBeNull();
});

test('calibrates a reset boundary only when a whole history prefix exactly matches consumed demand',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:1,warnings:[],aircraft:[
  ac('1',[e('4 hours ago','AAA','BBB',30,2,1),e('8 hours ago','BBB','AAA',20,1,1),e('20 hours ago','AAA','BBB',30,2,1),e('23 hours ago','BBB','AAA',9,0,0)])
 ]};
 const report=labels({aircraftId:'1',registration:'AC-1',routeId:'R1',from:'AAA',to:'BBB',airportId:2,observedAt:stamp,
  quoteDemand:{Y:100,J:10,F:5},remaining:{Y:20,J:5,F:2},dailyTotal:{Y:100,J:10,F:5},currentRouteQuote:null,
  matchesRemaining:false,matchesDailyTotal:true});
 const r=calibrateDemandResetWindows(collection,report);
 expect(r.status).toBe('verified');
 expect(r.windows[0]).toMatchObject({pairKey:'AAA:BBB',includedMaxAgeMinutes:1200,excludedMinAgeMinutes:1380,consumed:{Y:80,J:5,F:3}});
});

test('full current demand creates a conservative reset-age upper bound',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:1,warnings:[],aircraft:[
  ac('1',[e('2 hours ago','AAA','BBB',20,2,1),e('8 hours ago','BBB','AAA',10,1,0),e('1 day ago','AAA','BBB',30,2,1)])
 ]};
 const report=labels({aircraftId:'1',registration:'AC-1',routeId:'R1',from:'AAA',to:'BBB',airportId:2,observedAt:stamp,
  quoteDemand:{Y:100,J:10,F:5},remaining:{Y:100,J:10,F:5},dailyTotal:{Y:100,J:10,F:5},currentRouteQuote:null,
  matchesRemaining:true,matchesDailyTotal:true});
 const r=calibrateDemandResetWindows(collection,report);
 expect(r).toMatchObject({status:'upper_bound_only',resetAgeUpperBoundMinutes:120});
 expect(r.upperBoundSources).toHaveLength(1);
});

test('unused candidate pair can be proven full inside a reset upper bound when fleet history covers it',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:2,warnings:[],aircraft:[
  ac('1',[e('30 minutes ago','AAA','BBB',20,2,1),e('3 hours ago','AAA','BBB',10,1,0)]),
  ac('2',[e('4 hours ago','EEE','FFF',10,1,0)])
 ]};
 const calibration:any={status:'upper_bound_only',windows:[],resetAgeUpperBoundMinutes:120,upperBoundSources:[],warnings:[],comparisonReady:false,mutationAuthorized:false};
 expect(historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration)).toMatchObject({
  status:'verified',remaining:{Y:100,J:20,F:10},consumedSinceReset:{Y:0,J:0,F:0},
  reason:'NO_PAIR_FLIGHT_WITHIN_VERIFIED_RESET_UPPER_BOUND'
 });
});

test('verified global upper bound can prove an untouched pair even when exact pair windows disagree',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:2,warnings:[],aircraft:[
  ac('1',[e('3 hours ago','AAA','BBB',20,2,1),e('5 hours ago','AAA','BBB',10,1,0)]),
  ac('2',[e('4 hours ago','EEE','FFF',10,1,0),e('6 hours ago','EEE','FFF',5,0,0)])
 ]};
 const calibration:any={status:'verified',windows:[
  {pairKey:'AAA:BBB',includedMaxAgeMinutes:60,excludedMinAgeMinutes:180,consumed:{Y:20,J:2,F:1},observedAt:stamp,sourceAircraftIds:['1']},
  {pairKey:'EEE:FFF',includedMaxAgeMinutes:120,excludedMinAgeMinutes:240,consumed:{Y:10,J:1,F:0},observedAt:stamp,sourceAircraftIds:['2']}
 ],resetAgeUpperBoundMinutes:120,upperBoundSources:[],warnings:[],comparisonReady:false,mutationAuthorized:false};
 expect(historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration)).toMatchObject({
  status:'verified',remaining:{Y:100,J:20,F:10},consumedSinceReset:{Y:0,J:0,F:0},
  reason:'NO_PAIR_FLIGHT_WITHIN_VERIFIED_RESET_UPPER_BOUND'
 });
});

test('candidate pair flight inside reset upper bound prevents assuming full demand',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:1,warnings:[],aircraft:[
  ac('1',[e('30 minutes ago','CCC','DDD',20,2,1),e('3 hours ago','AAA','BBB',10,1,0)])
 ]};
 const calibration:any={status:'upper_bound_only',windows:[],resetAgeUpperBoundMinutes:120,upperBoundSources:[],warnings:[],comparisonReady:false,mutationAuthorized:false};
 expect(historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration)).toMatchObject({
  status:'unavailable',reason:'PAIR_FLIGHT_INSIDE_RESET_UPPER_BOUND'
 });
});

test('different route flight spacing can still produce one conservative global reset intersection',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:2,warnings:[],aircraft:[
  ac('1',[e('2 hours ago','CCC','DDD',20,2,1),e('7 hours ago','AAA','BBB',1,0,0)]),
  ac('2',[e('7 hours ago','DDD','CCC',10,1,0),e('8 hours ago','EEE','FFF',1,0,0)])
 ]};
 const calibration={status:'verified' as const,windows:[
  {pairKey:'AAA:BBB',includedMaxAgeMinutes:180,excludedMinAgeMinutes:360,consumed:{Y:1,J:0,F:0},observedAt:stamp,sourceAircraftIds:['1']},
  {pairKey:'EEE:FFF',includedMaxAgeMinutes:180,excludedMinAgeMinutes:480,consumed:{Y:1,J:0,F:0},observedAt:stamp,sourceAircraftIds:['2']}
 ],resetAgeUpperBoundMinutes:null,upperBoundSources:[],warnings:[],comparisonReady:false as const,mutationAuthorized:false as const};
 const r=historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration);
 expect(r).toMatchObject({
  status:'verified',consumedSinceReset:{Y:20,J:2,F:1},remaining:{Y:80,J:18,F:9},
  resetWindow:{pairKey:'GLOBAL',includedMaxAgeMinutes:180,excludedMinAgeMinutes:360},
  reason:'FLEET_HISTORY_COVERS_GLOBAL_RESET_WINDOW_INTERSECTION'
 });
});

test('candidate flight inside global reset intersection gap remains ambiguous',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:1,warnings:[],aircraft:[
  ac('1',[e('4 hours ago','CCC','DDD',20,2,1),e('7 hours ago','AAA','BBB',1,0,0)])
 ]};
 const calibration={status:'verified' as const,windows:[
  {pairKey:'AAA:BBB',includedMaxAgeMinutes:180,excludedMinAgeMinutes:360,consumed:{Y:1,J:0,F:0},observedAt:stamp,sourceAircraftIds:['1']},
  {pairKey:'EEE:FFF',includedMaxAgeMinutes:120,excludedMinAgeMinutes:480,consumed:{Y:1,J:0,F:0},observedAt:stamp,sourceAircraftIds:['1']}
 ],resetAgeUpperBoundMinutes:null,upperBoundSources:[],warnings:[],comparisonReady:false as const,mutationAuthorized:false as const};
 expect(historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration)).toMatchObject({
  status:'unavailable',reason:'PAIR_FLIGHT_IN_RESET_BOUNDARY_GAP'
 });
});

test('candidate remaining is reconstructed only when every aircraft history covers the calibrated reset',()=>{
 const entries1=[e('2 hours ago','CCC','DDD',20,2,1),e('22 hours ago','AAA','BBB',1,0,0)];
 const entries2=[e('3 hours ago','DDD','CCC',10,1,0),e('23 hours ago','AAA','BBB',1,0,0)];
 const collection:CollectionResult={complete:true,expectedRoutes:2,warnings:[],aircraft:[ac('1',entries1),ac('2',entries2)]};
 const calibration={status:'verified' as const,windows:[{pairKey:'AAA:BBB',includedMaxAgeMinutes:1200,excludedMinAgeMinutes:1260,
  consumed:{Y:80,J:5,F:3},observedAt:stamp,sourceAircraftIds:['1']}],resetAgeUpperBoundMinutes:null,upperBoundSources:[],warnings:[],comparisonReady:false as const,mutationAuthorized:false as const};
 const r=historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration);
 expect(r).toMatchObject({status:'verified',consumedSinceReset:{Y:30,J:3,F:1},remaining:{Y:70,J:17,F:9},historyCoverageVerified:true});
});

test('history that does not extend beyond reset fails closed',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:1,warnings:[],aircraft:[ac('1',[e('2 hours ago','CCC','DDD',20,2,1),e('10 hours ago')],100)]};
 const calibration={status:'verified' as const,windows:[{pairKey:'AAA:BBB',includedMaxAgeMinutes:1200,excludedMinAgeMinutes:1260,
  consumed:{Y:80,J:5,F:3},observedAt:stamp,sourceAircraftIds:['1']}],resetAgeUpperBoundMinutes:null,upperBoundSources:[],warnings:[],comparisonReady:false as const,mutationAuthorized:false as const};
 expect(historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration)).toMatchObject({
  status:'unavailable',reason:'FLEET_HISTORY_DOES_NOT_COVER_RESET'
 });
});

test('candidate flight inside ambiguous reset boundary gap fails closed',()=>{
 const collection:CollectionResult={complete:true,expectedRoutes:1,warnings:[],aircraft:[ac('1',[e('20 hours ago','CCC','DDD',20,2,1),e('20 hours ago','AAA','BBB',1,0,0),e('21 hours ago','CCC','DDD',5,1,0),e('23 hours ago')])]};
 const calibration={status:'verified' as const,windows:[{pairKey:'AAA:BBB',includedMaxAgeMinutes:1200,excludedMinAgeMinutes:1380,
  consumed:{Y:80,J:5,F:3},observedAt:stamp,sourceAircraftIds:['1']}],resetAgeUpperBoundMinutes:null,upperBoundSources:[],warnings:[],comparisonReady:false as const,mutationAuthorized:false as const};
 expect(historicalRemainingForCandidate('CCC','DDD',{Y:100,J:20,F:10},collection,calibration)).toMatchObject({
  status:'unavailable',reason:'PAIR_FLIGHT_IN_RESET_BOUNDARY_GAP'
 });
});
