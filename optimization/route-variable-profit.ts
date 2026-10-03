import type { Cabins } from '../demand/types';
import { CLASSES } from '../demand/types';
import type { CandidateQuote } from './quote-reader';
import type { Co2CalibrationEvidence } from './co2-calibration';
import type { MarketPriceReference } from './cost-reference-reader';
import type { CandidateLoadFactorEvidence, LoadFactorCalibrationEvidence } from './load-factor-calibration';

export interface RouteVariableCostReference {
  fuelAtMarketReplacementPrice:number|null;
  aCheck:{catalogProration:number|null;modeVerified?:boolean};
  wearRepairReference:{
    expectedPerDepartureAtTraining0:number|null;
    expectedPerDepartureAtTraining5:number|null;
    acquisitionCost:number|null;
    effectiveCostConfirmed:boolean;
  };
}
export interface RouteVariableProfitInterval {
  status:'verified_interval'|'unavailable';
  aircraftId:string;from:string;to:string;
  loadFactor:{low:number|null;expected:number|null;high:number|null;source:string|null};
  demandSupportsInterval:boolean;
  revenue:{low:number|null;expected:number|null;high:number|null};
  costs:{
    fuel:number|null;
    co2Low:number|null;co2Expected:number|null;co2High:number|null;
    aCheck:number|null;
    repairMin:number|null;repairMax:number|null;
  };
  profit:{low:number|null;expected:number|null;high:number|null};
  profitPerHour:{low:number|null;expected:number|null;high:number|null};
  firstCycleAfterSetup:{low:number|null;high:number|null};
  componentSet:readonly ['fuel','co2','aCheck','repair'];
  source:'live-demand-fares-market-plus-crosschecked-community-variable-model';
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

type LoadEnvelope={
  verified:boolean;expectedAggregate:number|null;confidence95Low:number|null;confidence95High:number|null;
};

const validCabins=(v:Cabins|null|undefined):v is Cabins=>!!v&&CLASSES.every(k=>Number.isSafeInteger(v[k])&&v[k]>=0);
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const fresh=(stamp:string,now:Date,maxAgeSeconds:number)=>{
  const age=now.getTime()-Date.parse(stamp);return Number.isFinite(age)&&age>=0&&age<=maxAgeSeconds*1000;
};
const loadFromCalibration=(c:LoadFactorCalibrationEvidence|null):LoadEnvelope=>({
  verified:c?.status==='verified_current_fare_empirical',
  expectedAggregate:c?.expectedLoadFactor??null,confidence95Low:c?.confidence95Low??null,confidence95High:c?.confidence95High??null
});
export const currentRouteLoadEnvelope=loadFromCalibration;

function co2Cost(
  evidence:Co2CalibrationEvidence,
  market:MarketPriceReference,
  quote:CandidateQuote,
  capacity:Cabins,
  factor:number
){
  if(!evidence.formulaVerified||evidence.quoteFactor===null||evidence.fixedQuotasPerKm===null||
    market.commodity!=='co2'||market.unit!=='quotas'||market.source!=='inspected-market'||!finite(market.pricePer1000)||market.pricePer1000<=0)
    return null;
  const y=capacity.Y*factor,j=capacity.J*factor,f=capacity.F*factor;
  const weighted=y+2*j+3*f;
  const quotas=quote.distanceKm*(evidence.fixedQuotasPerKm+evidence.quoteFactor*weighted);
  const amount=quotas*market.pricePer1000/1000;
  return finite(amount)?amount:null;
}

/**
 * Computes only AM4 route-variable economics evidenced by the live account plus
 * the cross-checked community route model: fuel, CO2, A-check and repair.
 * Company-level staff/marketing/stock costs are deliberately excluded rather
 * than guessed, so this is an interval for route choice, not company net profit.
 */
export function routeVariableProfitInterval(
  quote:CandidateQuote,
  capacity:Cabins|null,
  remaining:Cabins|null,
  fares:Cabins|null,
  load:LoadEnvelope,
  costs:RouteVariableCostReference,
  co2Calibration:Co2CalibrationEvidence|null,
  co2Market:MarketPriceReference|null,
  repairReferenceVerified:boolean,
  setupFee:number,
  now=new Date(),
  maxAgeSeconds=300
):RouteVariableProfitInterval {
  const base:RouteVariableProfitInterval={
    status:'unavailable',aircraftId:quote.aircraftId,from:quote.from,to:quote.to,
    loadFactor:{low:null,expected:null,high:null,source:null},demandSupportsInterval:false,
    revenue:{low:null,expected:null,high:null},
    costs:{fuel:null,co2Low:null,co2Expected:null,co2High:null,aCheck:null,repairMin:null,repairMax:null},
    profit:{low:null,expected:null,high:null},profitPerHour:{low:null,expected:null,high:null},
    firstCycleAfterSetup:{low:null,high:null},componentSet:['fuel','co2','aCheck','repair'],
    source:'live-demand-fares-market-plus-crosschecked-community-variable-model',
    reason:'VARIABLE_ECONOMICS_INCOMPLETE',comparisonReady:false,mutationAuthorized:false
  };
  const lowLoad=load.confidence95Low,expectedLoad=load.expectedAggregate,highLoad=load.confidence95High;
  if(!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||!fresh(quote.observedAt,now,maxAgeSeconds)||
    !validCabins(capacity)||!validCabins(remaining)||!validCabins(fares)||!load.verified||
    !finite(lowLoad)||!finite(expectedLoad)||!finite(highLoad)||
    lowLoad<=0||highLoad>1||lowLoad>expectedLoad||expectedLoad>highLoad||
    !Number.isFinite(quote.durationSeconds)||quote.durationSeconds<=0||
    !Number.isFinite(quote.distanceKm)||quote.distanceKm<=0||!finite(setupFee)||!co2Calibration||!co2Market||
    !fresh(co2Market.observedAt,now,maxAgeSeconds)||!repairReferenceVerified)return base;
  const active=CLASSES.filter(k=>capacity[k]>0);
  if(!active.length||!active.every(k=>fares[k]>0&&remaining[k]>=capacity[k]*highLoad))
    return {...base,demandSupportsInterval:false,reason:'REMAINING_DEMAND_DOES_NOT_SUPPORT_LOAD_INTERVAL'};

  const gross=(f:number)=>CLASSES.reduce((sum,k)=>sum+capacity[k]*f*fares[k],0);
  const revLow=gross(lowLoad),revExpected=gross(expectedLoad),revHigh=gross(highLoad);
  const co2Low=co2Cost(co2Calibration,co2Market,quote,capacity,lowLoad);
  const co2Expected=co2Cost(co2Calibration,co2Market,quote,capacity,expectedLoad);
  const co2High=co2Cost(co2Calibration,co2Market,quote,capacity,highLoad);
  const fuel=costs.fuelAtMarketReplacementPrice,aCheck=costs.aCheck.catalogProration;
  const repair0=costs.wearRepairReference.expectedPerDepartureAtTraining0;
  const repair5=costs.wearRepairReference.expectedPerDepartureAtTraining5;
  if(!finite(fuel)||!finite(aCheck)||costs.aCheck.modeVerified!==true||
    !finite(co2Low)||!finite(co2Expected)||!finite(co2High)||!finite(repair0)||!finite(repair5))return base;
  const repairMin=Math.min(repair0,repair5),repairMax=Math.max(repair0,repair5);
  const expectedRepair=(repairMin+repairMax)/2;
  const low=revLow-(fuel+co2High+aCheck+repairMax);
  const expected=revExpected-(fuel+co2Expected+aCheck+expectedRepair);
  const high=revHigh-(fuel+co2Low+aCheck+repairMin);
  const hours=quote.durationSeconds/3600;
  const values=[revLow,revExpected,revHigh,low,expected,high,low/hours,expected/hours,high/hours,low-setupFee,high-setupFee];
  if(!values.every(Number.isFinite))return base;
  return {
    ...base,status:'verified_interval',
    loadFactor:{low:lowLoad,expected:expectedLoad,high:highLoad,
      source:'empirical-current-fare-95ci'},
    demandSupportsInterval:true,revenue:{low:revLow,expected:revExpected,high:revHigh},
    costs:{fuel,co2Low,co2Expected,co2High,aCheck,repairMin,repairMax},
    profit:{low,expected,high},profitPerHour:{low:low/hours,expected:expected/hours,high:high/hours},
    firstCycleAfterSetup:{low:low-setupFee,high:high-setupFee},
    reason:'ROUTE_VARIABLE_PROFIT_INTERVAL_VERIFIED_FUEL_CO2_ACHECK_REPAIR'
  };
}

export function candidateLoadEnvelope(e:CandidateLoadFactorEvidence|null):LoadEnvelope{
  return {verified:e?.verified===true,expectedAggregate:e?.expectedAggregate??null,
    confidence95Low:e?.confidence95Low??null,confidence95High:e?.confidence95High??null};
}
