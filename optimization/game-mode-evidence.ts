import type { CandidateQuote } from './quote-reader';
import type { AircraftReferenceVariant } from './reference-data';

export interface GameModeEvidence {
  status:'verified'|'unavailable'|'conflict';
  mode:'easy'|'realism'|null;
  variantPriority:number|null;
  engineId:number|null;
  speedMultiplier:number|null;
  aCheckCostMultiplier:number|null;
  fuelTraining:number|null;
  observedSpeedKph:number|null;
  expectedSpeedKph:number|null;
  fareBaseMatches:boolean;
  speedMatches:boolean;
  fuelMatches:boolean;
  co2FactorMatches:boolean;
  source:'live-quote-crosschecked-community-formula';
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

const baseFares=(distance:number,mode:'easy'|'realism')=>mode==='easy'
  ? {Y:.4*distance+170,J:.8*distance+560,F:1.2*distance+1200}
  : {Y:.3*distance+150,J:.6*distance+500,F:.9*distance+1000};
const near=(a:number,b:number,tolerance:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
const matchingFuelTraining=(quote:CandidateQuote,variant:AircraftReferenceVariant)=>{
  const ciFuel=quote.costIndex/500+.6;
  const roundedDistance=Math.ceil(quote.distanceKm*100)/100;
  return [0,1,2,3].filter(t=>{
    const expected=variant.fuelLbsPerKm*roundedDistance*ciFuel*(1-t/100);
    // Training levels differ by 1%; keep the allowance tight so a fuel
    // observation can disambiguate equal-speed engine variants without guessing.
    return Math.abs(expected-quote.fuelLbs)<=Math.max(2,quote.fuelLbs*.001);
  });
};

export function inferGameModeEvidence(
  quote:CandidateQuote,
  variants:AircraftReferenceVariant[]
):GameModeEvidence {
  const base:GameModeEvidence={
    status:'unavailable',mode:null,variantPriority:null,engineId:null,speedMultiplier:null,aCheckCostMultiplier:null,
    fuelTraining:null,observedSpeedKph:null,expectedSpeedKph:null,fareBaseMatches:false,speedMatches:false,fuelMatches:false,co2FactorMatches:false,
    source:'live-quote-crosschecked-community-formula',reason:'EVIDENCE_INCOMPLETE',comparisonReady:false,mutationAuthorized:false
  };
  if(!quote.autopriceReference||!Number.isFinite(quote.distanceKm)||quote.distanceKm<=0||
    !Number.isFinite(quote.durationSeconds)||quote.durationSeconds<=0||
    !Number.isFinite(quote.costIndex)||quote.costIndex<0||quote.costIndex>200||
    !Array.isArray(variants)||!variants.length)return base;
  const fare=quote.autopriceReference.base;
  if(!fare||![fare.Y,fare.J,fare.F].every(Number.isFinite))return base;
  const fareModes=(['easy','realism'] as const).filter(mode=>{
    const expected=baseFares(quote.distanceKm,mode);
    return near(fare.Y,expected.Y,1.1)&&near(fare.J,expected.J,1.1)&&near(fare.F,expected.F,1.1);
  });
  if(fareModes.length!==1)return {...base,status:fareModes.length>1?'conflict':'unavailable',reason:'FARE_MODE_NOT_UNIQUE'};
  const mode=fareModes[0],speedMultiplier=mode==='easy'?1.5:1,aCheckCostMultiplier=mode==='easy'?1:2;
  const ciSpeed=.0035*quote.costIndex+.3;
  const observedSpeed=quote.distanceKm/(quote.durationSeconds/3600);
  const speedMatches=variants.filter(v=>v.modelId===quote.autopriceReference!.modelId&&Number.isFinite(v.speedKph)&&v.speedKph>0&&
    Math.abs(observedSpeed-v.speedKph*speedMultiplier*ciSpeed)/Math.max(1,observedSpeed)<=.015);
  if(!speedMatches.length)return {...base,status:'unavailable',mode,speedMultiplier,aCheckCostMultiplier,
    observedSpeedKph:observedSpeed,fareBaseMatches:true,reason:'AIRCRAFT_VARIANT_SPEED_MISMATCH'};

  // Some AM4 engine variants share the same cruise speed. A live quote also
  // exposes fuel consumption, so use the independently observed fuel formula
  // only to disambiguate those speed matches. If it is still not unique, fail closed.
  const fuelMatched=speedMatches.map(variant=>({variant,training:matchingFuelTraining(quote,variant)}))
    .filter(x=>x.training.length>0);
  const selected=speedMatches.length===1
    ? {variant:speedMatches[0],training:matchingFuelTraining(quote,speedMatches[0])}
    : fuelMatched.length===1 ? fuelMatched[0] : null;
  if(!selected)return {...base,status:'conflict',mode,speedMultiplier,aCheckCostMultiplier,
    observedSpeedKph:observedSpeed,fareBaseMatches:true,speedMatches:true,
    reason:fuelMatched.length?'AIRCRAFT_VARIANT_SPEED_FUEL_AMBIGUOUS':'AIRCRAFT_VARIANT_SPEED_AMBIGUOUS'};

  const variant=selected.variant,expectedSpeed=variant.speedKph*speedMultiplier*ciSpeed;
  const fuelCandidates=selected.training;
  const co2FactorMatches=near(quote.co2KgPerPaxKm,variant.co2KgPerPaxKm,1e-9);
  return {
    ...base,status:'verified',mode,variantPriority:variant.priority,engineId:variant.engineId,
    speedMultiplier,aCheckCostMultiplier,fuelTraining:fuelCandidates.length===1?fuelCandidates[0]:null,
    observedSpeedKph:observedSpeed,expectedSpeedKph:expectedSpeed,fareBaseMatches:true,speedMatches:true,
    fuelMatches:fuelCandidates.length>=1,co2FactorMatches,
    reason:fuelCandidates.length===1&&co2FactorMatches?'FARE_SPEED_FUEL_AND_CO2_CROSSCHECKED':
      co2FactorMatches?'FARE_SPEED_AND_CO2_CROSSCHECKED':'CO2_FACTOR_REFERENCE_MISMATCH',
  };
}
