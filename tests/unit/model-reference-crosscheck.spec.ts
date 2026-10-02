import { test,expect } from '@playwright/test';
import { crossCheckCommunityAircraftReference } from '../../optimization/model-reference-crosscheck';
import type { ModelCostReference } from '../../optimization/cost-reference-reader';
import type { AircraftReferenceVariant } from '../../optimization/reference-data';

const live:ModelCostReference={
  modelId:344,modelName:'MC-21-400',observedAt:new Date().toISOString(),aCheckPrice:247214,checkIntervalHours:400,
  catalogFields:[
    {label:'Capacity',value:'230 pax'},{label:'Runway required',value:'6,800 ft'},
    {label:'A-Check',value:'$ 247,214'},{label:'Range',value:'5,500 km'},
    {label:'CO2 Emission',value:'0.16 kg/pax/km'},{label:'Maint check',value:'400 Hours'}
  ],
  source:'inspected-catalog',effectiveAircraftMaintenanceCost:null
};
const ref:AircraftReferenceVariant={
  modelId:344,shortname:'mc214',manufacturer:'Irkut',modelName:'MC-21-400',type:0,priority:0,engineId:312,engineName:'PW1400G',
  speedKph:1095.57,fuelLbsPerKm:19.57,co2KgPerPaxKm:.16,acquisitionCost:5204503,capacityUnits:230,minRunwayFt:6800,
  aCheckPrice:247214,rangeKm:5500,checkIntervalHours:400
};

test('seven exact live/community fields unlock acquisition cost as reference only',()=>{
  const r=crossCheckCommunityAircraftReference(live,ref);
  expect(r).toMatchObject({
    verified:true,acquisitionCost:5204503,fieldsConflicted:[],mutationAuthorized:false,
    reason:'LIVE_CATALOG_MATCHES_COMMUNITY_REFERENCE_ON_SEVEN_FIELDS'
  });
  expect(r.fieldsMatched).toEqual(expect.arrayContaining(['model-name','a-check','maint check','runway required','range','capacity','co2 emission']));
});

test('one conflicting live field fails the entire acquisition-cost cross-check',()=>{
  const r=crossCheckCommunityAircraftReference({...live,catalogFields:live.catalogFields!.map(x=>x.label==='Range'?{...x,value:'5,501 km'}:x)},ref);
  expect(r).toMatchObject({verified:false,acquisitionCost:null,reason:'REFERENCE_FIELD_CONFLICT'});
  expect(r.fieldsConflicted).toContain('range');
});

test('missing mandatory field stays incomplete',()=>{
  const r=crossCheckCommunityAircraftReference({...live,catalogFields:live.catalogFields!.filter(x=>x.label!=='Capacity')},ref);
  expect(r).toMatchObject({verified:false,acquisitionCost:null,reason:'REFERENCE_FIELDS_INCOMPLETE'});
});
