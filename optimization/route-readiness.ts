export interface CandidateComparisonReadinessInput {
  aircraftId:string;
  from:string;
  to:string;
  comparisonReady:boolean;
  mutationAuthorized:boolean;
  costsComplete:boolean;
  demand:{remaining:unknown|null};
  roundTrip:{comparisonReady:boolean;blockers:string[]};
  effectiveCosts:{complete:boolean;missing:string[]};
  createControl:null|{observed:boolean;phpEndpoints?:string[]};
  routeListenerDiagnostics:Array<{phpEndpoints:string[]}>;
  routeDirectionEvidence?:null|{verified:boolean;primaryMatchesContext:boolean;headerMatchesContext:boolean;independentSourcesAgree:boolean};
  runwayEvidence?:null|{status:'reference_verified'|'insufficient_reference'|'unavailable';adequate:boolean|null;
    originObserved:boolean;destinationObserved:boolean;originRunwayFt:number|null;destinationRunwayFt:number|null;requiredRunwayFt:number};
  runwayCrossChecked?:boolean;
  candidateLoadFactor?:null|{verified:boolean;expectedAggregate:number|null};
  routeProfitModel?:null|{verified:boolean};
  variableCycleComparison?:null|{comparisonReady:boolean;status:'candidate_dominates'|'keep_current'|'unavailable'};
  routeMutationControl:null|{nativeClickReady:boolean;endpointVerified:boolean;targetVerified:boolean;
    aircraftIdMatchesContext:boolean;airportIdMatchesContext:boolean};
}

export interface CandidateComparisonReadiness {
  aircraftId:string;
  from:string;
  to:string;
  comparisonReady:boolean;
  comparisonBlockers:string[];
  mutationReady:boolean;
  mutationBlockers:string[];
  mutationAuthorized:false;
}

/**
 * Converts the scattered evidence gaps into an explicit gate. It does not infer
 * missing economics and never authorizes a route mutation.
 */
export function assessCandidateComparisonReadiness(
  candidate:CandidateComparisonReadinessInput
):CandidateComparisonReadiness {
  const comparisonBlockers:string[]=[];
  const routeProfitModelVerified=candidate.routeProfitModel?.verified===true;
  const variableCycleReady=routeProfitModelVerified&&candidate.variableCycleComparison?.comparisonReady===true&&
    candidate.variableCycleComparison.status!=='unavailable';
  if(!routeProfitModelVerified)comparisonBlockers.push('ROUTE_PROFIT_MODEL_UNVERIFIED');
  if(!variableCycleReady){
    comparisonBlockers.push('VARIABLE_CYCLE_COMPARISON_UNAVAILABLE');
    if(!candidate.comparisonReady)comparisonBlockers.push('CANDIDATE_COMPARISON_NOT_READY');
    if(!candidate.roundTrip.comparisonReady)comparisonBlockers.push('ROUND_TRIP_COMPARISON_NOT_READY');
    if(!candidate.costsComplete)comparisonBlockers.push('FULL_COSTS_MISSING');
    if(!candidate.effectiveCosts.complete)comparisonBlockers.push(...candidate.effectiveCosts.missing.map(x=>'EFFECTIVE_COST:'+x));
    comparisonBlockers.push(...candidate.roundTrip.blockers.map(x=>'ROUND_TRIP:'+x));
    comparisonBlockers.push('CURRENT_ROUTE_FULL_ECONOMICS_MISSING');
  }
  if(!candidate.routeDirectionEvidence?.verified||!candidate.routeDirectionEvidence.primaryMatchesContext||
    !candidate.routeDirectionEvidence.headerMatchesContext||!candidate.routeDirectionEvidence.independentSourcesAgree)
    comparisonBlockers.push('ROUTE_DIRECTION_INDEPENDENT_EVIDENCE_MISSING');
  if(!candidate.demand.remaining)comparisonBlockers.push('OUTBOUND_DIRECTIONAL_REMAINING_DEMAND_MISSING');
  const runway=candidate.runwayEvidence;
  if(!runway||runway.status==='unavailable'||!runway.originObserved||!runway.destinationObserved)
    comparisonBlockers.push('RUNWAY_EVIDENCE_MISSING');
  else if(runway.adequate===false)
    comparisonBlockers.push('RUNWAY_REFERENCE_INSUFFICIENT');
  else if(candidate.runwayCrossChecked!==true)
    comparisonBlockers.push('RUNWAY_REFERENCE_ONLY_NEEDS_LIVE_CORROBORATION');
  if(!candidate.candidateLoadFactor?.verified||candidate.candidateLoadFactor.expectedAggregate===null||
    !Number.isFinite(candidate.candidateLoadFactor.expectedAggregate)||candidate.candidateLoadFactor.expectedAggregate<=0||
    candidate.candidateLoadFactor.expectedAggregate>1)
    comparisonBlockers.push('EXPECTED_LOAD_FACTOR_EVIDENCE_MISSING');
  const mutationBlockers:string[]=[];
  if(comparisonBlockers.length)mutationBlockers.push('COMPARISON_NOT_READY');
  if(!candidate.routeMutationControl?.endpointVerified)mutationBlockers.push('NATIVE_ROUTE_ENDPOINT_UNVERIFIED');
  if(!candidate.routeMutationControl?.targetVerified)mutationBlockers.push('NATIVE_ROUTE_TARGET_UNVERIFIED');
  if(!candidate.routeMutationControl?.aircraftIdMatchesContext)mutationBlockers.push('NATIVE_ROUTE_AIRCRAFT_CONTEXT_UNVERIFIED');
  if(!candidate.routeMutationControl?.airportIdMatchesContext)mutationBlockers.push('NATIVE_ROUTE_AIRPORT_CONTEXT_UNVERIFIED');
  if(!candidate.routeMutationControl?.nativeClickReady)mutationBlockers.push('NATIVE_ROUTE_MUTATION_CONTROL_UNVERIFIED');

  return {
    aircraftId:candidate.aircraftId,from:candidate.from,to:candidate.to,
    comparisonReady:comparisonBlockers.length===0,
    comparisonBlockers:[...new Set(comparisonBlockers)],
    mutationReady:mutationBlockers.length===0,
    mutationBlockers:[...new Set(mutationBlockers)],
    mutationAuthorized:false
  };
}

export function summarizeComparisonReadiness(candidates:CandidateComparisonReadinessInput[]){
  const rows=candidates.map(assessCandidateComparisonReadiness);
  return {
    schemaVersion:1 as const,
    comparisonReady:rows.some(r=>r.comparisonReady),
    mutationAuthorized:false as const,
    candidates:rows
  };
}
