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
  if(!candidate.comparisonReady)comparisonBlockers.push('CANDIDATE_COMPARISON_NOT_READY');
  if(!candidate.roundTrip.comparisonReady)comparisonBlockers.push('ROUND_TRIP_COMPARISON_NOT_READY');
  if(!candidate.demand.remaining)comparisonBlockers.push('OUTBOUND_DIRECTIONAL_REMAINING_DEMAND_MISSING');
  if(!candidate.costsComplete)comparisonBlockers.push('FULL_COSTS_MISSING');
  if(!candidate.effectiveCosts.complete)comparisonBlockers.push(...candidate.effectiveCosts.missing.map(x=>'EFFECTIVE_COST:'+x));
  comparisonBlockers.push(...candidate.roundTrip.blockers.map(x=>'ROUND_TRIP:'+x));
  comparisonBlockers.push(
    'CURRENT_ROUTE_FULL_ECONOMICS_MISSING',
    'EXPECTED_LOAD_FACTOR_EVIDENCE_MISSING',
    'RUNWAY_EVIDENCE_MISSING'
  );

  const nativeEndpoints=new Set([
    ...(candidate.createControl?.phpEndpoints||[]),
    ...candidate.routeListenerDiagnostics.flatMap(x=>x.phpEndpoints||[])
  ]);
  const mutationBlockers:string[]=[];
  if(comparisonBlockers.length)mutationBlockers.push('COMPARISON_NOT_READY');
  if(!candidate.createControl?.observed&&nativeEndpoints.size===0)mutationBlockers.push('NATIVE_ROUTE_MUTATION_CONTROL_UNVERIFIED');
  mutationBlockers.push('ROUTE_MUTATION_EXECUTOR_NOT_IMPLEMENTED');

  return {
    aircraftId:candidate.aircraftId,from:candidate.from,to:candidate.to,
    comparisonReady:comparisonBlockers.length===0,
    comparisonBlockers:[...new Set(comparisonBlockers)],
    mutationReady:false,
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
