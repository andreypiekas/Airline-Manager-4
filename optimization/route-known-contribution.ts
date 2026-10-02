import { Cabins, CLASSES } from '../demand/types';
import type { CandidateQuote } from './quote-reader';

export interface KnownContributionCostView {
  fuelAtMarketReplacementPrice:number|null;
  co2:{atDemandCeiling:number|null;quotaConversionConfirmed:boolean};
  aCheck:{catalogProration:number|null};
}
export interface KnownContributionLeg {
  status:'comparable_reference'|'unavailable';
  from:string;to:string;
  passengers:Cabins|null;
  fares:Cabins|null;
  grossRevenue:number|null;
  components:string[];
  knownRecurringCosts:number|null;
  knownContribution:number|null;
  knownContributionPerHour:number|null;
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}
export interface KnownContributionComparison {
  status:'comparable_reference'|'unavailable';
  current:KnownContributionLeg;
  candidate:KnownContributionLeg;
  componentSetMatches:boolean;
  deltaKnownContributionPerHour:number|null;
  candidateFirstCycleAfterSetupKnownContribution:number|null;
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

const validCabins=(c:Cabins|null|undefined):c is Cabins=>!!c&&CLASSES.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0);
const finite=(n:number|null|undefined):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

export function knownContributionLeg(
  quote:CandidateQuote,capacity:Cabins|null,remaining:Cabins|null,fares:Cabins|null,costs:KnownContributionCostView
):KnownContributionLeg{
  const base:KnownContributionLeg={
    status:'unavailable',from:quote.from,to:quote.to,passengers:null,fares:null,grossRevenue:null,components:[],
    knownRecurringCosts:null,knownContribution:null,knownContributionPerHour:null,reason:'REFERENCE_INCOMPLETE',
    comparisonReady:false,mutationAuthorized:false
  };
  if(!validCabins(capacity)||!validCabins(remaining)||!validCabins(fares)||
    !Number.isFinite(quote.durationSeconds)||quote.durationSeconds<=0)return base;
  const passengers={Y:Math.min(capacity.Y,remaining.Y),J:Math.min(capacity.J,remaining.J),F:Math.min(capacity.F,remaining.F)};
  if(!CLASSES.every(k=>capacity[k]===0||fares[k]>0))return base;
  const grossRevenue=CLASSES.reduce((n,k)=>n+passengers[k]*fares[k],0);
  if(!Number.isSafeInteger(grossRevenue)||grossRevenue<0)return base;
  if(!finite(costs.fuelAtMarketReplacementPrice)||!finite(costs.aCheck.catalogProration))return base;
  const components=['fuel','aCheck'];
  let knownRecurringCosts=costs.fuelAtMarketReplacementPrice+costs.aCheck.catalogProration;
  if(costs.co2.quotaConversionConfirmed&&finite(costs.co2.atDemandCeiling)){
    components.push('co2');knownRecurringCosts+=costs.co2.atDemandCeiling;
  }
  if(!Number.isFinite(knownRecurringCosts)||knownRecurringCosts<0)return base;
  const knownContribution=grossRevenue-knownRecurringCosts;
  const knownContributionPerHour=knownContribution/(quote.durationSeconds/3600);
  if(!Number.isFinite(knownContribution)||!Number.isFinite(knownContributionPerHour))return base;
  return {...base,status:'comparable_reference',passengers,fares:{...fares},grossRevenue,components,
    knownRecurringCosts,knownContribution,knownContributionPerHour,
    reason:'SAME_AIRCRAFT_REFERENCE_REVENUE_MINUS_VERIFIED_SHARED_COMPONENTS_ONLY'};
}

export function compareKnownContribution(
  current:KnownContributionLeg,candidate:KnownContributionLeg,setupFee:number
):KnownContributionComparison{
  const base:KnownContributionComparison={status:'unavailable',current,candidate,componentSetMatches:false,
    deltaKnownContributionPerHour:null,candidateFirstCycleAfterSetupKnownContribution:null,reason:'REFERENCE_INCOMPLETE',
    comparisonReady:false,mutationAuthorized:false};
  if(current.status!=='comparable_reference'||candidate.status!=='comparable_reference'||
    !Number.isFinite(setupFee)||setupFee<0)return base;
  const a=[...current.components].sort(),b=[...candidate.components].sort();
  const componentSetMatches=a.length===b.length&&a.every((v,i)=>v===b[i]);
  if(!componentSetMatches)return {...base,reason:'REFERENCE_COMPONENT_SET_MISMATCH'};
  const delta=candidate.knownContributionPerHour!-current.knownContributionPerHour!;
  const firstCycle=candidate.knownContribution!-setupFee;
  if(!Number.isFinite(delta)||!Number.isFinite(firstCycle))return base;
  return {...base,status:'comparable_reference',componentSetMatches:true,
    deltaKnownContributionPerHour:delta,candidateFirstCycleAfterSetupKnownContribution:firstCycle,
    reason:'REFERENCE_ONLY_NOT_FULL_NET_PROFIT'};
}
