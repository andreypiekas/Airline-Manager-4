import type { CandidateQuote } from './quote-reader';
import type { AirportDistanceEvidence } from './reference-data';
import type { GameModeEvidence } from './game-mode-evidence';
import type { RouteMutationControlEvidence } from './route-mutation-control';

export interface ReverseLegEquivalentEvidence {
  status:'verified'|'unavailable';
  from:string;
  to:string;
  distanceKm:number|null;
  durationSeconds:number|null;
  fuelLbs:number|null;
  co2KgPerPaxKm:number|null;
  automaticFares:{Y:number;J:number;F:number}|null;
  modelId:number|null;
  costIndex:number|null;
  source:'live-outbound-crosschecked-direction-symmetric-formula';
  checks:{
    directRoute:boolean;
    direction:boolean;
    airportDistance:boolean;
    gameMode:boolean;
    fareFormula:boolean;
    speedFormula:boolean;
    fuelFormula:boolean;
    co2Factor:boolean;
  };
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

/**
 * A direct route's distance, ticket formula, duration, fuel and aircraft CO2
 * factor are direction-symmetric in the independently cross-checked AM4 model.
 * This does NOT infer return demand, load, costs, or authorize reroute.
 */
export function reverseLegEquivalentEvidence(
  quote:CandidateQuote,
  airportDistance:AirportDistanceEvidence|null,
  mode:GameModeEvidence|null,
  control:RouteMutationControlEvidence|null
):ReverseLegEquivalentEvidence {
  const checks={
    directRoute:control?.directRouteVerified===true,
    direction:quote.routeDirectionEvidence?.verified===true,
    airportDistance:airportDistance?.status==='cross_checked'&&airportDistance.destinationAirportIdMatches===true&&
      airportDistance.deltaKm!==null&&airportDistance.deltaKm<=1,
    gameMode:mode?.status==='verified',
    fareFormula:mode?.fareBaseMatches===true,
    speedFormula:mode?.speedMatches===true,
    fuelFormula:mode?.fuelMatches===true,
    co2Factor:mode?.co2FactorMatches===true
  };
  const base:ReverseLegEquivalentEvidence={
    status:'unavailable',from:quote.to,to:quote.from,distanceKm:null,durationSeconds:null,fuelLbs:null,
    co2KgPerPaxKm:null,automaticFares:null,modelId:null,costIndex:null,
    source:'live-outbound-crosschecked-direction-symmetric-formula',checks,reason:'EQUIVALENCE_EVIDENCE_INCOMPLETE',
    comparisonReady:false,mutationAuthorized:false
  };
  if(!Object.values(checks).every(Boolean)||!quote.autopriceReference||
    !Number.isFinite(quote.distanceKm)||quote.distanceKm<=0||!Number.isFinite(quote.durationSeconds)||quote.durationSeconds<=0||
    !Number.isFinite(quote.fuelLbs)||quote.fuelLbs<0||!Number.isFinite(quote.co2KgPerPaxKm)||quote.co2KgPerPaxKm<=0||
    !Number.isFinite(quote.costIndex)||quote.costIndex<0||quote.costIndex>200)return base;
  const fares=quote.autopriceReference.effectiveFares||quote.autopriceReference.base;
  if(!fares||![fares.Y,fares.J,fares.F].every(n=>Number.isSafeInteger(n)&&n>=0))return base;
  return {
    ...base,status:'verified',distanceKm:quote.distanceKm,durationSeconds:quote.durationSeconds,fuelLbs:quote.fuelLbs,
    co2KgPerPaxKm:quote.co2KgPerPaxKm,automaticFares:{...fares},modelId:quote.autopriceReference.modelId,
    costIndex:quote.costIndex,reason:'DIRECT_OUTBOUND_MATCHES_DIRECTION_SYMMETRIC_FARE_SPEED_FUEL_AND_CO2_MODEL'
  };
}
