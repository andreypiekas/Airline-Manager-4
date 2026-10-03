import { test,expect } from '@playwright/test';
import { candidateLoadEnvelope,currentRouteLoadEnvelope,routeVariableProfitInterval } from '../../optimization/route-variable-profit';
import type { CandidateQuote } from '../../optimization/quote-reader';
import type { Co2CalibrationEvidence } from '../../optimization/co2-calibration';
import type { CandidateLoadFactorEvidence,LoadFactorCalibrationEvidence } from '../../optimization/load-factor-calibration';

const now=new Date('2026-10-03T00:00:00Z'),stamp=now.toISOString();
const quote:CandidateQuote={
 aircraftId:'1',registration:'TEST',airportId:'2',from:'AAA',to:'BBB',observedAt:stamp,distanceKm:1000,durationSeconds:3600,
 fuelLbs:4000,co2KgPerPaxKm:.2,costIndex:200,routeFee:1000,aircraftOnRoute:0,dailyDemand:{Y:100,J:20,F:10},
 autopriceReference:{modelId:1,base:{Y:500,J:1000,F:1500},effectiveFares:{Y:500,J:1000,F:1500}},
 remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
};
const calibration:Co2CalibrationEvidence={
 aircraftId:'1',status:'verified_weighted_cabin_units',observedAt:stamp,quoteFactor:.2,calibratedFactorPerUnit:.2,fixedQuotasPerKm:.05,samples:[],
 weightedResidualSpread:0,physicalResidualSpread:.1,weightedMeanAbsoluteErrorRatio:0,physicalMeanAbsoluteErrorRatio:.1,
 formulaVerified:true,reason:'verified',comparisonReady:false,mutationAuthorized:false
};
const load={verified:true,expectedAggregate:.8,confidence95Low:.7,confidence95High:.9};
const costs={
 fuelAtMarketReplacementPrice:2000,
 aCheck:{catalogProration:500,modeVerified:true},
 wearRepairReference:{expectedPerDepartureAtTraining0:100,expectedPerDepartureAtTraining5:90,acquisitionCost:100000,effectiveCostConfirmed:false}
};
const co2Market={commodity:'co2' as const,pricePer1000:100,unit:'quotas' as const,observedAt:stamp,source:'inspected-market' as const,inventoryAcquisitionPrice:null};

test('builds conservative route-variable profit interval from four verified components',()=>{
 const r=routeVariableProfitInterval(quote,{Y:100,J:20,F:10},{Y:100,J:20,F:10},{Y:1000,J:2000,F:3000},
  load,costs,calibration,co2Market,true,1000,now);
 expect(r.status).toBe('verified_interval');
 expect(r.demandSupportsInterval).toBe(true);
 expect(r.componentSet).toEqual(['fuel','co2','aCheck','repair']);
 expect(r.revenue.low).toBeCloseTo(119000);
 expect(r.revenue.expected).toBeCloseTo(136000);
 expect(r.revenue.high).toBeCloseTo(153000);
 expect(r.profit.low).toBeLessThan(r.profit.expected!);
 expect(r.profit.expected).toBeLessThan(r.profit.high!);
 expect(r.firstCycleAfterSetup.low).toBeCloseTo(r.profit.low!-1000);
 expect(r.comparisonReady).toBe(false);expect(r.mutationAuthorized).toBe(false);
});

test('demand must support the entire 95 percent load interval',()=>{
 const r=routeVariableProfitInterval(quote,{Y:100,J:20,F:10},{Y:80,J:20,F:10},{Y:1000,J:2000,F:3000},
  load,costs,calibration,co2Market,true,1000,now);
 expect(r).toMatchObject({status:'unavailable',demandSupportsInterval:false,reason:'REMAINING_DEMAND_DOES_NOT_SUPPORT_LOAD_INTERVAL'});
});

test('unverified repair reference or game mode fails closed',()=>{
 const badCost={...costs,aCheck:{catalogProration:500,modeVerified:false}};
 expect(routeVariableProfitInterval(quote,{Y:100,J:20,F:10},{Y:100,J:20,F:10},{Y:1000,J:2000,F:3000},
  load,badCost,calibration,co2Market,true,1000,now).status).toBe('unavailable');
 expect(routeVariableProfitInterval(quote,{Y:100,J:20,F:10},{Y:100,J:20,F:10},{Y:1000,J:2000,F:3000},
  load,costs,calibration,co2Market,false,1000,now).status).toBe('unavailable');
});

test('load-envelope adapters preserve only verified intervals',()=>{
 const c={aircraftId:'1',from:'AAA',to:'BBB',verified:true,expectedByCabin:{Y:.8,J:.8,F:.8},expectedAggregate:.8,
  confidence95Low:.7,confidence95High:.9,source:'current-fare-history-transferred-to-direct-alpha-above-one',
  reason:'verified',comparisonReady:false,mutationAuthorized:false} as CandidateLoadFactorEvidence;
 expect(candidateLoadEnvelope(c)).toEqual({verified:true,expectedAggregate:.8,confidence95Low:.7,confidence95High:.9});
 const l={aircraftId:'1',status:'verified_current_fare_empirical',observedAt:stamp,sampleCount:5,samples:[],expectedLoadFactor:.8,
  standardDeviation:.05,confidence95Low:.7,confidence95High:.9,estimatedDirectAlphaAboveOneReputation:88,demandHeadroomTrips:5,
  currentFarePolicyVerified:true,currentRouteDirectModelVerified:true,source:'flight-history-current-fare-and-direct-model-crosscheck',
  reason:'verified',comparisonReady:false,mutationAuthorized:false} as LoadFactorCalibrationEvidence;
 expect(currentRouteLoadEnvelope(l)).toEqual({verified:true,expectedAggregate:.8,confidence95Low:.7,confidence95High:.9});
});
