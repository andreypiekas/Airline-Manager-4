import { test,expect } from '@playwright/test';
import { inferGameModeEvidence } from '../../optimization/game-mode-evidence';
import type { CandidateQuote } from '../../optimization/quote-reader';
import type { AircraftReferenceVariant } from '../../optimization/reference-data';

const variant=(priority=0,speedKph=900,fuelLbsPerKm=4):AircraftReferenceVariant=>({
  modelId:383,shortname:'vip',manufacturer:'Bombardier',modelName:'Challenger 605-VIP',type:2,priority,
  engineId:priority?166:0,engineName:priority?'GE':'unspecified',speedKph,fuelLbsPerKm,co2KgPerPaxKm:.05,
  acquisitionCost:860590,capacityUnits:12,minRunwayFt:3780,aCheckPrice:12705,rangeKm:10701,checkIntervalHours:2000
});
function quote(mode:'easy'|'realism',distance=1000,training=0):CandidateQuote{
  const base=mode==='easy'?{Y:.4*distance+170,J:.8*distance+560,F:1.2*distance+1200}:{Y:.3*distance+150,J:.6*distance+500,F:.9*distance+1000};
  const speed=900*(mode==='easy'?1.5:1);
  const fuel=4*distance*(1-training/100);
  return {
    aircraftId:'1',registration:'VIP',airportId:'2',from:'AAA',to:'BBB',observedAt:new Date().toISOString(),
    distanceKm:distance,durationSeconds:Math.round(distance/speed*3600),fuelLbs:Math.round(fuel),
    co2KgPerPaxKm:.05,costIndex:200,routeFee:1,aircraftOnRoute:0,
    dailyDemand:{Y:1,J:1,F:1},autopriceReference:{base:{Y:Math.round(base.Y),J:Math.round(base.J),F:Math.round(base.F)},modelId:383,effectiveFares:null},
    remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
  };
}

test('cross-checks easy mode from independent fare and speed evidence',()=>{
  const r=inferGameModeEvidence(quote('easy',1000,2),[variant()]);
  expect(r).toMatchObject({status:'verified',mode:'easy',speedMultiplier:1.5,aCheckCostMultiplier:1,fuelTraining:2,fareBaseMatches:true,speedMatches:true,fuelMatches:true});
  expect(r.mutationAuthorized).toBe(false);
});

test('cross-checks realism mode and a-check multiplier',()=>{
  const r=inferGameModeEvidence(quote('realism'),[variant()]);
  expect(r).toMatchObject({status:'verified',mode:'realism',speedMultiplier:1,aCheckCostMultiplier:2,fuelTraining:0});
});

test('ambiguous aircraft variant fails closed',()=>{
  const r=inferGameModeEvidence(quote('easy'),[variant(0,900),variant(1,900)]);
  expect(r.status).toBe('conflict');
  expect(r.reason).toBe('AIRCRAFT_VARIANT_SPEED_FUEL_AMBIGUOUS');
});

test('live fuel observation disambiguates equal-speed engine variants',()=>{
  const r=inferGameModeEvidence(quote('easy'),[variant(1,900,4),variant(2,900,5)]);
  expect(r).toMatchObject({status:'verified',variantPriority:1,fuelTraining:0,speedMatches:true,fuelMatches:true});
  expect(r.mutationAuthorized).toBe(false);
});

test('fare/speed disagreement never verifies mode',()=>{
  const q=quote('easy');q.durationSeconds=Math.round(1000/900*3600);
  const r=inferGameModeEvidence(q,[variant()]);
  expect(r.status).not.toBe('verified');
  expect(r.mutationAuthorized).toBe(false);
});
