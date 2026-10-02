import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AircraftSnapshot } from '../demand/types';
export interface ReferenceRoute { from: string; to: string; distanceKm: number; referenceDemand: {Y:number;J:number;F:number}; sourceRow: number; conflict?: boolean }
export interface RouteCatalog { schemaVersion: number; source: string; sha256: string; routes: ReferenceRoute[] }
export interface CalendarDay { day: number; page: number; verified: boolean; fuel: number[][]; co2: number[][]; fuelIssues: boolean; co2Issues: boolean }
export interface FuelCalendar { monthLength: number; utcOffsetMinutes: number; source: string; status: string; days: CalendarDay[] }
export interface AirportReference {
  iata:string; runwayFt:number|null; lat?:number|null; lng?:number|null; market?:number|null; hubCost?:number|null;
  sourceIds:number[]; conflict?:boolean; runwayCandidatesFt?:number[]; coordinateCandidates?:Array<{lat:number;lng:number}>;
}
export interface AirportCatalog {
  schemaVersion:number; source:string; license:string; generatedAt:string; airports:AirportReference[];
}
export interface AirportDistanceEvidence {
  from:string;to:string;distanceKm:number|null;quoteDistanceKm:number|null;deltaKm:number|null;
  originSourceIds:number[];destinationSourceIds:number[];destinationAirportIdMatches:boolean|null;
  source:string|null;status:'cross_checked'|'reference_only'|'unavailable';
  comparisonReady:false;mutationAuthorized:false;
}
export interface AircraftReferenceVariant {
  modelId:number;shortname:string;manufacturer:string;modelName:string;type:number;priority:number;engineId:number;engineName:string;
  speedKph:number;fuelLbsPerKm:number;co2KgPerPaxKm:number;acquisitionCost:number;capacityUnits:number;minRunwayFt:number;
  aCheckPrice:number;rangeKm:number;checkIntervalHours:number;
}
export interface AircraftCatalog {
  schemaVersion:number;source:string;upstreamCommit:string;license:string;generatedAt:string;
  models:Array<{modelId:number;variants:AircraftReferenceVariant[]}>;
}
export interface AirportRunwayEvidence {
  from:string;to:string;requiredRunwayFt:number;
  originRunwayFt:number|null;destinationRunwayFt:number|null;
  originObserved:boolean;destinationObserved:boolean;
  adequate:boolean|null;
  source:string|null;
  status:'reference_verified'|'insufficient_reference'|'unavailable';
  comparisonReady:false;
  mutationAuthorized:false;
}
export async function loadReference<T>(name: 'routes.json' | 'airports.json' | 'aircrafts.json' | 'fuel-calendar-30.json' | 'fuel-calendar-31.json'): Promise<T> {
  return JSON.parse(await readFile(join(__dirname, '../data/reference', name), 'utf8')) as T;
}
export function aircraftReferenceByModel(
  modelId:number,catalog:AircraftCatalog|null
):{status:'unique'|'ambiguous'|'unavailable';reference:AircraftReferenceVariant|null;source:string|null}{
  if(!Number.isSafeInteger(modelId)||modelId<1||!catalog||catalog.schemaVersion!==1||!Array.isArray(catalog.models))
    return {status:'unavailable',reference:null,source:null};
  const rows=catalog.models.filter(m=>m.modelId===modelId);
  if(rows.length!==1||!Array.isArray(rows[0].variants)||!rows[0].variants.length)
    return {status:'unavailable',reference:null,source:catalog.source};
  const variants=rows[0].variants.filter(v=>v.modelId===modelId&&Number.isSafeInteger(v.priority)&&v.priority>=0&&
    Number.isFinite(v.acquisitionCost)&&v.acquisitionCost>0&&Number.isFinite(v.aCheckPrice)&&v.aCheckPrice>0&&
    Number.isFinite(v.checkIntervalHours)&&v.checkIntervalHours>0&&Number.isFinite(v.minRunwayFt)&&v.minRunwayFt>0);
  const primary=variants.filter(v=>v.priority===0);
  if(primary.length!==1)return {status:'ambiguous',reference:null,source:catalog.source};
  return {status:'unique',reference:primary[0],source:catalog.source};
}

export function airportDistanceEvidence(
  from:string,to:string,catalog:AirportCatalog|null,quoteDistanceKm:number|null=null,destinationAirportId:string|null=null
):AirportDistanceEvidence {
  const base:AirportDistanceEvidence={from,to,distanceKm:null,quoteDistanceKm,deltaKm:null,originSourceIds:[],destinationSourceIds:[],
    destinationAirportIdMatches:null,source:null,status:'unavailable',comparisonReady:false,mutationAuthorized:false};
  if(!catalog||![1,2].includes(catalog.schemaVersion)||!Array.isArray(catalog.airports)||!/^[A-Z0-9]{3}$/.test(from)||
    !/^[A-Z0-9]{3}$/.test(to)||from===to)return base;
  const one=(iata:string)=>{
    const rows=catalog.airports.filter(a=>a.iata===iata&&!a.conflict&&Number.isFinite(a.lat)&&Number.isFinite(a.lng));
    return rows.length===1?rows[0]:null;
  };
  const a=one(from),b=one(to);
  if(!a||!b)return {...base,source:catalog.source,originSourceIds:a?.sourceIds||[],destinationSourceIds:b?.sourceIds||[]};
  const rad=(n:number)=>n*Math.PI/180, dLat=rad(b.lat!-a.lat!), dLng=rad(b.lng!-a.lng!);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat!))*Math.cos(rad(b.lat!))*Math.sin(dLng/2)**2;
  const distance=2*6371*Math.asin(Math.min(1,Math.sqrt(h)));
  if(!Number.isFinite(distance)||distance<=0)return base;
  const rounded=Math.round(distance);
  const validQuote=typeof quoteDistanceKm==='number'&&Number.isFinite(quoteDistanceKm)&&quoteDistanceKm>0;
  const delta=validQuote?Math.abs(rounded-quoteDistanceKm!):null;
  const idMatches=destinationAirportId===null?null:
    (/^[1-9]\d*$/.test(destinationAirportId)&&b.sourceIds.includes(Number(destinationAirportId)));
  const cross=validQuote&&delta!==null&&delta<=2&&idMatches!==false;
  return {...base,distanceKm:rounded,deltaKm:delta,originSourceIds:[...a.sourceIds],destinationSourceIds:[...b.sourceIds],
    destinationAirportIdMatches:idMatches,source:catalog.source,status:cross?'cross_checked':'reference_only'};
}

export function airportRunwayEvidence(from:string,to:string,requiredRunwayFt:number,catalog:AirportCatalog|null):AirportRunwayEvidence {
  const base:AirportRunwayEvidence={
    from,to,requiredRunwayFt,originRunwayFt:null,destinationRunwayFt:null,
    originObserved:false,destinationObserved:false,adequate:null,source:null,status:'unavailable',
    comparisonReady:false,mutationAuthorized:false
  };
  if(!catalog||![1,2].includes(catalog.schemaVersion)||!Array.isArray(catalog.airports)||!/^[A-Z0-9]{3}$/.test(from)||
    !/^[A-Z0-9]{3}$/.test(to)||from===to||!Number.isFinite(requiredRunwayFt)||requiredRunwayFt<0)return base;
  const unique=(iata:string)=>{
    const rows=catalog.airports.filter(a=>a.iata===iata&&!a.conflict&&Number.isSafeInteger(a.runwayFt)&&a.runwayFt!>0);
    return rows.length===1?rows[0]:null;
  };
  const origin=unique(from),destination=unique(to);
  const observed=!!origin&&!!destination;
  if(!observed)return {...base,originRunwayFt:origin?.runwayFt??null,destinationRunwayFt:destination?.runwayFt??null,
    originObserved:!!origin,destinationObserved:!!destination,source:catalog.source};
  const adequate=Math.min(origin!.runwayFt!,destination!.runwayFt!)>=requiredRunwayFt;
  return {...base,originRunwayFt:origin!.runwayFt!,destinationRunwayFt:destination!.runwayFt!,
    originObserved:true,destinationObserved:true,adequate,source:catalog.source,
    status:adequate?'reference_verified':'insufficient_reference'};
}

/** Shortlist for live research, not a profit ranking or permission to replace a route. */
export function shortlistRoutes(a: AircraftSnapshot, origin: string | null, catalog: RouteCatalog, limit = 10) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('REFERENCE_LIMIT_INVALID');
  if (!origin || !a.capacity || !a.operational || a.issue || !Number.isFinite(a.operational.rangeKm) || a.operational.rangeKm <= 0) return [];
  const seats = a.capacity.Y + a.capacity.J + a.capacity.F;
  if (!['Y','J','F'].every(k => Number.isSafeInteger(a.capacity![k as 'Y']) && a.capacity![k as 'Y'] >= 0) || seats <= 0) return [];
  const seen = new Set<string>();
  return catalog.routes.filter(r => !r.conflict && (r.from === origin || r.to === origin) && r.from !== r.to &&
    /^[A-Z]{3}$/.test(r.from) && /^[A-Z]{3}$/.test(r.to) && Number.isFinite(r.distanceKm) && r.distanceKm > 0 && r.distanceKm <= a.operational!.rangeKm &&
    r.referenceDemand && Object.values(r.referenceDemand).length === 3 && ['Y','J','F'].every(k => Number.isSafeInteger(r.referenceDemand[k as 'Y']) && r.referenceDemand[k as 'Y'] >= 0))
    .map(r => ({ from: origin, to: r.from === origin ? r.to : r.from, distanceKm: r.distanceKm,
      source: catalog.source, sourceRow: r.sourceRow, sourceDirection: `${r.from}-${r.to}`,
      referenceDemand: r.referenceDemand, referenceSeatCoverage: 100 * (Math.min(a.capacity!.Y,r.referenceDemand.Y)+Math.min(a.capacity!.J,r.referenceDemand.J)+Math.min(a.capacity!.F,r.referenceDemand.F))/seats,
      remainingDemand: null, estimatedProfit: null, mutationAuthorized: false,
      liveValidationRequired: ['remaining-demand-per-class-and-direction','automatic-fares','flight-time-and-costs','runway-and-aircraft-configuration','other-aircraft-reservations'] }))
    .sort((a,b) => b.referenceSeatCoverage-a.referenceSeatCoverage || a.distanceKm-b.distanceKm || a.to.localeCompare(b.to))
    .filter(r => { if(seen.has(r.to)) return false; seen.add(r.to); return true; }).slice(0,limit);
}
/** PDF contains listed times only. Never carry a quote forward across omitted times. */
export function calendarReference(now: Date, calendar: FuelCalendar, kind: 'fuel'|'co2') {
  if (!Number.isFinite(now.getTime()) || calendar.utcOffsetMinutes !== -180) throw new Error('CALENDAR_INVALID');
  const local = new Date(now.getTime()-180*60000);
  const days = new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+1,0)).getUTCDate();
  if (days !== calendar.monthLength || ![30,31].includes(days)) return {status:'unsupported-month',purchaseAuthorized:false};
  const day=calendar.days.find(d=>d.day===local.getUTCDate());
  if (!day || day[kind+'Issues' as 'fuelIssues']) return {status:'unavailable',purchaseAuthorized:false};
  const rows=day[kind];
  if (!Array.isArray(rows) || rows.some((r,i)=>r.length!==2 || !Number.isInteger(r[0]) || r[0]<0 || r[0]>=1440 || !Number.isInteger(r[1]) || r[1]<=0 || i>0 && rows[i-1][0]>=r[0])) return {status:'unavailable',purchaseAuthorized:false};
  const minute=local.getUTCHours()*60+local.getUTCMinutes();
  return {status:day.verified?'reference-only':'ocr-unverified',source:calendar.source,page:day.page,
    utcOffsetMinutes:-180,day:day.day,kind,listedPrice:rows.find(r=>r[0]===minute)?.[1]??null,
    upcomingListedSlots:rows.filter(r=>r[0]>minute).slice(0,5).map(([m,price])=>({time:`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,price})),
    purchaseAuthorized:false,requiresLivePrice:true};
}
