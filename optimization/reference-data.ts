import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AircraftSnapshot } from '../demand/types';
export interface ReferenceRoute { from: string; to: string; distanceKm: number; referenceDemand: {Y:number;J:number;F:number}; sourceRow: number; conflict?: boolean }
export interface RouteCatalog { schemaVersion: number; source: string; sha256: string; routes: ReferenceRoute[] }
export interface CalendarDay { day: number; page: number; verified: boolean; fuel: number[][]; co2: number[][]; fuelIssues: boolean; co2Issues: boolean }
export interface FuelCalendar { monthLength: number; utcOffsetMinutes: number; source: string; status: string; days: CalendarDay[] }
export async function loadReference<T>(name: 'routes.json' | 'fuel-calendar-30.json' | 'fuel-calendar-31.json'): Promise<T> {
  return JSON.parse(await readFile(join(__dirname, '../data/reference', name), 'utf8')) as T;
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
