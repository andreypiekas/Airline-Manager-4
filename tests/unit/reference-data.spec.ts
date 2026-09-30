import { test, expect } from '@playwright/test';
import { calendarReference, FuelCalendar, shortlistRoutes, RouteCatalog } from '../../optimization/reference-data';
import { AircraftSnapshot } from '../../demand/types';
const a:AircraftSnapshot={aircraftId:'1',routeId:'2',registration:'TEST',routeLabel:'GRU-BSB',from:'GRU',to:'BSB',state:'ready',capacity:{Y:100,J:0,F:0},remaining:{Y:0,J:0,F:0},dailyTotal:{Y:1,J:1,F:1},observedAt:new Date().toISOString(),operational:{rangeKm:5000,minRunwayFt:5000,flightHours:1,cycles:1,homeBase:null,flightId:null}};
const catalog:RouteCatalog={schemaVersion:1,source:'fixture',sha256:'test',routes:[{from:'GRU',to:'BSB',distanceKm:1000,referenceDemand:{Y:1000,J:0,F:0},sourceRow:2},{from:'GRU',to:'DTW',distanceKm:9000,referenceDemand:{Y:1000,J:0,F:0},sourceRow:3}]};
test('reference route shortlist filters direct range and never supplies remaining demand or profit',()=>{
 const r=shortlistRoutes(a,'GRU',catalog);expect(r).toHaveLength(1);expect(r[0]).toMatchObject({to:'BSB',remainingDemand:null,estimatedProfit:null,mutationAuthorized:false});expect(a.remaining!.Y).toBe(0);
});
test('reverse source is disclosed and not silently treated as a live directional quote',()=>{
 const r=shortlistRoutes(a,'BSB',catalog);expect(r[0]).toMatchObject({from:'BSB',to:'GRU',sourceDirection:'GRU-BSB',remainingDemand:null});
});
test('conflicting, incomplete and out-of-range records cannot produce an actionable candidate',()=>{
 expect(shortlistRoutes(a,null,catalog)).toEqual([]);expect(shortlistRoutes({...a,operational:null},'GRU',catalog)).toEqual([]);
 expect(shortlistRoutes(a,'GRU',{...catalog,routes:catalog.routes.map(r=>({...r,conflict:true}))})).toEqual([]);
});
const cal:FuelCalendar={monthLength:30,utcOffsetMinutes:-180,source:'fixture',status:'ocr-unverified',days:[{day:1,page:2,verified:false,fuel:[[0,380],[90,800],[810,300]],co2:[[0,147]],fuelIssues:false,co2Issues:false}]};
test('fuel calendar uses fixed GMT-3 and only listed times, never forward-fills prices',()=>{
 const exact=calendarReference(new Date('2026-09-01T03:00:00Z'),cal,'fuel');expect(exact).toMatchObject({status:'ocr-unverified',listedPrice:380,purchaseAuthorized:false});
 const gap=calendarReference(new Date('2026-09-01T04:00:00Z'),cal,'fuel');expect(gap).toMatchObject({listedPrice:null,purchaseAuthorized:false});
});
test('calendar selects actual month length and refuses February or wrong dataset',()=>{
 expect(calendarReference(new Date('2026-10-01T12:00:00Z'),cal,'fuel').status).toBe('unsupported-month');
 expect(calendarReference(new Date('2028-02-01T12:00:00Z'),cal,'fuel').status).toBe('unsupported-month');
});
test('invalid or ambiguous OCR slots cannot be used',()=>{
 const bad={...cal,days:[{...cal.days[0],fuel:[[0,380],[0,400]]}]};expect(calendarReference(new Date('2026-09-01T03:00:00Z'),bad,'fuel').status).toBe('unavailable');
});

import { writeReferenceReport } from '../../optimization/reference-report';
import { optimizationConfig } from '../../optimization/report';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('packaged references generate a simulation artifact and incomplete collection has no candidates',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'am4-reference-'));
 try {
  const collection={aircraft:[a],complete:true,expectedRoutes:1,warnings:[]};
  const report=await writeReferenceReport(collection,optimizationConfig({}),directory,new Date('2026-09-01T03:00:00Z'));
  expect(report.warnings).toEqual([]);
  expect(report.routes[0]).toMatchObject({aircraftId:'1',candidates:expect.any(Array)});
  const disk=JSON.parse(await readFile(join(directory,'reference-report.json'),'utf8'));
  expect(disk.routes[0].candidates.length).toBeGreaterThan(0);
  expect(disk).toMatchObject({dryRun:true,mutationAuthorized:false,referenceOnly:true,fuel:{status:'ocr-unverified',purchaseAuthorized:false}});
  const incomplete=await writeReferenceReport({...collection,complete:false},optimizationConfig({}),directory);
  expect(incomplete.routes[0]).toMatchObject({candidates:[]});
 } finally {await rm(directory,{recursive:true,force:true});}
});
