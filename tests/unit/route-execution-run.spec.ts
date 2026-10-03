import { test,expect } from '@playwright/test';
import { routeExecutionCandidates,routeExecutionSettings } from '../../optimization/route-execution-run';

test('route execution defaults disabled and validates bounded settings',()=>{
  expect(routeExecutionSettings({})).toEqual({enabled:false,maxReroutes:1,maxAgeSeconds:300});
  expect(()=>routeExecutionSettings({ENABLE_ROUTE_EXECUTION:'true'})).toThrow('ROUTE_REAL_EXECUTION_CONTEXT_INVALID_OR_RERUN');
  expect(()=>routeExecutionSettings({ENABLE_ROUTE_EXECUTION:'false',ROUTE_MAX_REROUTES_PER_RUN:'6'})).toThrow('ROUTE_EXECUTION_CONFIG_INVALID');
});

test('real route execution requires exact one-shot GitHub production acknowledgement',()=>{
  const env:any={
    ENABLE_ROUTE_EXECUTION:'true',ROUTE_EXECUTION_ACK:'native-direct-reroute-v1',
    ROUTE_MAX_REROUTES_PER_RUN:'1',DEMAND_MAX_AGE_SECONDS:'300',
    GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'andreypiekas/Airline-Manager-4',
    GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',DEMAND_DRY_RUN:'false',ENABLE_ROUTE_OPTIMIZER:'true'
  };
  expect(routeExecutionSettings(env)).toEqual({enabled:true,maxReroutes:1,maxAgeSeconds:300});
  expect(()=>routeExecutionSettings({...env,GITHUB_RUN_ATTEMPT:'2'})).toThrow('ROUTE_REAL_EXECUTION_CONTEXT_INVALID_OR_RERUN');
  expect(()=>routeExecutionSettings({...env,DEMAND_DRY_RUN:'true'})).toThrow('ROUTE_REAL_EXECUTION_CONTEXT_INVALID_OR_RERUN');
});

test('execution candidates preserve only complete fresh route fingerprints',()=>{
  const stamp=new Date().toISOString();
  const control:any={nativeClickReady:true};
  const context:any={
    candidateData:{
      routeReadiness:{candidates:[
        {aircraftId:'101',from:'AAA',to:'BBB',comparisonReady:true},
        {aircraftId:'101',from:'AAA',to:'CCC',comparisonReady:false}
      ]},
      candidates:[
        {aircraftId:'101',airportId:'200',from:'AAA',to:'BBB',routeMutationControl:control,
         screening:{capacity:{Y:100,J:10,F:5}},
         routeExecutionEvidence:{observedAt:stamp,autoFares:{Y:1000,J:2000,F:3000},costIndex:200,distanceKm:1200,durationSeconds:5000,fuelLbs:12000,co2KgPerPaxKm:.12,routeFee:20000}},
        {aircraftId:'101',airportId:'300',from:'AAA',to:'CCC',routeMutationControl:control,
         screening:{capacity:{Y:100,J:10,F:5}},
         routeExecutionEvidence:{observedAt:stamp,autoFares:null,costIndex:200,distanceKm:1300,durationSeconds:5100,fuelLbs:13000,co2KgPerPaxKm:.12,routeFee:21000}}
      ]
    }
  };
  const r=routeExecutionCandidates(context);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({
    aircraftId:'101',airportId:'200',from:'AAA',to:'BBB',comparisonReady:true,
    observedAt:stamp,autoFares:{Y:1000,J:2000,F:3000},costIndex:200,distanceKm:1200,routeFee:20000
  });
});
