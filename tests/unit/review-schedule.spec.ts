import { test, expect } from '@playwright/test';
import { dailyReviewDue, reviewDay } from '../../optimization/review-schedule';
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
