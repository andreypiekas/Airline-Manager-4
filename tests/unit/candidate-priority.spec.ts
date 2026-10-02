import { test, expect } from '@playwright/test';
import { CandidateQuote } from '../../optimization/quote-reader';
import { CandidateEconomicScreen } from '../../optimization/economic-screen';
import { candidatePriorityReference, rankCandidatePriorities } from '../../optimization/candidate-priority';

function quote(to='BBB'):CandidateQuote{
  return {
    aircraftId:'1',registration:'TEST',airportId:'9',from:'AAA',to,observedAt:new Date().toISOString(),
    distanceKm:1000,durationSeconds:7200,fuelLbs:10000,co2KgPerPaxKm:.2,costIndex:200,routeFee:50000,aircraftOnRoute:0,
    dailyDemand:{Y:100,J:10,F:5},autopriceReference:null,remainingDemand:null,netProfit:null,comparisonReady:false,mutationAuthorized:false
  };
}
function screening(revenue:number):CandidateEconomicScreen{
  return {
    status:'screened',demandStatus:'potentially_sufficient',minCoveragePercent:80,capacity:{Y:100,J:10,F:5},
    dailyDemandCeiling:{Y:100,J:10,F:5},passengerCeiling:{Y:100,J:10,F:5},coverageCeilingPercent:100,
    adjustedFareReference:{Y:1000,J:2000,F:3000},grossRevenueCeilingPerDeparture:revenue,
    firstDepartureAfterSetupFeeCeiling:revenue-50000,reason:'test',comparisonReady:false,mutationAuthorized:false
  };
}

test('builds a reference-only contribution ceiling without claiming profit',()=>{
  const r=candidatePriorityReference(quote(),screening(300000),{
    fuelAtMarketReplacementPrice:100000,aCheck:{catalogProration:1000}
  });
  expect(r).toMatchObject({
    status:'rankable',knownRecurringCostSubtotal:101000,recurringKnownContributionCeiling:199000,
    recurringKnownContributionCeilingPerHour:99500,firstCycleKnownContributionCeiling:149000,
    comparisonReady:false,mutationAuthorized:false
  });
});

test('missing known reference cost keeps priority unavailable',()=>{
  const r=candidatePriorityReference(quote(),screening(300000),{
    fuelAtMarketReplacementPrice:null,aCheck:{catalogProration:1000}
  });
  expect(r.status).toBe('unavailable');
  expect(r.comparisonReady).toBe(false);
});

test('ranking orders only rankable candidates by contribution ceiling per hour',()=>{
  const a={from:'AAA',to:'BBB',priority:candidatePriorityReference(quote('BBB'),screening(300000),{fuelAtMarketReplacementPrice:100000,aCheck:{catalogProration:1000}})};
  const b={from:'AAA',to:'CCC',priority:candidatePriorityReference({...quote('CCC'),durationSeconds:3600},screening(220000),{fuelAtMarketReplacementPrice:80000,aCheck:{catalogProration:1000}})};
  const unavailable={from:'AAA',to:'DDD',priority:candidatePriorityReference(quote('DDD'),screening(100000),{fuelAtMarketReplacementPrice:null,aCheck:{catalogProration:null}})};
  expect(rankCandidatePriorities([a,b,unavailable]).map(x=>x.to)).toEqual(['CCC','BBB']);
});
