import { test,expect } from '@playwright/test';
import { flightCountdownObservation } from '../../optimization/flight-timing';
const stamp='2026-10-01T12:00:00.000Z';
test('countdown estimates arrival across days without confirming return or future departure',()=>{
  expect(flightCountdownObservation('101','201','25:10:30',stamp)).toMatchObject({remainingSeconds:90630,
    arrivalEstimatedAt:'2026-10-02T13:10:30.000Z',futureDepartureAt:null,returnConfirmed:false,mutationAuthorized:false});
});
for(const text of ['00:00:00','-01:00:00','1:00:00','01:60:00','01:00:60','NaN','ETA 01:00:00'])
  test(`invalid or elapsed countdown cannot become timing evidence: ${text}`,()=>expect(flightCountdownObservation('101','201',text,stamp)).toBeNull());
test('identity and timestamp must be valid',()=>{
  for(const [id,route,time] of [['','201',stamp],['0','201',stamp],['101','x',stamp],['101','201','invalid']])
    expect(flightCountdownObservation(id,route,'00:18:37',time)).toBeNull();
});
