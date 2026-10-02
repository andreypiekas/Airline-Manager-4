import { test, expect } from '@playwright/test';
import type { AircraftSnapshot } from '../../demand/types';
import type { CandidateQuote } from '../../optimization/quote-reader';
import type { RouteCatalog } from '../../optimization/reference-data';
import { calibrateCo2FromFlightHistory, estimateObservedCo2Quotas } from '../../optimization/co2-calibration';

const now=new Date('2026-10-02T20:00:00Z');
const stamp=now.toISOString();
const distance=2615;
const factor=.16;
const fixed=.081;

function history(Y:number,J:number,F:number,from='GRU',to='SCL'){
  const weighted=Y+2*J+3*F;
  return {
    relativeTime:'1 hour ago',from,to,registrationLabel:'MC-21-400',
    co2Quotas:Math.round(distance*(factor*weighted+fixed)),
    onboard:{Y,J,F},fuelLbs:51176,revenue:100000
  };
}
function aircraft(entries= [
  history(120,4,3),
  history(117,4,3,'SCL','GRU'),
  history(0,6,4),
  history(100,10,1,'SCL','GRU'),
  history(0,0,0)
]):AircraftSnapshot{
  return {
    aircraftId:'1',registration:'MC-21-400',routeId:'10',routeLabel:'GRU-SCL',
    from:'GRU',to:'SCL',state:'ready',capacity:{Y:180,J:20,F:10},
    remaining:{Y:100,J:10,F:5},dailyTotal:{Y:200,J:20,F:10},observedAt:stamp,
    flightHistory:{
      status:'observed',observedAt:stamp,source:'inspected-aircraft-flight-history',
      complete:false,entries,comparisonReady:false,mutationAuthorized:false
    }
  };
}
function quote(co2=factor,to='AAA'):CandidateQuote{
  return {
    aircraftId:'1',registration:'MC-21-400',airportId:to==='AAA'?'100':'101',
    from:'GRU',to,observedAt:stamp,distanceKm:1000,durationSeconds:4000,fuelLbs:20000,
    co2KgPerPaxKm:co2,costIndex:200,routeFee:10000,aircraftOnRoute:0,
    dailyDemand:{Y:500,J:100,F:50},autopriceReference:null,
    remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
  };
}
function catalog(extra:RouteCatalog['routes']=[]):RouteCatalog{
  return {schemaVersion:1,source:'synthetic',sha256:'x',routes:[
    {from:'GRU',to:'SCL',distanceKm:distance,referenceDemand:{Y:1,J:1,F:1},sourceRow:1},
    ...extra
  ]};
}

test('verifies weighted cabin-unit CO2 formula from multiple observed mixes',()=>{
  const r=calibrateCo2FromFlightHistory(aircraft(),[quote()],catalog(),now);
  expect(r.status).toBe('verified_weighted_cabin_units');
  expect(r.formulaVerified).toBe(true);
  expect(r.quoteFactor).toBe(factor);
  expect(r.fixedQuotasPerKm).toBeCloseTo(fixed,3);
  expect(r.samples).toHaveLength(5);
  expect(r.weightedResidualSpread).toBeLessThanOrEqual(.025);
  expect(r.physicalResidualSpread).toBeGreaterThan(r.weightedResidualSpread!+.05);
  expect(r.comparisonReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
});

test('all-economy history cannot distinguish physical from weighted cabin units',()=>{
  const entries=[history(100,0,0),history(80,0,0),history(60,0,0),history(40,0,0)];
  const r=calibrateCo2FromFlightHistory(aircraft(entries),[quote(),quote(factor,'BBB')],catalog(),now);
  expect(r.status).toBe('insufficient');
  expect(r.formulaVerified).toBe(false);
  expect(r.reason).toBe('PREMIUM_CABIN_MIX_INSUFFICIENT_TO_DISTINGUISH_FORMULA');
});

test('economy-only aircraft verifies quota prediction by mathematical cabin equivalence',()=>{
  const entries=[
    history(12,0,0),history(11,0,0,'SCL','GRU'),history(10,0,0),history(8,0,0,'SCL','GRU')
  ];
  const a=aircraft(entries);
  a.capacity={Y:12,J:0,F:0};
  a.remaining={Y:12,J:0,F:0};
  a.dailyTotal={Y:100,J:0,F:0};
  const r=calibrateCo2FromFlightHistory(a,[quote()],catalog(),now);
  expect(r.status).toBe('verified_single_cabin_equivalence');
  expect(r.formulaVerified).toBe(true);
  expect(r.reason).toBe('LIVE_HISTORY_SUPPORTS_ECONOMY_ONLY_EQUIVALENT_FORMULA_WITH_STABLE_PER_KM_INTERCEPT');
  expect(estimateObservedCo2Quotas(r,1000,{Y:12,J:0,F:0})).not.toBeNull();
});
test('conflicting live quote factors fail closed',()=>{
  const r=calibrateCo2FromFlightHistory(aircraft(),[quote(.16),quote(.17,'BBB')],catalog(),now);
  expect(r.status).toBe('inconsistent');
  expect(r.formulaVerified).toBe(false);
  expect(r.reason).toBe('LIVE_QUOTE_CO2_FACTOR_CONFLICT');
});

test('ambiguous route catalogue prevents historical samples from being treated as calibrated',()=>{
  const duplicate={from:'SCL',to:'GRU',distanceKm:distance,referenceDemand:{Y:1,J:1,F:1},sourceRow:2};
  const r=calibrateCo2FromFlightHistory(aircraft(),[quote(),quote(factor,'BBB')],catalog([duplicate]),now);
  expect(r.status).toBe('insufficient');
  expect(r.samples).toHaveLength(0);
  expect(r.reason).toBe('TOO_FEW_RESOLVED_HISTORY_SAMPLES');
});

test('verified evidence estimates quota use but unavailable evidence never does',()=>{
  const r=calibrateCo2FromFlightHistory(aircraft(),[quote(),quote(factor,'BBB')],catalog(),now);
  expect(estimateObservedCo2Quotas(r,1000,{Y:100,J:5,F:2})).toBe(
    Math.round(1000*(r.fixedQuotasPerKm!+factor*(100+10+6)))
  );
  expect(estimateObservedCo2Quotas({...r,formulaVerified:false},1000,{Y:100,J:5,F:2})).toBeNull();
  expect(estimateObservedCo2Quotas(r,-1,{Y:100,J:5,F:2})).toBeNull();
});
