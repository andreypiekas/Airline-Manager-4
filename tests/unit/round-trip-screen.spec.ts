import { test, expect } from '@playwright/test';
import { CandidateQuote } from '../../optimization/quote-reader';
import { AirportCatalog, RouteCatalog } from '../../optimization/reference-data';
import { buildCandidateRoundTripScreen } from '../../optimization/round-trip-screen';

const now=new Date('2026-10-02T12:00:00Z');

function quote():CandidateQuote {
  return {
    aircraftId:'1',registration:'TEST',airportId:'99',from:'DTW',to:'WAW',
    observedAt:now.toISOString(),distanceKm:7259,durationSeconds:25000,fuelLbs:100000,
    co2KgPerPaxKm:.2,costIndex:200,routeFee:250000,aircraftOnRoute:0,
    dailyDemand:{Y:494,J:662,F:130},
    autopriceReference:{base:{Y:1000,J:2000,F:3000},modelId:1,effectiveFares:null},
    remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
  };
}
function catalog(routes:RouteCatalog['routes']):RouteCatalog {
  return {schemaVersion:1,source:'synthetic',sha256:'test',routes};
}

test('builds a partial round-trip envelope without inventing a reverse quote',()=>{
  const r=buildCandidateRoundTripScreen(
    quote(),
    catalog([{from:'WAW',to:'DTW',distanceKm:7258,referenceDemand:{Y:494,J:662,F:130},sourceRow:1}]),
    {
      forwardAfterReservations:{Y:400,J:200,F:100},
      reverseAfterReservations:{Y:300,J:100,F:50},
      futureScheduleComplete:false
    },
    now
  );
  expect(r.status).toBe('partial');
  expect(r.routeReference).toMatchObject({storedDirection:'WAW-DTW',distanceKm:7258,distanceDeltaKm:1});
  expect(r.returnLeg).toMatchObject({
    from:'WAW',to:'DTW',routeDistanceReferenceKm:7258,
    remainingAfterReservations:{Y:300,J:100,F:50},
    liveQuoteAvailable:false
  });
  expect(r.blockers).toContain('RETURN_LIVE_QUOTE_REQUIRED');
  expect(r.blockers).toContain('RETURN_EFFECTIVE_COSTS_REQUIRED');
  expect(r.blockers).toContain('FUTURE_COMPETITION_COVERAGE_INCOMPLETE');
  expect(r.comparisonReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
});

test('bounded conservative competition coverage removes the timetable blocker without fabricating reverse economics',()=>{
  const r=buildCandidateRoundTripScreen(
    quote(),
    catalog([{from:'WAW',to:'DTW',distanceKm:7258,referenceDemand:{Y:494,J:662,F:130},sourceRow:1}]),
    {
      forwardAfterReservations:{Y:400,J:200,F:100},
      reverseAfterReservations:{Y:300,J:100,F:50},
      futureScheduleComplete:false,
      futureCompetitionComplete:true
    },
    now
  );
  expect(r.blockers).not.toContain('FUTURE_COMPETITION_COVERAGE_INCOMPLETE');
  expect(r.blockers).toContain('RETURN_LIVE_QUOTE_REQUIRED');
  expect(r.comparisonReady).toBe(false);
});

test('catalogue alone is structural evidence and cannot create return demand',()=>{
  const r=buildCandidateRoundTripScreen(
    quote(),
    catalog([{from:'DTW',to:'WAW',distanceKm:7258,referenceDemand:{Y:494,J:662,F:130},sourceRow:2}]),
    {forwardAfterReservations:null,reverseAfterReservations:null,futureScheduleComplete:false},
    now
  );
  expect(r.status).toBe('structural_only');
  expect(r.returnLeg.remainingAfterReservations).toBeNull();
  expect(r.blockers).toContain('RETURN_REMAINING_DEMAND_UNAVAILABLE');
  expect(r.blockers).toContain('OUTBOUND_REMAINING_DEMAND_UNAVAILABLE');
});

test('cross-checked airport coordinates can replace a missing route spreadsheet distance only',()=>{
  const q=quote();
  q.from='AAA';q.to='BBB';q.airportId='99';q.distanceKm=111;
  const airports:AirportCatalog={schemaVersion:2,source:'fixture-airports',license:'MIT',generatedAt:'2026-10-02',airports:[
    {iata:'AAA',runwayFt:10000,lat:0,lng:0,sourceIds:[1]},
    {iata:'BBB',runwayFt:9000,lat:0,lng:1,sourceIds:[99]}
  ]};
  const r=buildCandidateRoundTripScreen(
    q,catalog([]),
    {forwardAfterReservations:null,reverseAfterReservations:null,futureScheduleComplete:false},
    now,300,airports
  );
  expect(r.status).toBe('structural_only');
  expect(r.routeReference).toBeNull();
  expect(r.distanceReference).toMatchObject({status:'cross_checked',distanceKm:111,destinationAirportIdMatches:true});
  expect(r.returnLeg.routeDistanceReferenceKm).toBe(111);
  expect(r.blockers).not.toContain('ROUTE_REFERENCE_UNAVAILABLE');
  expect(r.blockers).toContain('RETURN_LIVE_QUOTE_REQUIRED');
});
test('ambiguous route references are rejected',()=>{
  const ref={distanceKm:7258,referenceDemand:{Y:494,J:662,F:130}};
  const r=buildCandidateRoundTripScreen(
    quote(),
    catalog([
      {from:'DTW',to:'WAW',sourceRow:1,...ref},
      {from:'WAW',to:'DTW',sourceRow:2,...ref}
    ]),
    {forwardAfterReservations:null,reverseAfterReservations:null,futureScheduleComplete:false},
    now
  );
  expect(r.status).toBe('unavailable');
  expect(r.routeReference).toBeNull();
  expect(r.blockers).toContain('AMBIGUOUS_ROUTE_REFERENCE');
});

test('expired live quote blocks the cycle envelope',()=>{
  const q=quote();q.observedAt='2000-01-01T00:00:00Z';
  const r=buildCandidateRoundTripScreen(q,catalog([]),{forwardAfterReservations:null,reverseAfterReservations:null,futureScheduleComplete:false},now);
  expect(r.status).toBe('unavailable');
  expect(r.blockers).toEqual(['OUTBOUND_QUOTE_UNVERIFIED']);
});
