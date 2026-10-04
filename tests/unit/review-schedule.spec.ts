import { test, expect } from '@playwright/test';
import { dailyReviewDue, reviewDay, routeReviewTrigger } from '../../optimization/review-schedule';
import { configuredAircraftOrigins } from '../../optimization/aircraft-origins';
import { Journal } from '../../optimization/return-journal';
const journal: Journal = {schemaVersion:1,scope:'test',entries:[{aircraftId:'1',origin:'GRU',flightId:'real-flight-1',reviewedAt:'2026-09-30T03:10:00Z',decision:'keep_route'}]};
test('Sao Paulo calendar changes at 03:00 UTC, not UTC midnight',()=>{
  expect(reviewDay(new Date('2026-09-30T02:59:59Z'))).toBe('2026-09-29');
  expect(reviewDay(new Date('2026-09-30T03:00:00Z'))).toBe('2026-09-30');
});
test('completed return review satisfies today; other aircraft and origins remain due',()=>{
  const now=new Date('2026-09-30T12:00:00Z');
  expect(dailyReviewDue('1','GRU',journal,now)).toBe(false);
  expect(dailyReviewDue('2','GRU',journal,now)).toBe(true);
  expect(dailyReviewDue('1','DTW',journal,now)).toBe(true);
  expect(dailyReviewDue('1','GRU',null,now)).toBe(true);
  expect(dailyReviewDue('1','GRU',journal,new Date('2026-10-01T03:00:00Z'))).toBe(true);
});
test('invalid timezone rejected before browser login',()=>expect(()=>reviewDay(new Date(),'invalid-zone')).toThrow());
test('BC-605 explicit GRU origin is stable and operator override has priority',()=>{
  expect(configuredAircraftOrigins('[]').get('22316469')).toBe('GRU');
  expect(configuredAircraftOrigins('[{"aircraftId":"22316469","origin":"XAP"}]').get('22316469')).toBe('XAP');
});


test('new confirmed return after an earlier same-day review becomes immediately due',()=>{
 const departure:any={eventId:'dep_1',type:'departure',aircraftId:'1',registration:'A',routeId:'10',from:'SCL',to:'GRU',
  observedAt:'2026-09-30T14:00:00Z',result:'departed',
  demand:{availableBefore:{Y:100,J:0,F:0},possiblePassengers:{Y:100,J:0,F:0},occupancyPercentage:100},actualOnboard:{Y:100,J:0,F:0}};
 const arrival:any={eventId:'arr_dep_1',type:'arrival-observed',departureEventId:'dep_1',aircraftId:'1',registration:'A',routeId:'10',
  from:'SCL',to:'GRU',departedAt:departure.observedAt,observedAt:'2026-09-30T16:00:00Z',result:'arrived_observed'};
 const before:Journal={schemaVersion:1,scope:'test',entries:[{aircraftId:'1',origin:'GRU',flightId:'daily_20260930',
  reviewedAt:'2026-09-30T12:00:00Z',decision:'keep_route'}],events:[departure,arrival]};
 expect(routeReviewTrigger('1','GRU',before,new Date('2026-09-30T18:00:00Z'))).toEqual({
  due:true,trigger:'return',flightId:'arr_dep_1',reason:'CONFIRMED_RETURN_AFTER_LAST_REVIEW'
 });
 expect(dailyReviewDue('1','GRU',before,new Date('2026-09-30T18:00:00Z'))).toBe(true);
 const after:Journal={...before,entries:[...before.entries,{aircraftId:'1',origin:'GRU',flightId:'arr_dep_1',
  reviewedAt:'2026-09-30T17:00:00Z',decision:'keep_route'}]};
 expect(routeReviewTrigger('1','GRU',after,new Date('2026-09-30T18:00:00Z'))).toMatchObject({
  due:false,trigger:'none',reason:'REVIEW_ALREADY_COMPLETED'
 });
});

test('uncertain departure without confirmed arrival never creates a return trigger',()=>{
 const j:any={schemaVersion:1,scope:'test',entries:[{aircraftId:'1',origin:'GRU',flightId:'daily_20260930',
  reviewedAt:'2026-09-30T12:00:00Z',decision:'keep_route'}],events:[{
   eventId:'unc_1',type:'departure-uncertain',aircraftId:'1',registration:'A',routeId:'10',from:'GRU',to:'SCL',
   observedAt:'2026-09-30T14:00:00Z',result:'outcome_unknown',reason:'NO_RETRY',sourceRunId:'1'
  }]};
 expect(routeReviewTrigger('1','GRU',j,new Date('2026-09-30T18:00:00Z'))).toMatchObject({
  due:false,trigger:'none',reason:'REVIEW_ALREADY_COMPLETED'
 });
});
