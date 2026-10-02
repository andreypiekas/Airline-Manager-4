import { test,expect } from '@playwright/test';
import { CandidateQuote } from '../../optimization/quote-reader';
import { compareKnownContribution,knownContributionLeg } from '../../optimization/route-known-contribution';

const quote=(from='AAA',to='BBB'):CandidateQuote=>({
  aircraftId:'1',registration:'TEST',airportId:'9',from,to,observedAt:new Date().toISOString(),
  distanceKm:1000,durationSeconds:7200,fuelLbs:10000,co2KgPerPaxKm:.2,costIndex:200,routeFee:50000,
  aircraftOnRoute:0,dailyDemand:{Y:100,J:10,F:5},autopriceReference:null,remainingDemand:null,netProfit:null,
  comparisonReady:false,mutationAuthorized:false
});
const capacity={Y:100,J:10,F:5},remaining={Y:80,J:8,F:4},fares={Y:1000,J:2000,F:3000};
const costs=(co2=true)=>({
  fuelAtMarketReplacementPrice:20000,
  co2:{atDemandCeiling:co2?5000:null,quotaConversionConfirmed:co2},
  aCheck:{catalogProration:1000}
});

test('known contribution uses only capacity-capped remaining and explicitly shared verified components',()=>{
 const r=knownContributionLeg(quote(),capacity,remaining,fares,costs(true));
 expect(r).toMatchObject({
  status:'comparable_reference',passengers:remaining,grossRevenue:108000,
  components:['fuel','aCheck','co2'],knownRecurringCosts:26000,knownContribution:82000,
  knownContributionPerHour:41000,comparisonReady:false,mutationAuthorized:false
 });
});

test('unverified CO2 is omitted rather than guessed and core reference remains comparable',()=>{
 const r=knownContributionLeg(quote(),capacity,remaining,fares,costs(false));
 expect(r).toMatchObject({status:'comparable_reference',components:['fuel','aCheck'],knownRecurringCosts:21000,knownContribution:87000});
});

test('comparison requires identical cost component sets and never authorizes route mutation',()=>{
 const current=knownContributionLeg(quote(),capacity,remaining,fares,costs(true));
 const candidate=knownContributionLeg(quote('AAA','CCC'),capacity,remaining,{Y:1200,J:2200,F:3300},costs(true));
 const r=compareKnownContribution(current,candidate,50000);
 expect(r.status).toBe('comparable_reference');
 expect(r.componentSetMatches).toBe(true);
 expect(r.deltaKnownContributionPerHour).not.toBeNull();
 expect(r.candidateFirstCycleAfterSetupKnownContribution).toBe(candidate.knownContribution!-50000);
 expect(r.comparisonReady).toBe(false);
 expect(r.mutationAuthorized).toBe(false);
 const mismatch=compareKnownContribution(current,knownContributionLeg(quote('AAA','DDD'),capacity,remaining,fares,costs(false)),0);
 expect(mismatch).toMatchObject({status:'unavailable',componentSetMatches:false,reason:'REFERENCE_COMPONENT_SET_MISMATCH'});
});

test('missing fares, remaining demand or known core costs fails closed',()=>{
 expect(knownContributionLeg(quote(),capacity,null,fares,costs(true)).status).toBe('unavailable');
 expect(knownContributionLeg(quote(),capacity,remaining,null,costs(true)).status).toBe('unavailable');
 expect(knownContributionLeg(quote(),capacity,remaining,fares,{...costs(true),fuelAtMarketReplacementPrice:null}).status).toBe('unavailable');
});
