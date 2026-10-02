import { test, expect } from '@playwright/test';
import { CandidateQuote } from '../../optimization/quote-reader';
import { screenCandidateEconomics } from '../../optimization/economic-screen';

const now = new Date('2026-10-02T12:00:00Z');

function quote(overrides: Partial<CandidateQuote> = {}): CandidateQuote {
  return {
    aircraftId:'1', registration:'TEST', airportId:'99', from:'AAA', to:'BBB',
    observedAt:now.toISOString(), distanceKm:1000, durationSeconds:7200, fuelLbs:10000,
    co2KgPerPaxKm:0.2, costIndex:200, routeFee:50000, aircraftOnRoute:0,
    dailyDemand:{Y:1000,J:100,F:100},
    autopriceReference:{base:{Y:1000,J:2000,F:3000},modelId:39,effectiveFares:null},
    remainingDemand:null, netProfit:null, comparisonReady:false, mutationAuthorized:false,
    ...overrides
  };
}

test('daily demand ceiling can prove threshold is reachable without claiming remaining demand',()=>{
  const r=screenCandidateEconomics(quote(),{Y:100,J:10,F:10},80,now);
  expect(r).toMatchObject({
    status:'screened',
    demandStatus:'potentially_sufficient',
    passengerCeiling:{Y:100,J:10,F:10},
    coverageCeilingPercent:100,
    adjustedFareReference:{Y:1100,J:2160,F:3180},
    grossRevenueCeilingPerDeparture:163400,
    firstDepartureAfterSetupFeeCeiling:113400,
    comparisonReady:false,
    mutationAuthorized:false
  });
});

test('candidate below threshold is rejected by ceiling even before remaining-demand research',()=>{
  const r=screenCandidateEconomics(
    quote({dailyDemand:{Y:60,J:0,F:0}}),
    {Y:100,J:0,F:0},
    80,
    now
  );
  expect(r.demandStatus).toBe('cannot_meet_threshold');
  expect(r.coverageCeilingPercent).toBe(60);
  expect(r.reason).toBe('DAILY_DEMAND_CEILING_BELOW_MINIMUM_COVERAGE');
});

test('daily demand is a ceiling only and never makes comparison actionable',()=>{
  const r=screenCandidateEconomics(quote({aircraftOnRoute:0}),{Y:100,J:10,F:10},80,now);
  expect(r.dailyDemandCeiling).toEqual({Y:1000,J:100,F:100});
  expect(r.comparisonReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
});

test('verified VIP effective fares can be used for read-only revenue ceiling',()=>{
  const r=screenCandidateEconomics(
    quote({autopriceReference:{base:{Y:1000,J:2000,F:3000},modelId:383,effectiveFares:{Y:1800,J:3600,F:5400}}}),
    {Y:100,J:10,F:10},
    80,
    now
  );
  expect(r).toMatchObject({
    status:'screened',
    demandStatus:'potentially_sufficient',
    adjustedFareReference:{Y:1980,J:3880,F:5720},
    grossRevenueCeilingPerDeparture:294000,
    firstDepartureAfterSetupFeeCeiling:244000,
    comparisonReady:false,
    mutationAuthorized:false
  });
});

test('VIP auto reference remains unavailable until its effective candidate fare is verified',()=>{
  const r=screenCandidateEconomics(
    quote({autopriceReference:{base:{Y:1000,J:2000,F:3000},modelId:371,effectiveFares:null}}),
    {Y:100,J:10,F:10},
    80,
    now
  );
  expect(r.status).toBe('screened');
  expect(r.adjustedFareReference).toBeNull();
  expect(r.grossRevenueCeilingPerDeparture).toBeNull();
});

for (const variant of ['stale','bad-capacity','bad-threshold'] as const) {
  test(`invalid screening context stays unavailable: ${variant}`,()=>{
    const q=quote();
    let capacity:any={Y:100,J:10,F:10};
    let threshold=80;
    if(variant==='stale')q.observedAt='2000-01-01T00:00:00Z';
    if(variant==='bad-capacity')capacity={Y:-1,J:0,F:0};
    if(variant==='bad-threshold')threshold=0;
    expect(screenCandidateEconomics(q,capacity,threshold,now).status).toBe('unavailable');
  });
}
