import { CandidateQuote } from './quote-reader';
import { CandidateEconomicScreen } from './economic-screen';

export interface CandidatePriorityReference {
  status:'rankable'|'unavailable';
  grossRevenueCeilingPerDeparture:number|null;
  knownRecurringCosts:{
    fuelAtMarketReplacementPrice:number|null;
    aCheckCatalogProration:number|null;
  };
  knownRecurringCostSubtotal:number|null;
  recurringKnownContributionCeiling:number|null;
  recurringKnownContributionCeilingPerHour:number|null;
  firstCycleKnownContributionCeiling:number|null;
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

const finite=(n:number|null|undefined):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

/**
 * Ranking aid only. This is deliberately an upper-bound contribution reference:
 * revenue uses the screening ceiling and costs include only the two independently
 * observed reference components that are currently available for this candidate.
 * It is never promoted to net profit and never authorizes reroute.
 */
export function candidatePriorityReference(
  quote:CandidateQuote,
  screening:CandidateEconomicScreen,
  costs:{fuelAtMarketReplacementPrice:number|null;aCheck:{catalogProration:number|null}}
):CandidatePriorityReference {
  const base:CandidatePriorityReference={
    status:'unavailable',
    grossRevenueCeilingPerDeparture:screening.grossRevenueCeilingPerDeparture,
    knownRecurringCosts:{
      fuelAtMarketReplacementPrice:costs.fuelAtMarketReplacementPrice,
      aCheckCatalogProration:costs.aCheck.catalogProration
    },
    knownRecurringCostSubtotal:null,
    recurringKnownContributionCeiling:null,
    recurringKnownContributionCeilingPerHour:null,
    firstCycleKnownContributionCeiling:null,
    reason:'',
    comparisonReady:false,
    mutationAuthorized:false
  };
  if(screening.status!=='screened'||screening.demandStatus!=='potentially_sufficient'||
    !finite(screening.grossRevenueCeilingPerDeparture)||!finite(costs.fuelAtMarketReplacementPrice)||
    !finite(costs.aCheck.catalogProration)||!finite(quote.routeFee)||
    !Number.isFinite(quote.durationSeconds)||quote.durationSeconds<=0){
    return {...base,reason:'PRIORITY_REFERENCE_INCOMPLETE'};
  }
  const knownRecurringCostSubtotal=costs.fuelAtMarketReplacementPrice+costs.aCheck.catalogProration;
  const recurringKnownContributionCeiling=screening.grossRevenueCeilingPerDeparture-knownRecurringCostSubtotal;
  const hours=quote.durationSeconds/3600;
  const perHour=recurringKnownContributionCeiling/hours;
  const firstCycle=recurringKnownContributionCeiling-quote.routeFee;
  if(![knownRecurringCostSubtotal,recurringKnownContributionCeiling,perHour,firstCycle].every(Number.isFinite))
    return {...base,reason:'PRIORITY_REFERENCE_NUMERIC_INVALID'};
  return {
    ...base,
    status:'rankable',
    knownRecurringCostSubtotal,
    recurringKnownContributionCeiling,
    recurringKnownContributionCeilingPerHour:perHour,
    firstCycleKnownContributionCeiling:firstCycle,
    reason:'SCREENING_UPPER_BOUND_WITH_FUEL_REPLACEMENT_AND_CATALOG_A_CHECK_ONLY'
  };
}

export function rankCandidatePriorities<T extends {priority:CandidatePriorityReference;from:string;to:string}>(candidates:T[]){
  return candidates
    .filter(c=>c.priority.status==='rankable')
    .slice()
    .sort((a,b)=>
      b.priority.recurringKnownContributionCeilingPerHour!-a.priority.recurringKnownContributionCeilingPerHour! ||
      a.to.localeCompare(b.to))
    .map((candidate,index)=>({
      rank:index+1,
      from:candidate.from,
      to:candidate.to,
      recurringKnownContributionCeilingPerHour:candidate.priority.recurringKnownContributionCeilingPerHour!,
      firstCycleKnownContributionCeiling:candidate.priority.firstCycleKnownContributionCeiling!
    }));
}
