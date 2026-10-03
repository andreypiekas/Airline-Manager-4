import type { AircraftSnapshot, Cabins } from '../demand/types';
import { CLASSES } from '../demand/types';
import { adjustedPaxFare } from '../pricing/ticket-pricing';
import type { CandidateQuote } from './quote-reader';
import type { AirportDistanceEvidence } from './reference-data';
import type { GameModeEvidence } from './game-mode-evidence';

export interface LoadFactorCalibrationSample {
  relativeTime:string;
  onboard:Cabins;
  revenue:number;
  revenueAtCurrentFares:number;
  aggregateLoadFactor:number;
}
export interface LoadFactorCalibrationEvidence {
  aircraftId:string;
  status:'verified_current_fare_empirical'|'insufficient'|'inconsistent';
  observedAt:string;
  sampleCount:number;
  samples:LoadFactorCalibrationSample[];
  expectedLoadFactor:number|null;
  standardDeviation:number|null;
  confidence95Low:number|null;
  confidence95High:number|null;
  estimatedDirectAlphaAboveOneReputation:number|null;
  demandHeadroomTrips:number|null;
  currentFarePolicyVerified:boolean;
  currentRouteDirectModelVerified:boolean;
  source:'flight-history-current-fare-and-direct-model-crosscheck';
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}
const round=(n:number)=>Math.round(n*1e9)/1e9;
const validCabins=(c:Cabins|null|undefined):c is Cabins=>!!c&&CLASSES.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0);
const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
const stdev=(xs:number[],m:number)=>Math.sqrt(xs.reduce((n,x)=>n+(x-m)**2,0)/xs.length);

/**
 * Calibrates the global passenger load factor only from historical flights that
 * can be proven to have used the aircraft's current fare values (revenue exactly
 * reproduces current fare × observed onboard). The current route must also
 * match the independently cross-checked direct distance/speed/fuel/CO2 model.
 *
 * This estimates expectation, not a guaranteed future load and never authorizes
 * a route mutation.
 */
export function calibrateCurrentFareLoadFactor(
  aircraft:AircraftSnapshot,
  currentQuote:CandidateQuote|null,
  currentMode:GameModeEvidence|null,
  currentDistance:AirportDistanceEvidence|null,
  minimumSamples=4
):LoadFactorCalibrationEvidence {
  const base:LoadFactorCalibrationEvidence={
    aircraftId:aircraft.aircraftId,status:'insufficient',observedAt:new Date().toISOString(),sampleCount:0,samples:[],
    expectedLoadFactor:null,standardDeviation:null,confidence95Low:null,confidence95High:null,
    estimatedDirectAlphaAboveOneReputation:null,demandHeadroomTrips:null,currentFarePolicyVerified:false,
    currentRouteDirectModelVerified:false,source:'flight-history-current-fare-and-direct-model-crosscheck',
    reason:'EVIDENCE_INCOMPLETE',comparisonReady:false,mutationAuthorized:false
  };
  if(!Number.isSafeInteger(minimumSamples)||minimumSamples<3||minimumSamples>30||aircraft.issue||
    aircraft.state!=='ready'||!validCabins(aircraft.capacity)||!validCabins(aircraft.dailyTotal)||
    !aircraft.fares?.automatic||!aircraft.fares.current||!currentQuote||!aircraft.flightHistory||
    aircraft.flightHistory.status!=='observed'||!Array.isArray(aircraft.flightHistory.entries))return base;
  const seats=CLASSES.reduce((n,k)=>n+aircraft.capacity![k],0);
  if(!Number.isSafeInteger(seats)||seats<=0)return base;

  let policy=false;
  try{
    policy=CLASSES.every(k=>aircraft.capacity![k]===0||
      aircraft.fares!.current![k]===adjustedPaxFare(aircraft.fares!.automatic![k],k));
  }catch{policy=false;}
  const direct=currentMode?.status==='verified'&&currentMode.fareBaseMatches&&currentMode.speedMatches&&
    currentMode.fuelMatches&&currentMode.co2FactorMatches&&currentQuote.routeDirectionEvidence?.verified===true&&
    currentDistance?.status==='cross_checked'&&currentDistance.destinationAirportIdMatches===true&&
    currentDistance.deltaKm!==null&&currentDistance.deltaKm<=1;
  const headroom=Math.min(...CLASSES.filter(k=>aircraft.capacity![k]>0).map(k=>aircraft.dailyTotal![k]/aircraft.capacity![k]));

  const samples:LoadFactorCalibrationSample[]=[];
  for(const h of aircraft.flightHistory.entries){
    if(!validCabins(h.onboard)||CLASSES.some(k=>h.onboard[k]>aircraft.capacity![k])||
      !Number.isSafeInteger(h.revenue)||h.revenue<0)continue;
    const expected=CLASSES.reduce((n,k)=>n+h.onboard[k]*aircraft.fares!.current![k],0);
    if(!Number.isSafeInteger(expected)||expected!==h.revenue)continue;
    const load=CLASSES.reduce((n,k)=>n+h.onboard[k],0)/seats;
    if(!Number.isFinite(load)||load<=0||load>1)continue;
    samples.push({relativeTime:h.relativeTime,onboard:{...h.onboard},revenue:h.revenue,
      revenueAtCurrentFares:expected,aggregateLoadFactor:round(load)});
  }

  if(!policy||!direct)return {...base,samples,sampleCount:samples.length,demandHeadroomTrips:round(headroom),
    currentFarePolicyVerified:policy,currentRouteDirectModelVerified:direct,
    status:'inconsistent',reason:!policy?'CURRENT_FARE_POLICY_NOT_VERIFIED':'CURRENT_ROUTE_DIRECT_MODEL_NOT_VERIFIED'};
  if(!Number.isFinite(headroom)||headroom<4)return {...base,samples,sampleCount:samples.length,demandHeadroomTrips:round(headroom),
    currentFarePolicyVerified:true,currentRouteDirectModelVerified:true,reason:'CURRENT_ROUTE_DEMAND_HEADROOM_TOO_LOW'};
  if(samples.length<minimumSamples)return {...base,samples,sampleCount:samples.length,demandHeadroomTrips:round(headroom),
    currentFarePolicyVerified:true,currentRouteDirectModelVerified:true,reason:'TOO_FEW_CURRENT_FARE_HISTORY_SAMPLES'};

  const loads=samples.map(s=>s.aggregateLoadFactor);
  if(new Set(loads.map(x=>x.toFixed(4))).size<3)return {...base,samples,sampleCount:samples.length,demandHeadroomTrips:round(headroom),
    currentFarePolicyVerified:true,currentRouteDirectModelVerified:true,status:'inconsistent',reason:'LOAD_VARIATION_INSUFFICIENT'};
  const m=mean(loads),sd=stdev(loads,m),se=sd/Math.sqrt(loads.length);
  const low=Math.max(0,m-1.96*se),high=Math.min(1,m+1.96*se);
  const reputation=m/0.0090435;
  if(!Number.isFinite(reputation)||reputation<0||reputation>100)return {...base,samples,sampleCount:samples.length,demandHeadroomTrips:round(headroom),
    currentFarePolicyVerified:true,currentRouteDirectModelVerified:true,status:'inconsistent',reason:'EMPIRICAL_LOAD_OUTSIDE_DIRECT_REPUTATION_MODEL'};
  return {...base,status:'verified_current_fare_empirical',samples,sampleCount:samples.length,
    expectedLoadFactor:round(m),standardDeviation:round(sd),confidence95Low:round(low),confidence95High:round(high),
    estimatedDirectAlphaAboveOneReputation:round(reputation),demandHeadroomTrips:round(headroom),
    currentFarePolicyVerified:true,currentRouteDirectModelVerified:true,
    reason:'CURRENT_FARE_HISTORY_SUPPORTS_DIRECT_ALPHA_ABOVE_ONE_EXPECTED_LOAD'};
}


export interface CandidateLoadFactorEvidence {
  aircraftId:string;from:string;to:string;
  verified:boolean;
  expectedByCabin:Cabins|null;
  expectedAggregate:number|null;
  confidence95Low:number|null;
  confidence95High:number|null;
  source:'current-fare-history-transferred-to-direct-alpha-above-one';
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

/**
 * Community evidence says a direct pax route priced above Auto uses the same
 * expected load factor independent of distance. Transfer is allowed only when
 * the candidate is separately proven direct and all active cabin prices remain
 * above the observed Auto reference.
 */
export function transferCurrentFareLoadFactor(
  calibration:LoadFactorCalibrationEvidence,
  quote:CandidateQuote,
  capacity:Cabins|null,
  adjustedFares:Cabins|null,
  directCandidateVerified:boolean
):CandidateLoadFactorEvidence {
  const base:CandidateLoadFactorEvidence={
    aircraftId:quote.aircraftId,from:quote.from,to:quote.to,verified:false,expectedByCabin:null,expectedAggregate:null,
    confidence95Low:null,confidence95High:null,
    source:'current-fare-history-transferred-to-direct-alpha-above-one',reason:'TRANSFER_EVIDENCE_INCOMPLETE',
    comparisonReady:false,mutationAuthorized:false
  };
  if(calibration.aircraftId!==quote.aircraftId||calibration.status!=='verified_current_fare_empirical'||
    calibration.expectedLoadFactor===null||calibration.confidence95Low===null||calibration.confidence95High===null||
    ![calibration.expectedLoadFactor,calibration.confidence95Low,calibration.confidence95High].every(Number.isFinite)||
    calibration.expectedLoadFactor<=0||calibration.expectedLoadFactor>1||calibration.confidence95Low<=0||
    calibration.confidence95High>1||calibration.confidence95Low>calibration.expectedLoadFactor||
    calibration.confidence95High<calibration.expectedLoadFactor||!validCabins(capacity)||!validCabins(adjustedFares)||
    !directCandidateVerified||!quote.autopriceReference)return base;
  const automatic=quote.autopriceReference.effectiveFares||quote.autopriceReference.base;
  if(!validCabins(automatic))return base;
  const aboveAuto=CLASSES.every(k=>capacity[k]===0||
    adjustedFares[k]>automatic[k]&&automatic[k]>0);
  if(!aboveAuto)return {...base,reason:'CANDIDATE_FARE_NOT_STRICTLY_ABOVE_AUTO'};
  const f=calibration.expectedLoadFactor;
  return {...base,verified:true,expectedAggregate:f,expectedByCabin:{Y:f,J:f,F:f},
    confidence95Low:calibration.confidence95Low,confidence95High:calibration.confidence95High,
    reason:'EMPIRICAL_CURRENT_FARE_LOAD_TRANSFERRED_TO_VERIFIED_DIRECT_ABOVE_AUTO_ROUTE'};
}
