import { test,expect } from '@playwright/test';
import { calibrateCurrentFareLoadFactor, transferCurrentFareLoadFactor } from '../../optimization/load-factor-calibration';
import type { AircraftSnapshot } from '../../demand/types';
import type { CandidateQuote } from '../../optimization/quote-reader';
import type { GameModeEvidence } from '../../optimization/game-mode-evidence';
import type { AirportDistanceEvidence } from '../../optimization/reference-data';

const now=new Date().toISOString();
const fares={Y:1060,J:2320,F:3800};
const auto={Y:968,J:2156,F:3593};
const entries=[
 {relativeTime:'2 hours ago',onboard:{Y:56,J:4,F:4}},
 {relativeTime:'4 hours ago',onboard:{Y:57,J:4,F:4}},
 {relativeTime:'6 hours ago',onboard:{Y:43,J:3,F:3}},
 {relativeTime:'8 hours ago',onboard:{Y:48,J:3,F:3}},
 {relativeTime:'10 hours ago',onboard:{Y:53,J:3,F:3}}
].map(x=>({...x,from:'GRU',to:'IMP',registrationLabel:'DC-9-10',co2Quotas:1,fuelLbs:1,
 revenue:x.onboard.Y*fares.Y+x.onboard.J*fares.J+x.onboard.F*fares.F}));
const aircraft:AircraftSnapshot={
 aircraftId:'1',registration:'DC-9-10',routeId:'10',routeLabel:'GRU-IMP',from:'GRU',to:'IMP',state:'ready',
 capacity:{Y:69,J:4,F:4},remaining:{Y:686,J:230,F:113},dailyTotal:{Y:742,J:234,F:117},observedAt:now,
 fares:{automatic:auto,current:fares,source:'inspected-auto-control'},
 flightHistory:{status:'observed',observedAt:now,source:'inspected-aircraft-flight-history',complete:false,entries,
  comparisonReady:false,mutationAuthorized:false}
};
const quote:CandidateQuote={
 aircraftId:'1',registration:'DC-9-10',airportId:'99',from:'GRU',to:'IMP',observedAt:now,
 distanceKm:1994,durationSeconds:5363,fuelLbs:26799,co2KgPerPaxKm:.18,costIndex:200,routeFee:1,aircraftOnRoute:1,
 dailyDemand:{Y:742,J:234,F:117},autopriceReference:{modelId:212,base:auto,effectiveFares:auto},
 routeDirectionEvidence:{primaryFrom:'GRU',primaryTo:'IMP',headerFrom:'GRU',headerTo:'IMP',primaryMatchesContext:true,
  headerMatchesContext:true,independentSourcesAgree:true,verified:true,mutationAuthorized:false},
 remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
};
const mode:GameModeEvidence={status:'verified',mode:'easy',variantPriority:0,engineId:1,speedMultiplier:1.5,aCheckCostMultiplier:1,
 fuelTraining:0,observedSpeedKph:1338,expectedSpeedKph:1341,fareBaseMatches:true,speedMatches:true,fuelMatches:true,co2FactorMatches:true,
 source:'live-quote-crosschecked-community-formula',reason:'verified',comparisonReady:false,mutationAuthorized:false};
const distance:AirportDistanceEvidence={from:'GRU',to:'IMP',distanceKm:1994,quoteDistanceKm:1994,deltaKm:0,
 originSourceIds:[1],destinationSourceIds:[99],destinationAirportIdMatches:true,source:'fixture',status:'cross_checked',
 comparisonReady:false,mutationAuthorized:false};

test('calibrates expected load only from flights reproducing current fares exactly',()=>{
 const r=calibrateCurrentFareLoadFactor(aircraft,quote,mode,distance);
 expect(r.status).toBe('verified_current_fare_empirical');
 expect(r.sampleCount).toBe(5);
 expect(r.currentFarePolicyVerified).toBe(true);
 expect(r.currentRouteDirectModelVerified).toBe(true);
 expect(r.expectedLoadFactor).toBeGreaterThan(.7);
 expect(r.expectedLoadFactor).toBeLessThan(.9);
 expect(r.estimatedDirectAlphaAboveOneReputation).toBeGreaterThan(70);
 expect(r.estimatedDirectAlphaAboveOneReputation).toBeLessThan(100);
 expect(r.comparisonReady).toBe(false);expect(r.mutationAuthorized).toBe(false);
});

test('four exact current-fare samples are sufficient, while three still fail closed',()=>{
 const four=structuredClone(aircraft);
 four.flightHistory!.entries[0]={...four.flightHistory!.entries[0],revenue:four.flightHistory!.entries[0].revenue-10};
 const ok=calibrateCurrentFareLoadFactor(four,quote,mode,distance);
 expect(ok.sampleCount).toBe(4);
 expect(ok.status).toBe('verified_current_fare_empirical');
 const three=structuredClone(four);
 three.flightHistory!.entries[1]={...three.flightHistory!.entries[1],revenue:three.flightHistory!.entries[1].revenue-10};
 const blocked=calibrateCurrentFareLoadFactor(three,quote,mode,distance);
 expect(blocked.sampleCount).toBe(3);
 expect(blocked.status).toBe('insufficient');
 expect(blocked.reason).toBe('TOO_FEW_CURRENT_FARE_HISTORY_SAMPLES');
});

test('unverified direct route or weak demand headroom fails closed',()=>{
 const badMode={...mode,speedMatches:false};
 expect(calibrateCurrentFareLoadFactor(aircraft,quote,badMode,distance)).toMatchObject({status:'inconsistent',reason:'CURRENT_ROUTE_DIRECT_MODEL_NOT_VERIFIED'});
 const a=structuredClone(aircraft);a.dailyTotal={Y:100,J:10,F:10};
 expect(calibrateCurrentFareLoadFactor(a,quote,mode,distance)).toMatchObject({status:'insufficient',reason:'CURRENT_ROUTE_DEMAND_HEADROOM_TOO_LOW'});
});


test('verified empirical load transfers only to direct candidate priced above Auto',()=>{
 const calibration=calibrateCurrentFareLoadFactor(aircraft,quote,mode,distance);
 const candidate={...quote,to:'TTG',airportId:'200',autopriceReference:{...quote.autopriceReference!,base:{Y:900,J:1900,F:3200},effectiveFares:{Y:900,J:1900,F:3200}}};
 const ok=transferCurrentFareLoadFactor(calibration,candidate,aircraft.capacity,{Y:990,J:2050,F:3390},true);
 expect(ok.verified).toBe(true);
 expect(ok.expectedByCabin).toEqual({Y:calibration.expectedLoadFactor,J:calibration.expectedLoadFactor,F:calibration.expectedLoadFactor});
 expect(ok.mutationAuthorized).toBe(false);
 const stopover=transferCurrentFareLoadFactor(calibration,candidate,aircraft.capacity,{Y:990,J:2050,F:3390},false);
 expect(stopover.verified).toBe(false);
 const autoOrBelow=transferCurrentFareLoadFactor(calibration,candidate,aircraft.capacity,{Y:900,J:2050,F:3390},true);
 expect(autoOrBelow).toMatchObject({verified:false,reason:'CANDIDATE_FARE_NOT_STRICTLY_ABOVE_AUTO'});
});
