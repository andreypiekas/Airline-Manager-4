import { test,expect } from '@playwright/test';
import type { CandidateQuote } from '../../optimization/quote-reader';
import type { Co2CalibrationEvidence } from '../../optimization/co2-calibration';
import type { ReverseLegEquivalentEvidence } from '../../optimization/reverse-leg-equivalence';
import { compareRouteVariableCycles,conservativeSharedPairRemaining,routeVariableRoundTripInterval } from '../../optimization/route-variable-cycle';

const now=new Date('2026-10-03T00:00:00Z'),stamp=now.toISOString();
const quote:CandidateQuote={
  aircraftId:'1',registration:'TEST',airportId:'2',from:'AAA',to:'BBB',observedAt:stamp,
  distanceKm:1000,durationSeconds:3600,fuelLbs:4000,co2KgPerPaxKm:.2,costIndex:200,routeFee:1000,aircraftOnRoute:0,
  dailyDemand:{Y:300,J:100,F:50},
  autopriceReference:{modelId:1,base:{Y:500,J:1000,F:1500},effectiveFares:{Y:500,J:1000,F:1500}},
  remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
};
const reverse:ReverseLegEquivalentEvidence={
  status:'verified',from:'BBB',to:'AAA',distanceKm:1000,durationSeconds:3600,fuelLbs:4000,co2KgPerPaxKm:.2,
  automaticFares:{Y:500,J:1000,F:1500},modelId:1,costIndex:200,
  source:'live-outbound-crosschecked-direction-symmetric-formula',
  checks:{directRoute:true,direction:true,airportDistance:true,gameMode:true,fareFormula:true,speedFormula:true,fuelFormula:true,co2Factor:true},
  reason:'verified',comparisonReady:false,mutationAuthorized:false
};
const co2:Co2CalibrationEvidence={
  aircraftId:'1',status:'verified_weighted_cabin_units',observedAt:stamp,quoteFactor:.2,fixedQuotasPerKm:.05,samples:[],
  weightedResidualSpread:0,physicalResidualSpread:.1,weightedMeanAbsoluteErrorRatio:0,physicalMeanAbsoluteErrorRatio:.1,
  formulaVerified:true,reason:'verified',comparisonReady:false,mutationAuthorized:false
};
const market={commodity:'co2' as const,pricePer1000:100,unit:'quotas' as const,observedAt:stamp,source:'inspected-market' as const,inventoryAcquisitionPrice:null};
const costs={
  fuelAtMarketReplacementPrice:2000,
  aCheck:{catalogProration:500,modeVerified:true},
  wearRepairReference:{expectedPerDepartureAtTraining0:100,expectedPerDepartureAtTraining5:90,acquisitionCost:100000,effectiveCostConfirmed:false}
};
const load={verified:true,expectedAggregate:.8,confidence95Low:.7,confidence95High:.9};

test('shared pair evidence uses the conservative minimum per cabin',()=>{
  expect(conservativeSharedPairRemaining({Y:200,J:50,F:20},{Y:180,J:60,F:10})).toEqual({Y:180,J:50,F:10});
  expect(conservativeSharedPairRemaining({Y:1,J:1,F:1},null)).toBeNull();
});

test('two-leg interval requires enough shared demand for both legs at high load',()=>{
  const ok=routeVariableRoundTripInterval(quote,{Y:100,J:20,F:10},{Y:200,J:50,F:30},{Y:1000,J:2000,F:3000},
    load,costs,co2,market,true,1000,reverse,true,now);
  expect(ok).toMatchObject({
    status:'verified_interval',comparisonReady:true,
    demand:{supportsTwoLegs:true,competitionComplete:true,requiredForTwoLegsAtHigh:{Y:180,J:36,F:18}}
  });
  expect(ok.recurringCycleProfit.low).toBeCloseTo(2*ok.leg.profit.low!);
  expect(ok.firstCycleAfterSetup.low).toBeCloseTo(ok.recurringCycleProfit.low!-1000);

  const lowDemand=routeVariableRoundTripInterval(quote,{Y:100,J:20,F:10},{Y:179,J:50,F:30},{Y:1000,J:2000,F:3000},
    load,costs,co2,market,true,1000,reverse,true,now);
  expect(lowDemand).toMatchObject({status:'unavailable',reason:'PAIR_DEMAND_DOES_NOT_SUPPORT_TWO_LEG_HIGH_LOAD'});
});

test('two-leg interval fails closed without reverse equivalence or competition coverage',()=>{
  expect(routeVariableRoundTripInterval(quote,{Y:100,J:20,F:10},{Y:300,J:100,F:50},{Y:1000,J:2000,F:3000},
    load,costs,co2,market,true,1000,null,true,now).status).toBe('unavailable');
  expect(routeVariableRoundTripInterval(quote,{Y:100,J:20,F:10},{Y:300,J:100,F:50},{Y:1000,J:2000,F:3000},
    load,costs,co2,market,true,1000,reverse,false,now).status).toBe('unavailable');
});

test('candidate reroute requires low-bound dominance over current high-bound and positive first cycle',()=>{
  const current=routeVariableRoundTripInterval(quote,{Y:100,J:20,F:10},{Y:300,J:100,F:50},{Y:700,J:1400,F:2100},
    load,costs,co2,market,true,0,reverse,true,now);
  const candidate=routeVariableRoundTripInterval({...quote,to:'CCC',airportId:'3',routeFee:1000},{Y:100,J:20,F:10},{Y:300,J:100,F:50},
    {Y:1400,J:2800,F:4200},load,costs,co2,market,true,1000,{...reverse,from:'CCC',to:'AAA'},true,now);
  const cmp=compareRouteVariableCycles(current,candidate,0);
  expect(cmp).toMatchObject({status:'candidate_dominates',comparisonReady:true,reason:'CANDIDATE_LOW_BOUND_DOMINATES_CURRENT_HIGH_BOUND_AND_FIRST_CYCLE_POSITIVE'});
  expect(cmp.deltaPerHour.conservativeLower).toBeGreaterThan(0);
});

test('overlapping profit intervals keep current route rather than claiming superiority',()=>{
  const current=routeVariableRoundTripInterval(quote,{Y:100,J:20,F:10},{Y:300,J:100,F:50},{Y:1000,J:2000,F:3000},
    load,costs,co2,market,true,0,reverse,true,now);
  const candidate=routeVariableRoundTripInterval({...quote,to:'CCC',airportId:'3'},{Y:100,J:20,F:10},{Y:300,J:100,F:50},
    {Y:1010,J:2020,F:3030},load,costs,co2,market,true,1000,{...reverse,from:'CCC',to:'AAA'},true,now);
  expect(compareRouteVariableCycles(current,candidate,0)).toMatchObject({status:'keep_current',comparisonReady:true});
});
