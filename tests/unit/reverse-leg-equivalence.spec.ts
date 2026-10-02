import { test,expect } from '@playwright/test';
import { reverseLegEquivalentEvidence } from '../../optimization/reverse-leg-equivalence';
import type { CandidateQuote } from '../../optimization/quote-reader';
import type { AirportDistanceEvidence } from '../../optimization/reference-data';
import type { GameModeEvidence } from '../../optimization/game-mode-evidence';
import type { RouteMutationControlEvidence } from '../../optimization/route-mutation-control';

const quote:CandidateQuote={
  aircraftId:'101',registration:'TEST',airportId:'200',from:'AAA',to:'BBB',observedAt:new Date().toISOString(),
  distanceKm:1000,durationSeconds:2400,fuelLbs:4000,co2KgPerPaxKm:.05,costIndex:200,routeFee:10000,aircraftOnRoute:0,
  dailyDemand:{Y:200,J:50,F:20},autopriceReference:{modelId:383,base:{Y:570,J:1360,F:2400},effectiveFares:{Y:1026,J:2448,F:4320}},
  routeDirectionEvidence:{primaryFrom:'AAA',primaryTo:'BBB',headerFrom:'AAA',headerTo:'BBB',primaryMatchesContext:true,headerMatchesContext:true,independentSourcesAgree:true,verified:true,mutationAuthorized:false},
  remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
};
const distance:AirportDistanceEvidence={from:'AAA',to:'BBB',distanceKm:1000,quoteDistanceKm:1000,deltaKm:0,
  originSourceIds:[1],destinationSourceIds:[200],destinationAirportIdMatches:true,source:'fixture',status:'cross_checked',
  comparisonReady:false,mutationAuthorized:false};
const mode:GameModeEvidence={status:'verified',mode:'easy',variantPriority:0,engineId:0,speedMultiplier:1.5,aCheckCostMultiplier:1,
  fuelTraining:0,observedSpeedKph:1500,expectedSpeedKph:1500,fareBaseMatches:true,speedMatches:true,fuelMatches:true,co2FactorMatches:true,
  source:'live-quote-crosschecked-community-formula',reason:'verified',comparisonReady:false,mutationAuthorized:false};
const control:RouteMutationControlEvidence={observed:true,source:'jquery-direct-click',endpointVerified:true,targetVerified:true,
  aircraftIdMatchesContext:true,airportIdMatchesContext:true,registrationInputVerified:true,seatInputsVerified:true,endCostIndexVerified:true,
  nonCharterBranchVerified:true,charterBranchObserved:true,stopoverIds:[0],ferryModes:[0],directRouteVerified:true,nativeClickReady:true,
  shape:'fixture',mutationAuthorized:false};

test('verified direct route supplies only direction-symmetric reverse quote fields',()=>{
 const r=reverseLegEquivalentEvidence(quote,distance,mode,control);
 expect(r).toMatchObject({status:'verified',from:'BBB',to:'AAA',distanceKm:1000,durationSeconds:2400,fuelLbs:4000,
  co2KgPerPaxKm:.05,automaticFares:{Y:1026,J:2448,F:4320},modelId:383,costIndex:200});
 expect(r.comparisonReady).toBe(false);expect(r.mutationAuthorized).toBe(false);
});

for(const [name,change] of [
 ['stopover',(c:any)=>c.directRouteVerified=false],
 ['distance',(c:any)=>c.status='reference_only'],
 ['mode',(c:any)=>c.status='unavailable'],
 ['fuel',(c:any)=>c.fuelMatches=false],
 ['co2',(c:any)=>c.co2FactorMatches=false],
] as const)test(`missing ${name} proof blocks reverse equivalence`,()=>{
 const d={...distance} as any,m={...mode} as any,ctl={...control} as any;
 if(name==='distance')change(d);else if(name==='mode'||name==='fuel'||name==='co2')change(m);else change(ctl);
 const r=reverseLegEquivalentEvidence(quote,d,m,ctl);
 expect(r.status).toBe('unavailable');expect(r.mutationAuthorized).toBe(false);
});
