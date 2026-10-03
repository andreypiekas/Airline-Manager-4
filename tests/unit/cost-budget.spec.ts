import { test,expect } from '@playwright/test';
import { CandidateQuote } from '../../optimization/quote-reader';
import { candidateCostScenarios,COST_COMPONENTS,CostComponent,EffectiveCostEvidence,effectiveCostBudget } from '../../optimization/cost-budget';
const now=new Date('2026-10-01T12:00:00Z'),stamp=now.toISOString();
const quote={aircraftId:'1',registration:'SYNTHETIC',from:'AAA',to:'BBB',observedAt:stamp,distanceKm:1000,durationSeconds:7200,
  fuelLbs:10000,co2KgPerPaxKm:.2,routeFee:2000,autopriceReference:{modelId:1}} as CandidateQuote;
function references():Parameters<typeof candidateCostScenarios>[3]{return {
 fuel:{commodity:'fuel',pricePer1000:500,unit:'lbs',observedAt:stamp,source:'inspected-market',inventoryAcquisitionPrice:null},
 co2:{commodity:'co2',pricePer1000:100,unit:'quotas',observedAt:stamp,source:'inspected-market',inventoryAcquisitionPrice:null},
 model:{modelId:1,modelName:'SYNTHETIC',observedAt:stamp,aCheckPrice:100000,checkIntervalHours:500,source:'inspected-catalog',effectiveAircraftMaintenanceCost:null},
 maintenance:{aircraftId:'1',registration:'SYNTHETIC',observedAt:stamp,flightHours:100,hoursToCheck:1,wearPercentage:5,
  atAnyBase:true,source:'inspected-maintenance-plan',effectiveCheckPrice:null,effectiveRepairPrice:null}};}
const capacity={Y:50,J:20,F:10},remaining={Y:40,J:10,F:5};
test('reference calculation uses physical passengers and catalog hourly check rate; setup fee remains separate',()=>{
 const r=candidateCostScenarios(quote,capacity,remaining,references(),now);
 expect(r).toMatchObject({kind:'reference_sensitivity_only',passengersAtCapacity:80,passengersAtDemandCeiling:55,
  fuelAtMarketReplacementPrice:5000,co2:{atCapacity:1600,atDemandCeiling:1100,quotaConversionConfirmed:false},
  aCheck:{catalogProration:400,checkBeforeProposedLeg:true,effectiveAircraftCost:null,includesWearRepair:false},
  partialSubtotalAtDemandCeiling:6500,totalOperatingCost:null,setupFee:2000,comparisonReady:false});
});
test('verified game mode uses upstream ceil and multiplier for A-check reference',()=>{
 const ref=references();
 ref.gameModeEvidence={
  status:'verified',mode:'realism',variantPriority:0,engineId:1,speedMultiplier:1,aCheckCostMultiplier:2,
  fuelTraining:null,observedSpeedKph:500,expectedSpeedKph:500,fareBaseMatches:true,speedMatches:true,fuelMatches:false,co2FactorMatches:true,
  source:'live-quote-crosschecked-community-formula',reason:'FARE_AND_SPEED_CROSSCHECKED',
  comparisonReady:false,mutationAuthorized:false
 };
 const r=candidateCostScenarios(quote,capacity,remaining,ref,now);
 expect(r.aCheck).toMatchObject({catalogProration:800,modeVerified:true});
 expect(r.aCheck.formulaSource).toContain('metrics::acheck_cost');
 expect(r.comparisonReady).toBe(false);
});
test('unverified mode keeps A-check reference conservative and non-actionable',()=>{
 const ref=references();
 ref.gameModeEvidence={
  status:'unavailable',mode:null,variantPriority:null,engineId:null,speedMultiplier:null,aCheckCostMultiplier:null,
  fuelTraining:null,observedSpeedKph:null,expectedSpeedKph:null,fareBaseMatches:false,speedMatches:false,fuelMatches:false,co2FactorMatches:false,
  source:'live-quote-crosschecked-community-formula',reason:'EVIDENCE_INCOMPLETE',
  comparisonReady:false,mutationAuthorized:false
 };
 const r=candidateCostScenarios(quote,capacity,remaining,ref,now);
 expect(r.aCheck).toMatchObject({catalogProration:400,modeVerified:false});
 expect(r.mutationAuthorized).toBe(false);
});
test('verified live-history CO2 calibration replaces the one-quota-per-kg sensitivity assumption',()=>{
 const ref=references();
 ref.co2Calibration={
  aircraftId:'1',status:'verified_weighted_cabin_units',observedAt:stamp,quoteFactor:.2,calibratedFactorPerUnit:.2,fixedQuotasPerKm:.05,samples:[],
  weightedResidualSpread:0,physicalResidualSpread:.1,weightedMeanAbsoluteErrorRatio:0,physicalMeanAbsoluteErrorRatio:.1,
  formulaVerified:true,reason:'verified',comparisonReady:false,mutationAuthorized:false
 };
 const r=candidateCostScenarios(quote,capacity,remaining,ref,now);
 const capacityQuotas=Math.round(1000*(.05+.2*(50+2*20+3*10)));
 const remainingQuotas=Math.round(1000*(.05+.2*(40+2*10+3*5)));
 expect(r.co2).toMatchObject({
  quotaConversionConfirmed:true,assumedQuotasPerKg:null,
  calibratedQuotasAtCapacity:capacityQuotas,calibratedQuotasAtDemandCeiling:remainingQuotas,
  atCapacity:capacityQuotas*.1,atDemandCeiling:remainingQuotas*.1
 });
 expect(r.missing).not.toContain('CO2_QUOTA_CONVERSION');
 expect(r.comparisonReady).toBe(false);
});
test('calibrated CO2 demand ceiling is capped by cabin capacity, not raw remaining demand',()=>{
 const ref=references();
 ref.co2Calibration={
  aircraftId:'1',status:'verified_weighted_cabin_units',observedAt:stamp,quoteFactor:.2,calibratedFactorPerUnit:.2,fixedQuotasPerKm:.05,samples:[],
  weightedResidualSpread:0,physicalResidualSpread:.1,weightedMeanAbsoluteErrorRatio:0,physicalMeanAbsoluteErrorRatio:.1,
  formulaVerified:true,reason:'verified',comparisonReady:false,mutationAuthorized:false
 };
 const hugeRemaining={Y:500,J:200,F:100};
 const r=candidateCostScenarios(quote,capacity,hugeRemaining,ref,now);
 const capacityQuotas=Math.round(1000*(.05+.2*(50+2*20+3*10)));
 expect(r.passengersAtDemandCeiling).toBe(80);
 expect(r.co2.calibratedQuotasAtDemandCeiling).toBe(capacityQuotas);
 expect(r.co2.atDemandCeiling).toBe(capacityQuotas*.1);
 expect(r.co2.calibratedQuotasAtDemandCeiling).toBe(r.co2.calibratedQuotasAtCapacity);
});
test('community model fallback can supply reference A-check and repair sensitivity without becoming effective cost',()=>{
 const ref=references();
 ref.model={...ref.model!,source:'community-reference',acquisitionCost:860590,aCheckPrice:12705,checkIntervalHours:2000};
 const r=candidateCostScenarios(quote,capacity,remaining,ref,now);
 expect(r.aCheck).toMatchObject({source:'community-reference',effectiveAircraftCost:null});
 expect(r.wearRepairReference).toMatchObject({
  acquisitionCost:860590,
  expectedPerDepartureAtTraining0:860590/1000*.0075,
  expectedPerDepartureAtTraining5:860590/1000*.0075*.9,
  effectiveCostConfirmed:false
 });
 expect(r.missing).toContain('WEAR_REPAIR_COST');
 expect(r.comparisonReady).toBe(false);
});
test('absent remaining demand blocks occupancy-based subtotals without interpreting daily totals as remaining',()=>{
 const r=candidateCostScenarios({...quote,dailyDemand:{Y:1000,J:100,F:100}},capacity,null,references(),now);
 expect(r.co2.atDemandCeiling).toBeNull();expect(r.partialSubtotalAtDemandCeiling).toBeNull();expect(r.co2.atCapacity).toBe(1600);
});
test('zero-demand scenario has zero estimated emissions but effective CO2 is still unavailable',()=>{
 expect(candidateCostScenarios(quote,capacity,{Y:0,J:0,F:0},references(),now).co2.atDemandCeiling).toBe(0);
 expect(effectiveCostBudget(quote,{},now).components.co2.amount).toBeNull();
});
for(const variant of ['stale_quote','bad_distance','bad_duration','negative_fuel','nan_emission','overflow'])test(`inconsistent quote blocks reference costs: ${variant}`,()=>{
 const q={...quote};if(variant==='stale_quote')q.observedAt='2000-01-01T00:00:00Z';if(variant==='bad_distance')q.distanceKm=0;
 if(variant==='bad_duration')q.durationSeconds=-1;if(variant==='negative_fuel')q.fuelLbs=-1;if(variant==='nan_emission')q.co2KgPerPaxKm=NaN;
 if(variant==='overflow')q.fuelLbs=Number.MAX_VALUE;
 const r=candidateCostScenarios(q,capacity,remaining,references(),now);expect(r.fuelAtMarketReplacementPrice).toBeNull();expect(r.aCheck.catalogProration).toBeNull();
});
test('stale markets, wrong units and wrong models never create costs',()=>{
 const ref=references();ref.fuel!.unit='quotas';ref.co2!.observedAt='2027-01-01T00:00:00Z';ref.model!.modelId=2;
 const r=candidateCostScenarios(quote,capacity,remaining,ref,now);
 expect(r.fuelAtMarketReplacementPrice).toBeNull();expect(r.co2.atCapacity).toBeNull();expect(r.aCheck.catalogProration).toBeNull();
});
test('maintenance of another aircraft or an old observation cannot determine check availability',()=>{
 const ref=references();ref.maintenance!.aircraftId='2';
 expect(candidateCostScenarios(quote,capacity,remaining,ref,now).aCheck.checkBeforeProposedLeg).toBeNull();
 ref.maintenance!.aircraftId='1';ref.maintenance!.observedAt='2000-01-01T00:00:00Z';
 expect(candidateCostScenarios(quote,capacity,remaining,ref,now).aCheck.hoursToCheck).toBeNull();
});
function completeEvidence(){return Object.fromEntries(COST_COMPONENTS.map(k=>[k,{aircraftId:'1',from:'AAA',to:'BBB',observedAt:stamp,
 amount:100,currency:'USD',scope:'per-leg',source:'calibrated-allocation',verified:true}])) as Record<CostComponent,EffectiveCostEvidence>;}
test('synthetic complete evidence includes check, repairs, airports, staff, marketing and other recurring expenses',()=>{
 expect(effectiveCostBudget(quote,completeEvidence(),now)).toMatchObject({complete:true,totalRecurring:800,
 groupedCosts:{fuel:100,co2:100,maintenance:200,airportAndOther:400},missing:[],mutationAuthorized:false});
});
for(const component of COST_COMPONENTS)test(`missing ${component} prevents full operating costs`,()=>{
 const e=completeEvidence();delete (e as Partial<typeof e>)[component];
 expect(effectiveCostBudget(quote,e,now)).toMatchObject({complete:false,totalRecurring:null,groupedCosts:null,missing:[component]});
});
for(const variant of ['negative','nan','infinite','stale','future','identity','direction','currency','scope','source','unverified','overflow'])test(`invalid effective cost remains unavailable: ${variant}`,()=>{
 const e=completeEvidence(),a=e.aCheck as any;
 if(variant==='negative')a.amount=-1;if(variant==='nan')a.amount=NaN;if(variant==='infinite')a.amount=Infinity;
 if(variant==='stale')a.observedAt='2000-01-01T00:00:00Z';if(variant==='future')a.observedAt='2027-01-01T00:00:00Z';
 if(variant==='identity')a.aircraftId='2';if(variant==='direction')[a.from,a.to]=[a.to,a.from];
 if(variant==='currency')a.currency='EUR';if(variant==='scope')a.scope='per-day';if(variant==='source')a.source='inspected-catalog';
 if(variant==='unverified')a.verified=false;if(variant==='overflow')a.amount=Number.MAX_VALUE;
 expect(effectiveCostBudget(quote,e,now)).toMatchObject({complete:false,totalRecurring:null,missing:['aCheck']});
});
test('explicit verified zero is valid; omitted expenses never become zero, and unsafe totals are rejected',()=>{
 const e=completeEvidence();for(const k of COST_COMPONENTS)e[k].amount=0;
 expect(effectiveCostBudget(quote,e,now).totalRecurring).toBe(0);expect(effectiveCostBudget(quote,{},now).totalRecurring).toBeNull();
 for(const k of COST_COMPONENTS)e[k].amount=Number.MAX_SAFE_INTEGER;
 expect(effectiveCostBudget(quote,e,now)).toMatchObject({complete:false,totalRecurring:null,groupedCosts:null});
});
