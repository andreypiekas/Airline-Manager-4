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
  expect(r.mutationBlockers).toContain('ROUTE_MUTATION_EXECUTOR_NOT_IMPLEMENTED');
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

test('fully verified native Create route still stays blocked until economics and executor are complete',()=>{
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
  expect(r.mutationBlockers).toContain('ROUTE_MUTATION_EXECUTOR_NOT_IMPLEMENTED');
});

test('summary preserves fail-closed behavior across candidates',()=>{
  const s=summarizeComparisonReadiness([candidate(),candidate({aircraftId:'2',to:'CCC'})]);
  expect(s.schemaVersion).toBe(1);
  expect(s.comparisonReady).toBe(false);
  expect(s.mutationAuthorized).toBe(false);
  expect(s.candidates).toHaveLength(2);
});
