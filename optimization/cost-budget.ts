import { Cabins, CLASSES } from '../demand/types';
import { CandidateQuote } from './quote-reader';
import { MarketPriceReference, ModelCostReference } from './cost-reference-reader';
import { AircraftMaintenanceReference } from './maintenance-reader';
import { Co2CalibrationEvidence, estimateObservedCo2Quotas } from './co2-calibration';
import type { GameModeEvidence } from './game-mode-evidence';

export const COST_COMPONENTS = ['fuel','co2','aCheck','wearRepair','airport','staff','marketing','otherRecurring'] as const;
export type CostComponent = typeof COST_COMPONENTS[number];
export interface EffectiveCostEvidence {
  aircraftId:string;from:string;to:string;observedAt:string;amount:number;
  currency:'USD';scope:'per-leg';source:'inspected-effective-quote'|'calibrated-allocation';
  verified:true;
}
const nonnegative = (n:number) => Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const validCabins = (c:Cabins|null):c is Cabins => !!c&&CLASSES.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)&&
  Number.isSafeInteger(c.Y+c.J+c.F);
const fresh = (stamp:string,now:Date,maxAge:number) => {
  const age=now.getTime()-Date.parse(stamp);return Number.isFinite(age)&&age>=0&&age<=maxAge*1000;
};

/** All eight components are mandatory; zero must have explicit, fresh evidence.
 * Catalogue prorating, replacement market prices and spreadsheet estimates do not qualify.
 * A calibrated allocation must cover the proposed leg, including the chosen accounting policy.
 */
export function effectiveCostBudget(quote:CandidateQuote,evidence:Partial<Record<CostComponent,EffectiveCostEvidence>>={},
  now=new Date(),maxAgeSeconds=300) {
  const validContext=Number.isSafeInteger(maxAgeSeconds)&&maxAgeSeconds>0&&fresh(quote.observedAt,now,maxAgeSeconds)&&
    /^\d+$/.test(quote.aircraftId)&&/^[A-Z0-9]{3}$/.test(quote.from)&&/^[A-Z0-9]{3}$/.test(quote.to)&&quote.from!==quote.to;
  const components=Object.fromEntries(COST_COMPONENTS.map(component=>{
    const e=evidence[component];
    const valid=validContext&&e?.verified===true&&e.aircraftId===quote.aircraftId&&e.from===quote.from&&e.to===quote.to&&
      e.currency==='USD'&&e.scope==='per-leg'&&['inspected-effective-quote','calibrated-allocation'].includes(e.source)&&
      fresh(e.observedAt,now,maxAgeSeconds)&&nonnegative(e.amount);
    return [component,{amount:valid?e!.amount:null,status:valid?'verified':'unavailable',source:valid?e!.source:null}];
  })) as Record<CostComponent,{amount:number|null;status:string;source:EffectiveCostEvidence['source']|null}>;
  const missing=COST_COMPONENTS.filter(k=>components[k].amount===null);
  const subtotal=missing.length?null:COST_COMPONENTS.reduce((n,k)=>n+components[k].amount!,0);
  const complete=subtotal!==null&&nonnegative(subtotal);
  return {components,missing,complete,totalRecurring:complete?subtotal:null,
    groupedCosts:complete?{fuel:components.fuel.amount!,co2:components.co2.amount!,
      maintenance:components.aCheck.amount!+components.wearRepair.amount!,
      airportAndOther:components.airport.amount!+components.staff.amount!+components.marketing.amount!+components.otherRecurring.amount!}:null,
    mutationAuthorized:false};
}

/** Reference-only sensitivity calculations, traced to the supplied AM4 calculator.
 * CO2 assumes one quota per emitted kg; this conversion and effective check prices remain unverified.
 * Passenger counts are physical seats, never Y+2J+3F or reputation treated as occupancy.
 */
export function candidateCostScenarios(quote:CandidateQuote,capacity:Cabins|null,remaining:Cabins|null,
  references:{fuel:MarketPriceReference|null;co2:MarketPriceReference|null;model:ModelCostReference|null;
    maintenance:AircraftMaintenanceReference|null;co2Calibration?:Co2CalibrationEvidence|null;gameModeEvidence?:GameModeEvidence|null},now=new Date(),maxAgeSeconds=300) {
  const context=Number.isSafeInteger(maxAgeSeconds)&&maxAgeSeconds>0&&fresh(quote.observedAt,now,maxAgeSeconds)&&
    /^\d+$/.test(quote.aircraftId)&&/^[A-Z0-9]{3}$/.test(quote.from)&&/^[A-Z0-9]{3}$/.test(quote.to)&&quote.from!==quote.to&&
    Number.isFinite(quote.distanceKm)&&quote.distanceKm>0&&Number.isFinite(quote.durationSeconds)&&quote.durationSeconds>0&&
    nonnegative(quote.fuelLbs)&&nonnegative(quote.co2KgPerPaxKm);
  const market=(m:MarketPriceReference|null,type:'fuel'|'co2') => !!m&&m.commodity===type&&m.source==='inspected-market'&&
    m.unit===(type==='fuel'?'lbs':'quotas')&&nonnegative(m.pricePer1000)&&m.pricePer1000>0&&fresh(m.observedAt,now,maxAgeSeconds);
  const fuelValue=context&&market(references.fuel,'fuel')?quote.fuelLbs*references.fuel!.pricePer1000/1000:null;
  const fuel=fuelValue!==null&&nonnegative(fuelValue)?fuelValue:null;
  const passengersAtCapacity=context&&validCabins(capacity)?capacity.Y+capacity.J+capacity.F:null;
  const cabinsAtDemandCeiling=context&&validCabins(capacity)&&validCabins(remaining)?
    ({Y:Math.min(capacity.Y,remaining.Y),J:Math.min(capacity.J,remaining.J),F:Math.min(capacity.F,remaining.F)} as Cabins):null;
  const passengersAtDemandCeiling=cabinsAtDemandCeiling?
    cabinsAtDemandCeiling.Y+cabinsAtDemandCeiling.J+cabinsAtDemandCeiling.F:null;
  const co2Value=(pax:number|null)=>context&&pax!==null&&market(references.co2,'co2')?
    quote.distanceKm*quote.co2KgPerPaxKm*pax*references.co2!.pricePer1000/1000:null;
  const calibratedQuotas=(cabins:Cabins|null)=>context&&cabins&&references.co2Calibration?
    estimateObservedCo2Quotas(references.co2Calibration,quote.distanceKm,cabins):null;
  const calibratedCo2Cost=(cabins:Cabins|null)=>{
    const quotas=calibratedQuotas(cabins);
    return quotas!==null&&market(references.co2,'co2')?quotas*references.co2!.pricePer1000/1000:null;
  };
  const amount=(n:number|null)=>n!==null&&nonnegative(n)?n:null;
  const model=references.model;
  const mode=references.gameModeEvidence;
  const exactMode=mode?.status==='verified'&&mode.aCheckCostMultiplier!==null&&mode.speedMultiplier!==null&&
    Number.isFinite(mode.aCheckCostMultiplier)&&mode.aCheckCostMultiplier>0&&Number.isFinite(mode.speedMultiplier)&&mode.speedMultiplier>0;
  const aCheckValue=context&&!!model&&['inspected-catalog','community-reference'].includes(model.source)&&model.modelId===quote.autopriceReference?.modelId&&
    fresh(model.observedAt,now,maxAgeSeconds)&&nonnegative(model.aCheckPrice)&&model.aCheckPrice>0&&
    Number.isFinite(model.checkIntervalHours)&&model.checkIntervalHours>0?
    exactMode
      ? model.aCheckPrice*mode!.aCheckCostMultiplier!*Math.ceil((quote.durationSeconds/3600)*mode!.speedMultiplier!)/model.checkIntervalHours
      : model.aCheckPrice/model.checkIntervalHours*quote.durationSeconds/3600
    : null;
  const maintenance=references.maintenance;
  const sameAircraft=!!maintenance&&maintenance.aircraftId===quote.aircraftId&&maintenance.registration===quote.registration&&
    maintenance.source==='inspected-maintenance-plan'&&fresh(maintenance.observedAt,now,maxAgeSeconds)&&
    nonnegative(maintenance.hoursToCheck)&&nonnegative(maintenance.wearPercentage)&&maintenance.wearPercentage<=100;
  const calibrationVerified=references.co2Calibration?.formulaVerified===true;
  const calibratedAtCapacity=amount(calibratedCo2Cost(capacity));
  const calibratedAtDemandCeiling=amount(calibratedCo2Cost(cabinsAtDemandCeiling));
  const co2AtDemandCeiling=calibrationVerified?calibratedAtDemandCeiling:amount(co2Value(passengersAtDemandCeiling));
  const aCheckCatalogProration=amount(aCheckValue);
  const acquisitionVerified=model?.source==='community-reference'||model?.communityCrossCheck?.verified===true;
  const communityAcquisitionCost=acquisitionVerified&&
    typeof model?.acquisitionCost==='number'&&nonnegative(model.acquisitionCost)?model.acquisitionCost:null;
  const repairAtTraining0=communityAcquisitionCost!==null?amount(communityAcquisitionCost/1000*0.0075):null;
  const repairAtTraining5=communityAcquisitionCost!==null?amount(communityAcquisitionCost/1000*0.0075*0.9):null;
  const subtotal=fuel!==null&&co2AtDemandCeiling!==null&&aCheckCatalogProration!==null?
    fuel+co2AtDemandCeiling+aCheckCatalogProration:null;
  return {kind:'reference_sensitivity_only',comparisonReady:false,mutationAuthorized:false,
    fuelAtMarketReplacementPrice:fuel,passengersAtCapacity,passengersAtDemandCeiling,
    co2:{atCapacity:calibrationVerified?calibratedAtCapacity:amount(co2Value(passengersAtCapacity)),atDemandCeiling:co2AtDemandCeiling,
      quotaConversionConfirmed:calibrationVerified,assumedQuotasPerKg:calibrationVerified?null:1,
      calibratedQuotasAtCapacity:calibrationVerified?calibratedQuotas(capacity):null,
      calibratedQuotasAtDemandCeiling:calibrationVerified?calibratedQuotas(cabinsAtDemandCeiling):null,
      formulaSource:calibrationVerified?'live flight history calibrated weighted-cabin formula':'AM4 calculator: Calculadoras (1)!G7 and Faturamento e Lucro!E14'},
    aCheck:{catalogProration:aCheckCatalogProration,effectiveAircraftCost:null,
      source:model?.source??null,modeVerified:exactMode,
      formulaSource:exactMode?'abc8747/am4 metrics::acheck_cost cross-checked game mode':'AM4 calculator: Faturamento e Lucro!E15',includesWearRepair:false,
      hoursToCheck:sameAircraft?maintenance!.hoursToCheck:null,wearPercentage:sameAircraft?maintenance!.wearPercentage:null,
      checkBeforeProposedLeg:sameAircraft&&context?maintenance!.hoursToCheck<quote.durationSeconds/3600:null},
    wearRepairReference:{expectedPerDepartureAtTraining0:repairAtTraining0,expectedPerDepartureAtTraining5:repairAtTraining5,
      acquisitionCost:communityAcquisitionCost,formulaSource:communityAcquisitionCost!==null?'abc8747/am4 expected repair formula; training level unknown':null,
      effectiveCostConfirmed:false},
    partialSubtotalAtDemandCeiling:amount(subtotal),totalOperatingCost:null,
    setupFee:context&&nonnegative(quote.routeFee)?quote.routeFee:null,
    missing:[...(!calibrationVerified?['CO2_QUOTA_CONVERSION']:[]),'EFFECTIVE_A_CHECK_PRICE','WEAR_REPAIR_COST','AIRPORT_COST',
      'STAFF_ALLOCATION','MARKETING_ALLOCATION','OTHER_RECURRING_COSTS','INVENTORY_ACQUISITION_COST']};
}
