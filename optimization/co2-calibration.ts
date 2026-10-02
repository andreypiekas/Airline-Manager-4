import type { AircraftSnapshot } from '../demand/types';
import type { CandidateQuote } from './quote-reader';
import type { RouteCatalog } from './reference-data';

export interface Co2CalibrationSample {
  from:string;
  to:string;
  distanceKm:number;
  quotas:number;
  onboard:{Y:number;J:number;F:number};
  weightedCabinUnits:number;
  physicalPassengers:number;
  weightedResidualPerKm:number;
  physicalResidualPerKm:number;
}
export interface Co2CalibrationEvidence {
  aircraftId:string;
  status:'verified_weighted_cabin_units'|'insufficient'|'inconsistent';
  observedAt:string;
  quoteFactor:number|null;
  fixedQuotasPerKm:number|null;
  samples:Co2CalibrationSample[];
  weightedResidualSpread:number|null;
  physicalResidualSpread:number|null;
  weightedMeanAbsoluteErrorRatio:number|null;
  physicalMeanAbsoluteErrorRatio:number|null;
  formulaVerified:boolean;
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

const fresh=(stamp:string,now:Date,maxAgeSeconds:number)=>{
  const age=now.getTime()-Date.parse(stamp);
  return Number.isFinite(age)&&age>=0&&age<=maxAgeSeconds*1000;
};
const pair=(a:string,b:string,x:string,y:string)=>(a===x&&b===y)||(a===y&&b===x);
const spread=(values:number[])=>values.length?Math.max(...values)-Math.min(...values):null;
const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
const round=(value:number)=>Math.round(value*1e9)/1e9;

/**
 * Calibrates only a formula shape already evidenced by the game's own visible
 * flight history. It does not assume that "kg" and quota are interchangeable:
 * it checks whether the live quote factor plus Y+2J+3F and a stable per-km
 * intercept reproduce observed quota usage across multiple historical flights.
 */
export function calibrateCo2FromFlightHistory(
  aircraft:AircraftSnapshot,
  quotes:CandidateQuote[],
  catalog:RouteCatalog|null,
  now=new Date(),
  maxAgeSeconds=300
):Co2CalibrationEvidence {
  const base:Co2CalibrationEvidence={
    aircraftId:aircraft.aircraftId,status:'insufficient',observedAt:now.toISOString(),
    quoteFactor:null,fixedQuotasPerKm:null,samples:[],
    weightedResidualSpread:null,physicalResidualSpread:null,
    weightedMeanAbsoluteErrorRatio:null,physicalMeanAbsoluteErrorRatio:null,
    formulaVerified:false,reason:'EVIDENCE_INCOMPLETE',comparisonReady:false,mutationAuthorized:false
  };
  if(!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||!catalog||catalog.schemaVersion!==1||
    !Array.isArray(catalog.routes)||aircraft.issue||!aircraft.capacity||!aircraft.flightHistory||
    aircraft.flightHistory.status!=='observed'||!fresh(aircraft.observedAt,now,maxAgeSeconds)||
    !fresh(aircraft.flightHistory.observedAt,now,maxAgeSeconds)||!aircraft.flightHistory.entries.length)
    return base;

  const live=quotes.filter(q=>q.aircraftId===aircraft.aircraftId&&q.registration===aircraft.registration&&
    fresh(q.observedAt,now,maxAgeSeconds)&&Number.isFinite(q.co2KgPerPaxKm)&&q.co2KgPerPaxKm>0);
  if(live.length<2)return {...base,reason:'LIVE_QUOTE_FACTOR_CORROBORATION_MISSING'};
  const factors=[...new Set(live.map(q=>q.co2KgPerPaxKm))];
  if(factors.length!==1)return {...base,status:'inconsistent',reason:'LIVE_QUOTE_CO2_FACTOR_CONFLICT'};
  const factor=factors[0];

  const samples:Co2CalibrationSample[]=[];
  for(const h of aircraft.flightHistory.entries){
    if(!/^[A-Z0-9]{3}$/.test(h.from)||!/^[A-Z0-9]{3}$/.test(h.to)||h.from===h.to)continue;
    const refs=catalog.routes.filter(r=>!r.conflict&&pair(r.from,r.to,h.from,h.to)&&
      Number.isFinite(r.distanceKm)&&r.distanceKm>0);
    if(refs.length!==1)continue;
    const distanceKm=refs[0].distanceKm;
    const {Y,J,F}=h.onboard;
    if(![Y,J,F,h.co2Quotas].every(Number.isSafeInteger)||[Y,J,F,h.co2Quotas].some(n=>n<0))continue;
    if(Y>aircraft.capacity.Y||J>aircraft.capacity.J||F>aircraft.capacity.F)continue;
    const weightedCabinUnits=Y+2*J+3*F;
    const physicalPassengers=Y+J+F;
    const observedPerKm=h.co2Quotas/distanceKm;
    const weightedResidualPerKm=observedPerKm-factor*weightedCabinUnits;
    const physicalResidualPerKm=observedPerKm-factor*physicalPassengers;
    if(![observedPerKm,weightedResidualPerKm,physicalResidualPerKm].every(Number.isFinite))continue;
    samples.push({
      from:h.from,to:h.to,distanceKm,quotas:h.co2Quotas,onboard:{Y,J,F},
      weightedCabinUnits,physicalPassengers,
      weightedResidualPerKm:round(weightedResidualPerKm),
      physicalResidualPerKm:round(physicalResidualPerKm)
    });
  }
  if(samples.length<4)return {...base,quoteFactor:factor,samples,reason:'TOO_FEW_RESOLVED_HISTORY_SAMPLES'};

  const weightedResiduals=samples.map(s=>s.weightedResidualPerKm);
  const physicalResiduals=samples.map(s=>s.physicalResidualPerKm);
  const fixed=mean(weightedResiduals);
  const weightedErrors=samples.map(s=>Math.abs((s.distanceKm*(factor*s.weightedCabinUnits+fixed))-s.quotas)/Math.max(1,s.quotas));
  const physicalFixed=mean(physicalResiduals);
  const physicalErrors=samples.map(s=>Math.abs((s.distanceKm*(factor*s.physicalPassengers+physicalFixed))-s.quotas)/Math.max(1,s.quotas));
  const weightedSpread=spread(weightedResiduals)!;
  const physicalSpread=spread(physicalResiduals)!;
  const weightedMae=mean(weightedErrors);
  const physicalMae=mean(physicalErrors);
  const premiumMix=new Set(samples.map(s=>s.onboard.J+2*s.onboard.F)).size>=2&&samples.some(s=>s.onboard.J+s.onboard.F>0);
  const loadMix=new Set(samples.map(s=>s.weightedCabinUnits)).size>=3;

  const stable=Number.isFinite(fixed)&&fixed>=0&&weightedSpread<=0.025&&weightedMae<=0.005;
  const distinguishes=premiumMix&&loadMix&&(physicalSpread>=weightedSpread+0.05||physicalMae>=Math.max(0.002,weightedMae*2));
  const verified=stable&&distinguishes;
  return {
    ...base,
    status:verified?'verified_weighted_cabin_units':stable?'insufficient':'inconsistent',
    quoteFactor:factor,fixedQuotasPerKm:round(fixed),samples,
    weightedResidualSpread:round(weightedSpread),physicalResidualSpread:round(physicalSpread),
    weightedMeanAbsoluteErrorRatio:round(weightedMae),physicalMeanAbsoluteErrorRatio:round(physicalMae),
    formulaVerified:verified,
    reason:verified?'LIVE_HISTORY_SUPPORTS_WEIGHTED_CABIN_UNITS_WITH_STABLE_PER_KM_INTERCEPT':
      !stable?'WEIGHTED_FORMULA_NOT_STABLE':'PREMIUM_CABIN_MIX_INSUFFICIENT_TO_DISTINGUISH_FORMULA'
  };
}

export function estimateObservedCo2Quotas(
  evidence:Co2CalibrationEvidence,
  distanceKm:number,
  onboard:{Y:number;J:number;F:number}
):number|null {
  if(!evidence.formulaVerified||evidence.status!=='verified_weighted_cabin_units'||
    evidence.quoteFactor===null||evidence.fixedQuotasPerKm===null||
    !Number.isFinite(distanceKm)||distanceKm<=0||
    ![onboard.Y,onboard.J,onboard.F].every(Number.isSafeInteger)||[onboard.Y,onboard.J,onboard.F].some(n=>n<0))
    return null;
  const weighted=onboard.Y+2*onboard.J+3*onboard.F;
  const quotas=distanceKm*(evidence.fixedQuotasPerKm+evidence.quoteFactor*weighted);
  return Number.isFinite(quotas)&&quotas>=0?Math.round(quotas):null;
}
