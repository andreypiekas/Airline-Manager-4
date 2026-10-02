import { test,expect } from '@playwright/test';
import { classifyDemandLabelSamples, DemandLabelCalibrationSample, demandCalibrationAirportCatalogSupported } from '../../optimization/demand-label-calibration';

const sample=(quoteDemand={Y:80,J:10,F:0},remaining={Y:80,J:10,F:0},dailyTotal={Y:200,J:40,F:0}):DemandLabelCalibrationSample=>({
  aircraftId:'1',registration:'TEST',routeId:'10',from:'AAA',to:'BBB',airportId:99,
  observedAt:new Date().toISOString(),quoteDemand,remaining,dailyTotal,currentRouteQuote:null,
  matchesRemaining:['Y','J','F'].every(k=>quoteDemand[k as 'Y']===remaining[k as 'Y']),
  matchesDailyTotal:['Y','J','F'].every(k=>quoteDemand[k as 'Y']===dailyTotal[k as 'Y'])
});

test('classifies repeated exact matches as remaining demand',()=>{
 expect(classifyDemandLabelSamples([sample(),sample({Y:70,J:8,F:0},{Y:70,J:8,F:0},{Y:200,J:40,F:0})])).toBe('remaining');
});
test('classifies repeated exact matches as daily total',()=>{
 expect(classifyDemandLabelSamples([
  sample({Y:200,J:40,F:0},{Y:80,J:10,F:0},{Y:200,J:40,F:0}),
  sample({Y:180,J:30,F:0},{Y:70,J:8,F:0},{Y:180,J:30,F:0})
 ])).toBe('daily_total');
});
test('equal remaining and daily total is inconclusive rather than promoted',()=>{
 expect(classifyDemandLabelSamples([sample({Y:100,J:10,F:0},{Y:100,J:10,F:0},{Y:100,J:10,F:0})])).toBe('mixed_or_unknown');
});
test('mixed observations remain unknown',()=>{
 expect(classifyDemandLabelSamples([
  sample(),
  sample({Y:200,J:40,F:0},{Y:70,J:8,F:0},{Y:200,J:40,F:0})
 ])).toBe('mixed_or_unknown');
});

test('demand calibration accepts both supported airport catalogue schemas and rejects unknown schema',()=>{
 const base:any={source:'fixture',license:'MIT',generatedAt:'2026-10-02',airports:[]};
 expect(demandCalibrationAirportCatalogSupported({...base,schemaVersion:1})).toBe(true);
 expect(demandCalibrationAirportCatalogSupported({...base,schemaVersion:2})).toBe(true);
 expect(demandCalibrationAirportCatalogSupported({...base,schemaVersion:3})).toBe(false);
 expect(demandCalibrationAirportCatalogSupported(null)).toBe(false);
});
