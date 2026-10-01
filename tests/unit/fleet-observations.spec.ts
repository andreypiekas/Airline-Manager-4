import { test, expect } from '@playwright/test';
import { fleetObservations } from '../../optimization/fleet-observations';
import { AircraftSnapshot, CollectionResult } from '../../demand/types';
const now = new Date('2026-09-30T12:00:00Z');
function data(): CollectionResult {
  const a: AircraftSnapshot = { aircraftId:'1',routeId:'2',registration:'TEST',routeLabel:'GRU-XAP',from:'XAP',to:'GRU',
    state:'ready',capacity:{Y:12,J:0,F:0},remaining:{Y:495,J:474,F:72},dailyTotal:{Y:529,J:474,F:72},observedAt:now.toISOString(),
    operational:{rangeKm:10701,minRunwayFt:3780,flightHours:162,cycles:128,homeBase:null,flightId:null} };
  return {aircraft:[a],complete:true,expectedRoutes:1,warnings:[]};
}
test('reports actual position but never infers origin or a return from landed state',()=>{
  const r=fleetObservations(data(),new Map(),now);
  expect(r.missingOrigins).toBe(1);
  expect(r.aircraft[0]).toMatchObject({currentAirport:'XAP',destination:'GRU',operationalOrigin:null,
    detailsVerified:true,flightId:null,returnConfirmed:false,mutationAuthorized:false});
});
test('inflight position stays unknown and explicit origin is retained',()=>{
  const d=data();d.aircraft[0].state='inflight';
  const r=fleetObservations(d,new Map([['1','GRU'],['9','DTW']]),now);
  expect(r.aircraft[0]).toMatchObject({currentAirport:null,destination:'GRU',operationalOrigin:'GRU'});
  expect(r.configuredButNotObserved).toEqual(['9']);
});
for(const mode of ['duplicate','incomplete','stale','issue','missing-details'] as const) test(`unverified observations cannot expose a confirmed position: ${mode}`,()=>{
  const d=data();
  if(mode==='duplicate')d.aircraft.push({...d.aircraft[0]});
  if(mode==='incomplete')d.complete=false;
  if(mode==='stale')d.aircraft[0].observedAt='2026-09-29T12:00:00Z';
  if(mode==='issue')d.aircraft[0].issue='failed';
  if(mode==='missing-details')d.aircraft[0].operational=null;
  const r=fleetObservations(d,new Map(),now);
  expect(r.aircraft.every(a=>!a.detailsVerified&&a.currentAirport===null&&a.destination===null&&!a.returnConfirmed)).toBe(true);
});
