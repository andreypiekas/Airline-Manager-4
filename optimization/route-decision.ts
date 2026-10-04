export interface RouteDecisionCandidate {
  aircraftId:string;
  from:string;
  to:string;
  airportId:string;
  comparisonReady:boolean;
  variableCycleComparison:{
    status:'candidate_dominates'|'keep_current'|'unavailable';
    comparisonReady:boolean;
  };
  candidateVariableCycle:{
    status:'verified_interval'|'unavailable';
    recurringCycleProfitPerHour:{low:number|null;expected:number|null;high:number|null};
    firstCycleAfterSetup:{low:number|null;expected:number|null;high:number|null};
  };
  routeMutationControl:null|{
    nativeClickReady:boolean;endpointVerified:boolean;targetVerified:boolean;
    aircraftIdMatchesContext:boolean;airportIdMatchesContext:boolean;
  };
}
export interface VariableRouteDecision {
  aircraftId:string;
  decision:'would_reroute'|'keep_route'|'hold'|'unavailable';
  selected:null|{from:string;to:string;airportId:string;conservativeProfitPerHour:number;firstCycleLow:number};
  compared:number;
  dominating:number;
  reason:string;
  dryRun:true;
  mutationAuthorized:false;
}

const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER;

/**
 * Chooses only among already verified conservative cycle comparisons.
 * This is a read-only plan: the native control is checked as evidence but no
 * route mutation is authorized here.
 */
export function planVariableRouteDecision(
  aircraftId:string,
  candidates:RouteDecisionCandidate[]
):VariableRouteDecision {
  const base:VariableRouteDecision={
    aircraftId,decision:'unavailable',selected:null,compared:0,dominating:0,
    reason:'ROUTE_COMPARISON_SET_UNAVAILABLE',dryRun:true,mutationAuthorized:false
  };
  if(!/^[1-9]\d*$/.test(aircraftId)||!Array.isArray(candidates)||!candidates.length||
    candidates.some(c=>c.aircraftId!==aircraftId||!/^[A-Z0-9]{3}$/.test(c.from)||!/^[A-Z0-9]{3}$/.test(c.to)||
      c.from===c.to||!/^[1-9]\d*$/.test(c.airportId)))return base;

  const comparable=candidates.filter(c=>c.comparisonReady&&c.variableCycleComparison.comparisonReady&&
    c.variableCycleComparison.status!=='unavailable'&&c.candidateVariableCycle.status==='verified_interval');
  if(!comparable.length)return {...base,decision:'hold',reason:'NO_VERIFIED_VARIABLE_CYCLE_COMPARISON'};

  const dominant=comparable.filter(c=>c.variableCycleComparison.status==='candidate_dominates'&&
    finite(c.candidateVariableCycle.recurringCycleProfitPerHour.low)&&
    finite(c.candidateVariableCycle.firstCycleAfterSetup.low)&&c.candidateVariableCycle.firstCycleAfterSetup.low!>0&&
    c.routeMutationControl?.nativeClickReady===true&&c.routeMutationControl.endpointVerified===true&&
    c.routeMutationControl.targetVerified===true&&c.routeMutationControl.aircraftIdMatchesContext===true&&
    c.routeMutationControl.airportIdMatchesContext===true);

  if(!dominant.length)return {
    ...base,decision:'keep_route',compared:comparable.length,dominating:0,
    reason:'NO_INSPECTED_CANDIDATE_PROVES_CONSERVATIVE_DOMINANCE'
  };

  dominant.sort((a,b)=>
    b.candidateVariableCycle.recurringCycleProfitPerHour.low!-a.candidateVariableCycle.recurringCycleProfitPerHour.low!||
    b.candidateVariableCycle.firstCycleAfterSetup.low!-a.candidateVariableCycle.firstCycleAfterSetup.low!||
    a.to.localeCompare(b.to)
  );
  const best=dominant[0];
  return {
    ...base,decision:'would_reroute',compared:comparable.length,dominating:dominant.length,
    selected:{
      from:best.from,to:best.to,airportId:best.airportId,
      conservativeProfitPerHour:best.candidateVariableCycle.recurringCycleProfitPerHour.low!,
      firstCycleLow:best.candidateVariableCycle.firstCycleAfterSetup.low!
    },
    reason:'BEST_CONSERVATIVE_LOW_BOUND_AMONG_VERIFIED_DOMINATING_CANDIDATES'
  };
}

/** True only when route economics produced a completed safe decision. HOLD remains retryable and never marks comparison ready. */
export function routeDecisionSetComparisonReady(decisions:readonly VariableRouteDecision[]):boolean{
  return decisions.some(d=>d.decision==='keep_route'||d.decision==='would_reroute');
}
