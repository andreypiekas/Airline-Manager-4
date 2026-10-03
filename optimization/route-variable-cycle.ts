import type { Cabins } from '../demand/types';
import { CLASSES } from '../demand/types';
import type { CandidateQuote } from './quote-reader';
import type { Co2CalibrationEvidence } from './co2-calibration';
import type { MarketPriceReference } from './cost-reference-reader';
import type { ReverseLegEquivalentEvidence } from './reverse-leg-equivalence';
import {
  routeVariableProfitInterval,
  type RouteVariableCostReference,
  type RouteVariableProfitInterval,
} from './route-variable-profit';

type LoadEnvelope={
  verified:boolean;
  expectedAggregate:number|null;
  confidence95Low:number|null;
  confidence95High:number|null;
};

export interface RouteVariableCycleInterval {
  status:'verified_interval'|'unavailable';
  aircraftId:string;
  from:string;
  to:string;
  leg:RouteVariableProfitInterval;
  demand:{
    sharedPairRemaining:Cabins|null;
    requiredForTwoLegsAtHigh:Cabins|null;
    supportsTwoLegs:boolean;
    competitionComplete:boolean;
  };
  recurringCycleProfit:{low:number|null;expected:number|null;high:number|null};
  recurringCycleProfitPerHour:{low:number|null;expected:number|null;high:number|null};
  firstCycleAfterSetup:{low:number|null;expected:number|null;high:number|null};
  durationHours:number|null;
  source:'verified-direct-symmetric-two-leg-variable-model';
  reason:string;
  comparisonReady:boolean;
  mutationAuthorized:false;
}

export interface RouteVariableCycleComparison {
  status:'candidate_dominates'|'keep_current'|'unavailable';
  current:RouteVariableCycleInterval|null;
  candidate:RouteVariableCycleInterval|null;
  minImprovementPercent:number;
  deltaPerHour:{
    conservativeLower:number|null;
    expected:number|null;
    optimisticUpper:number|null;
  };
  requiredCandidateLowPerHour:number|null;
  firstCycleCandidateLow:number|null;
  reason:string;
  comparisonReady:boolean;
  mutationAuthorized:false;
}

const validCabins=(v:Cabins|null|undefined):v is Cabins=>!!v&&CLASSES.every(k=>Number.isSafeInteger(v[k])&&v[k]>=0);
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER;
const nonnegative=(n:unknown):n is number=>finite(n)&&n>=0;

export function conservativeSharedPairRemaining(forward:Cabins|null,reverse:Cabins|null):Cabins|null {
  if(!validCabins(forward)||!validCabins(reverse))return null;
  return {
    Y:Math.min(forward.Y,reverse.Y),
    J:Math.min(forward.J,reverse.J),
    F:Math.min(forward.F,reverse.F)
  };
}

/**
 * Builds one direct A→B→A cycle from a verified direction-symmetric route model.
 * The same conservative airport-pair demand pool must cover BOTH legs at the
 * high end of the empirical load interval. No reset is credited between legs.
 */
export function routeVariableRoundTripInterval(
  quote:CandidateQuote,
  capacity:Cabins|null,
  sharedPairRemaining:Cabins|null,
  fares:Cabins|null,
  load:LoadEnvelope,
  costs:RouteVariableCostReference,
  co2Calibration:Co2CalibrationEvidence|null,
  co2Market:MarketPriceReference|null,
  repairReferenceVerified:boolean,
  setupFee:number,
  reverseEquivalent:ReverseLegEquivalentEvidence|null,
  competitionComplete:boolean,
  now=new Date(),
  maxAgeSeconds=300
):RouteVariableCycleInterval {
  const unavailable=(leg:RouteVariableProfitInterval):RouteVariableCycleInterval=>({
    status:'unavailable',aircraftId:quote.aircraftId,from:quote.from,to:quote.to,leg,
    demand:{sharedPairRemaining:validCabins(sharedPairRemaining)?{...sharedPairRemaining}:null,
      requiredForTwoLegsAtHigh:null,supportsTwoLegs:false,competitionComplete},
    recurringCycleProfit:{low:null,expected:null,high:null},
    recurringCycleProfitPerHour:{low:null,expected:null,high:null},
    firstCycleAfterSetup:{low:null,expected:null,high:null},durationHours:null,
    source:'verified-direct-symmetric-two-leg-variable-model',reason:'ROUND_TRIP_VARIABLE_ECONOMICS_INCOMPLETE',
    comparisonReady:false,mutationAuthorized:false
  });
  const leg=routeVariableProfitInterval(quote,capacity,sharedPairRemaining,fares,load,costs,co2Calibration,co2Market,
    repairReferenceVerified,0,now,maxAgeSeconds);
  if(leg.status!=='verified_interval'||!validCabins(capacity)||!validCabins(sharedPairRemaining)||
    !nonnegative(setupFee)||!competitionComplete||reverseEquivalent?.status!=='verified'||
    reverseEquivalent.from!==quote.to||reverseEquivalent.to!==quote.from||
    reverseEquivalent.durationSeconds!==quote.durationSeconds||reverseEquivalent.fuelLbs!==quote.fuelLbs||
    reverseEquivalent.co2KgPerPaxKm!==quote.co2KgPerPaxKm||reverseEquivalent.costIndex!==quote.costIndex||
    load.confidence95High===null||!finite(load.confidence95High)||load.confidence95High<=0||load.confidence95High>1)
    return unavailable(leg);

  const high=load.confidence95High;
  const required={Y:0,J:0,F:0} as Cabins;
  for(const k of CLASSES){
    required[k]=capacity[k]===0?0:Math.ceil(2*capacity[k]*high);
    if(sharedPairRemaining[k]<required[k])
      return {...unavailable(leg),demand:{sharedPairRemaining:{...sharedPairRemaining},requiredForTwoLegsAtHigh:required,
        supportsTwoLegs:false,competitionComplete},reason:'PAIR_DEMAND_DOES_NOT_SUPPORT_TWO_LEG_HIGH_LOAD'};
  }
  const p=leg.profit,ph=leg.profitPerHour;
  if(![p.low,p.expected,p.high,ph.low,ph.expected,ph.high].every(finite))return unavailable(leg);
  const cycleLow=2*p.low!,cycleExpected=2*p.expected!,cycleHigh=2*p.high!;
  const hours=2*quote.durationSeconds/3600;
  const firstLow=cycleLow-setupFee,firstExpected=cycleExpected-setupFee,firstHigh=cycleHigh-setupFee;
  if(![cycleLow,cycleExpected,cycleHigh,hours,firstLow,firstExpected,firstHigh].every(finite)||hours<=0)return unavailable(leg);
  return {
    status:'verified_interval',aircraftId:quote.aircraftId,from:quote.from,to:quote.to,leg,
    demand:{sharedPairRemaining:{...sharedPairRemaining},requiredForTwoLegsAtHigh:required,supportsTwoLegs:true,competitionComplete:true},
    recurringCycleProfit:{low:cycleLow,expected:cycleExpected,high:cycleHigh},
    recurringCycleProfitPerHour:{low:cycleLow/hours,expected:cycleExpected/hours,high:cycleHigh/hours},
    firstCycleAfterSetup:{low:firstLow,expected:firstExpected,high:firstHigh},durationHours:hours,
    source:'verified-direct-symmetric-two-leg-variable-model',
    reason:'TWO_LEG_VARIABLE_PROFIT_INTERVAL_VERIFIED_WITH_SHARED_DEMAND_POOL',
    comparisonReady:true,mutationAuthorized:false
  };
}

/**
 * Conservative dominance: candidate low-bound profit/hour must exceed the
 * current route high-bound profit/hour by the configured margin, and even the
 * candidate low-bound first cycle must remain positive after the setup fee.
 */
export function compareRouteVariableCycles(
  current:RouteVariableCycleInterval|null,
  candidate:RouteVariableCycleInterval|null,
  minImprovementPercent=0
):RouteVariableCycleComparison {
  const base:RouteVariableCycleComparison={
    status:'unavailable',current,candidate,minImprovementPercent,
    deltaPerHour:{conservativeLower:null,expected:null,optimisticUpper:null},
    requiredCandidateLowPerHour:null,firstCycleCandidateLow:null,
    reason:'VARIABLE_CYCLE_COMPARISON_INCOMPLETE',comparisonReady:false,mutationAuthorized:false
  };
  if(!finite(minImprovementPercent)||minImprovementPercent<0||minImprovementPercent>100||
    current?.status!=='verified_interval'||candidate?.status!=='verified_interval'||
    !current.comparisonReady||!candidate.comparisonReady||
    current.aircraftId!==candidate.aircraftId||
    !finite(current.recurringCycleProfitPerHour.low)||!finite(current.recurringCycleProfitPerHour.expected)||
    !finite(current.recurringCycleProfitPerHour.high)||!finite(candidate.recurringCycleProfitPerHour.low)||
    !finite(candidate.recurringCycleProfitPerHour.expected)||!finite(candidate.recurringCycleProfitPerHour.high)||
    !finite(candidate.firstCycleAfterSetup.low))return base;

  const currentHigh=current.recurringCycleProfitPerHour.high!;
  const required=currentHigh+Math.abs(currentHigh)*minImprovementPercent/100;
  const conservative=candidate.recurringCycleProfitPerHour.low!-currentHigh;
  const expected=candidate.recurringCycleProfitPerHour.expected!-current.recurringCycleProfitPerHour.expected!;
  const optimistic=candidate.recurringCycleProfitPerHour.high!-current.recurringCycleProfitPerHour.low!;
  const dominates=candidate.recurringCycleProfitPerHour.low!>required&&candidate.firstCycleAfterSetup.low!>0;
  return {
    ...base,status:dominates?'candidate_dominates':'keep_current',
    deltaPerHour:{conservativeLower:conservative,expected,optimisticUpper:optimistic},
    requiredCandidateLowPerHour:required,firstCycleCandidateLow:candidate.firstCycleAfterSetup.low!,
    reason:dominates?'CANDIDATE_LOW_BOUND_DOMINATES_CURRENT_HIGH_BOUND_AND_FIRST_CYCLE_POSITIVE':
      'CONSERVATIVE_DOMINANCE_NOT_PROVEN',
    comparisonReady:true
  };
}
