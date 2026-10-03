import { test, expect } from '@playwright/test';
import { assessCandidateComparisonReadiness, summarizeComparisonReadiness } from '../../optimization/route-readiness';

const candidate=(overrides:any={})=>({
  aircraftId:'1',from:'AAA',to:'BBB',comparisonReady:false,mutationAuthorized:false,costsComplete:false,
  demand:{remaining:null},
  roundTrip:{comparisonReady:false,blockers:['RETURN_LIVE_QUOTE_REQUIRED']},
  effectiveCosts:{complete:false,missing:['fuel','co2']},
  createControl:null,
  routeListenerDiagnostics:[],
  routeMutationControl:null,
  ...overrides
});

test('readiness gate stays closed with incomplete economics and no native control',()=>{
  const r=assessCandidateComparisonReadiness(candidate());
  expect(r.comparisonReady).toBe(false);
  expect(r.mutationReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
  expect(r.comparisonBlockers).toContain('CURRENT_ROUTE_FULL_ECONOMICS_MISSING');
  expect(r.comparisonBlockers).toContain('ROUND_TRIP:RETURN_LIVE_QUOTE_REQUIRED');
  expect(r.mutationBlockers).toContain('NATIVE_ROUTE_ENDPOINT_UNVERIFIED');
  expect(r.mutationBlockers).toContain('NATIVE_ROUTE_MUTATION_CONTROL_UNVERIFIED');
});

test('independent route direction evidence is required by the comparison gate',()=>{
  const missing=assessCandidateComparisonReadiness(candidate());
  expect(missing.comparisonBlockers).toContain('ROUTE_DIRECTION_INDEPENDENT_EVIDENCE_MISSING');
  const verified=assessCandidateComparisonReadiness(candidate({
    routeDirectionEvidence:{verified:true,primaryMatchesContext:true,headerMatchesContext:true,independentSourcesAgree:true}
  }));
  expect(verified.comparisonBlockers).not.toContain('ROUTE_DIRECTION_INDEPENDENT_EVIDENCE_MISSING');
  expect(verified.mutationAuthorized).toBe(false);
});

test('runway reference is distinguished from missing evidence but stays non-actionable',()=>{
 const verified=assessCandidateComparisonReadiness(candidate({
  runwayEvidence:{status:'reference_verified',adequate:true,originObserved:true,destinationObserved:true,
   originRunwayFt:10000,destinationRunwayFt:9000,requiredRunwayFt:6000}
 }));
 expect(verified.comparisonBlockers).not.toContain('RUNWAY_EVIDENCE_MISSING');
 expect(verified.comparisonBlockers).toContain('RUNWAY_REFERENCE_ONLY_NEEDS_LIVE_CORROBORATION');
 const insufficient=assessCandidateComparisonReadiness(candidate({
  runwayEvidence:{status:'insufficient_reference',adequate:false,originObserved:true,destinationObserved:true,
   originRunwayFt:10000,destinationRunwayFt:5000,requiredRunwayFt:6000}
 }));
 expect(insufficient.comparisonBlockers).toContain('RUNWAY_REFERENCE_INSUFFICIENT');
 expect(insufficient.mutationAuthorized).toBe(false);
});

test('runway blocker clears only after reference, airportId and distance are cross-checked',()=>{
 const baseRunway={status:'reference_verified' as const,adequate:true,originObserved:true,destinationObserved:true,
  originRunwayFt:10000,destinationRunwayFt:9000,requiredRunwayFt:6000};
 const pending=assessCandidateComparisonReadiness(candidate({runwayEvidence:baseRunway,runwayCrossChecked:false}));
 expect(pending.comparisonBlockers).toContain('RUNWAY_REFERENCE_ONLY_NEEDS_LIVE_CORROBORATION');
 const checked=assessCandidateComparisonReadiness(candidate({runwayEvidence:baseRunway,runwayCrossChecked:true}));
 expect(checked.comparisonBlockers).not.toContain('RUNWAY_REFERENCE_ONLY_NEEDS_LIVE_CORROBORATION');
 expect(checked.mutationAuthorized).toBe(false);
});

test('verified variable-cycle comparison replaces legacy full-cost blockers without authorizing mutation',()=>{
  const r=assessCandidateComparisonReadiness(candidate({
    routeProfitModel:{verified:true},
    variableCycleComparison:{comparisonReady:true,status:'candidate_dominates'},
    routeDirectionEvidence:{verified:true,primaryMatchesContext:true,headerMatchesContext:true,independentSourcesAgree:true},
    demand:{remaining:{Y:300,J:100,F:50}},
    runwayEvidence:{status:'reference_verified',adequate:true,originObserved:true,destinationObserved:true,
      originRunwayFt:10000,destinationRunwayFt:9000,requiredRunwayFt:6000},
    runwayCrossChecked:true,
    candidateLoadFactor:{verified:true,expectedAggregate:.8},
    routeMutationControl:{
      nativeClickReady:true,endpointVerified:true,targetVerified:true,
      aircraftIdMatchesContext:true,airportIdMatchesContext:true
    }
  }));
  expect(r.comparisonReady).toBe(true);
  expect(r.comparisonBlockers).toEqual([]);
  expect(r.mutationReady).toBe(true);
  expect(r.mutationAuthorized).toBe(false);
  expect(r.mutationBlockers).toEqual([]);
});

test('variable-cycle comparison remains blocked without pinned route-profit provenance',()=>{
  const r=assessCandidateComparisonReadiness(candidate({
    variableCycleComparison:{comparisonReady:true,status:'keep_current'},
    routeDirectionEvidence:{verified:true,primaryMatchesContext:true,headerMatchesContext:true,independentSourcesAgree:true},
    demand:{remaining:{Y:300,J:100,F:50}},
    runwayEvidence:{status:'reference_verified',adequate:true,originObserved:true,destinationObserved:true,
      originRunwayFt:10000,destinationRunwayFt:9000,requiredRunwayFt:6000},
    runwayCrossChecked:true,
    candidateLoadFactor:{verified:true,expectedAggregate:.8}
  }));
  expect(r.comparisonReady).toBe(false);
  expect(r.comparisonBlockers).toContain('ROUTE_PROFIT_MODEL_UNVERIFIED');
  expect(r.comparisonBlockers).toContain('VARIABLE_CYCLE_COMPARISON_UNAVAILABLE');
});

test('observed endpoint without contextual verification never opens mutation gate',()=>{
  const r=assessCandidateComparisonReadiness(candidate({
    createControl:{observed:true,phpEndpoints:['new_route_info.php']},
    routeListenerDiagnostics:[{phpEndpoints:['new_route_info.php']}],
    routeMutationControl:{
      nativeClickReady:false,endpointVerified:true,targetVerified:true,
      aircraftIdMatchesContext:false,airportIdMatchesContext:false
    }
  }));
  expect(r.mutationReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
  expect(r.mutationBlockers).toContain('NATIVE_ROUTE_AIRCRAFT_CONTEXT_UNVERIFIED');
  expect(r.mutationBlockers).toContain('NATIVE_ROUTE_AIRPORT_CONTEXT_UNVERIFIED');
  expect(r.mutationBlockers).toContain('NATIVE_ROUTE_MUTATION_CONTROL_UNVERIFIED');
});

test('fully verified native Create route still stays blocked until economics are complete',()=>{
  const r=assessCandidateComparisonReadiness(candidate({
    routeMutationControl:{
      nativeClickReady:true,endpointVerified:true,targetVerified:true,
      aircraftIdMatchesContext:true,airportIdMatchesContext:true
    }
  }));
  expect(r.mutationReady).toBe(false);
  expect(r.mutationAuthorized).toBe(false);
  expect(r.mutationBlockers).not.toContain('NATIVE_ROUTE_MUTATION_CONTROL_UNVERIFIED');
  expect(r.mutationBlockers).toContain('COMPARISON_NOT_READY');
});

test('summary preserves fail-closed behavior across candidates',()=>{
  const s=summarizeComparisonReadiness([candidate(),candidate({aircraftId:'2',to:'CCC'})]);
  expect(s.schemaVersion).toBe(1);
  expect(s.comparisonReady).toBe(false);
  expect(s.mutationAuthorized).toBe(false);
  expect(s.candidates).toHaveLength(2);
});
