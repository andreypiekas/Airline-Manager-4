import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withRunLock } from '../utils/run-lock';
import { reviewEventId, RouteOptimizer, RoutePlan, RouteReview } from './route-optimizer';
import { reviewDay } from './review-schedule';

type CompletedDecision = 'would_reroute' | 'keep_route' | 'hold';
interface RoutePerformanceEvidence { routeId:string; viable:boolean; netProfit:number|null; netProfitPerHour:number|null; occupancyPercentages:number[] }
interface Entry { aircraftId: string; origin: string; flightId: string; reviewedAt: string; decision: CompletedDecision;
  reviewEvidence?: { trigger:'return'|'daily'; reviewedRouteId:string; selectedRouteId:string|null; result:CompletedDecision; routePerformance:RoutePerformanceEvidence[] } }
export interface FlightHistoryAnchorEvent { eventId:string; type:'flight-history-anchor'; aircraftId:string; registration:string; observedAt:string; cycles:number; rows:Array<{relativeTime:string;from:string;to:string;co2Quotas:number;onboard:{Y:number;J:number;F:number};fuelLbs:number;revenue:number}> }
export interface DepartureHistoryEvent { eventId:string; type:'departure'; aircraftId:string; registration:string; routeId:string; from:string; to:string; observedAt:string; result:'departed'; demand:{ availableBefore:{Y:number;J:number;F:number}; possiblePassengers:{Y:number;J:number;F:number}; occupancyPercentage:number }; actualOnboard:{Y:number;J:number;F:number} }
export interface SupplyObservationEvent { eventId:string; type:'supply-observation'; kind:'fuel'|'co2'; observedAt:string; pricePer1000:number; holding:number; remainingCapacity:number; balance:number }
export interface UiHealthObservation { eventId:string; type:'ui-health'; observedAt:string; status:'healthy'; surfaces:string[] }
export interface DemandHoldObservation { eventId:string; type:'demand-hold'; aircraftId:string; routeId:string; observedAt:string; occupancyPercentage:number; reason:'hold_insufficient' }
export interface Journal { schemaVersion: 1; scope: string; entries: Entry[]; events?:Array<DepartureHistoryEvent|FlightHistoryAnchorEvent>; supplyObservations?:SupplyObservationEvent[]; holdObservations?:DemandHoldObservation[]; uiHealthObservations?:UiHealthObservation[] }
export interface JournalOptions {
  /** Durable directory supplied by the caller; ephemeral Actions runners require explicit transport. */
  directory: string;
  /** Non-secret company/environment identifier. A journal cannot be reused across scopes. */
  scope: string;
  origin: string;
  minOccupancy?: number;
  minImprovementPercent?: number;
  maxAgeSeconds?: number;
}
const completed = (d: string): d is CompletedDecision => ['would_reroute', 'keep_route', 'hold'].includes(d);
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const validOrigin = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const key = (e: Pick<Entry, 'aircraftId' | 'origin' | 'flightId'>) => JSON.stringify([e.aircraftId, e.origin, e.flightId]);
const validPerformance=(v:unknown):v is RoutePerformanceEvidence=>{
  if(!v||typeof v!=='object')return false;const x=v as RoutePerformanceEvidence;
  return Object.keys(x).sort().join(',')==='netProfit,netProfitPerHour,occupancyPercentages,routeId,viable'&&validId(x.routeId)&&typeof x.viable==='boolean'&&
    (x.netProfit===null||Number.isFinite(x.netProfit))&&(x.netProfitPerHour===null||Number.isFinite(x.netProfitPerHour))&&Array.isArray(x.occupancyPercentages)&&
    x.occupancyPercentages.length<=2&&x.occupancyPercentages.every(n=>Number.isFinite(n)&&n>=0&&n<=100);
};
const validReviewEvidence=(v:unknown,decision:CompletedDecision)=>{
  if(!v||typeof v!=='object')return false;const x=v as NonNullable<Entry['reviewEvidence']>;
  return Object.keys(x).sort().join(',')==='result,reviewedRouteId,routePerformance,selectedRouteId,trigger'&&['return','daily'].includes(x.trigger)&&
    validId(x.reviewedRouteId)&&(x.selectedRouteId===null||validId(x.selectedRouteId))&&x.result===decision&&Array.isArray(x.routePerformance)&&
    x.routePerformance.length>0&&x.routePerformance.length<=100&&x.routePerformance.every(validPerformance);
};
const validCabins=(v:any)=>v&&typeof v==='object'&&Object.keys(v).sort().join(',')==='F,J,Y'&&['Y','J','F'].every(k=>Number.isSafeInteger(v[k])&&v[k]>=0);
const validFlightHistoryAnchor=(v:unknown,now:Date):v is FlightHistoryAnchorEvent=>{if(!v||typeof v!=='object')return false;const x=v as FlightHistoryAnchorEvent;if(Object.keys(x).sort().join(',')!=='aircraftId,cycles,eventId,observedAt,registration,rows,type'||!validId(x.eventId)||x.type!=='flight-history-anchor'||!validId(x.aircraftId)||typeof x.registration!=='string'||!x.registration||x.registration.length>100||typeof x.observedAt!=='string'||!Number.isFinite(Date.parse(x.observedAt))||Date.parse(x.observedAt)>now.getTime()||!Number.isSafeInteger(x.cycles)||x.cycles<0||!Array.isArray(x.rows)||x.rows.length<1||x.rows.length>8)return false;return x.rows.every(r=>r&&typeof r==='object'&&Object.keys(r).sort().join(',')==='co2Quotas,from,fuelLbs,onboard,relativeTime,revenue,to'&&typeof r.relativeTime==='string'&&r.relativeTime.length>0&&r.relativeTime.length<=40&&validOrigin(r.from)&&validOrigin(r.to)&&r.from!==r.to&&Number.isSafeInteger(r.co2Quotas)&&r.co2Quotas>=0&&validCabins(r.onboard)&&Number.isSafeInteger(r.fuelLbs)&&r.fuelLbs>=0&&Number.isSafeInteger(r.revenue)&&r.revenue>=0);};
const validDepartureEvent=(v:unknown,now:Date):v is DepartureHistoryEvent=>{
  if(!v||typeof v!=='object')return false;const x=v as DepartureHistoryEvent;
  return Object.keys(x).sort().join(',')==='actualOnboard,aircraftId,demand,eventId,from,observedAt,registration,result,routeId,to,type'&&validId(x.eventId)&&x.type==='departure'&&validId(x.aircraftId)&&
    typeof x.registration==='string'&&x.registration.length>0&&x.registration.length<=100&&validId(x.routeId)&&validOrigin(x.from)&&validOrigin(x.to)&&x.from!==x.to&&
    typeof x.observedAt==='string'&&Number.isFinite(Date.parse(x.observedAt))&&Date.parse(x.observedAt)<=now.getTime()&&x.result==='departed'&&
    x.demand&&Object.keys(x.demand).sort().join(',')==='availableBefore,occupancyPercentage,possiblePassengers'&&validCabins(x.demand.availableBefore)&&validCabins(x.demand.possiblePassengers)&&
    Number.isFinite(x.demand.occupancyPercentage)&&x.demand.occupancyPercentage>=0&&x.demand.occupancyPercentage<=100&&validCabins(x.actualOnboard);
};
const validHoldObservation=(v:unknown,now:Date):v is DemandHoldObservation=>{if(!v||typeof v!=='object')return false;const x=v as DemandHoldObservation;return Object.keys(x).sort().join(',')==='aircraftId,eventId,observedAt,occupancyPercentage,reason,routeId,type'&&validId(x.eventId)&&x.type==='demand-hold'&&validId(x.aircraftId)&&validId(x.routeId)&&typeof x.observedAt==='string'&&Number.isFinite(Date.parse(x.observedAt))&&Date.parse(x.observedAt)<=now.getTime()&&Number.isFinite(x.occupancyPercentage)&&x.occupancyPercentage>=0&&x.occupancyPercentage<=100&&x.reason==='hold_insufficient';};
const validUiHealthObservation=(v:unknown,now:Date):v is UiHealthObservation=>{if(!v||typeof v!=='object')return false;const x=v as UiHealthObservation;return Object.keys(x).sort().join(',')==='eventId,observedAt,status,surfaces,type'&&validId(x.eventId)&&x.type==='ui-health'&&x.status==='healthy'&&typeof x.observedAt==='string'&&Number.isFinite(Date.parse(x.observedAt))&&Date.parse(x.observedAt)<=now.getTime()&&Array.isArray(x.surfaces)&&x.surfaces.length===5&&x.surfaces.join(',')==='login,fleet,maintenance,marketing,supplies';};
const validSupplyObservation=(v:unknown,now:Date):v is SupplyObservationEvent=>{if(!v||typeof v!=='object')return false;const x=v as SupplyObservationEvent;return Object.keys(x).sort().join(',')==='balance,eventId,holding,kind,observedAt,pricePer1000,remainingCapacity,type'&&validId(x.eventId)&&x.type==='supply-observation'&&['fuel','co2'].includes(x.kind)&&typeof x.observedAt==='string'&&Number.isFinite(Date.parse(x.observedAt))&&Date.parse(x.observedAt)<=now.getTime()&&Number.isSafeInteger(x.pricePer1000)&&x.pricePer1000>0&&Number.isSafeInteger(x.holding)&&(x.kind==='co2'||x.holding>=0)&&Number.isSafeInteger(x.remainingCapacity)&&x.remainingCapacity>=0&&Number.isSafeInteger(x.balance)&&x.balance>=0;};
export function validateReturnJournal(value: unknown, scope: string, now: Date): Journal {
  const data = value as Journal;
  const topKeys=Object.keys(data||{}).sort().join(',');
  if (!data || typeof data !== 'object' || !['entries,schemaVersion,scope','entries,events,schemaVersion,scope','entries,schemaVersion,scope,supplyObservations','entries,events,schemaVersion,scope,supplyObservations','entries,holdObservations,schemaVersion,scope','entries,events,holdObservations,schemaVersion,scope','entries,holdObservations,schemaVersion,scope,supplyObservations','entries,events,holdObservations,schemaVersion,scope,supplyObservations','entries,schemaVersion,scope,uiHealthObservations','entries,events,schemaVersion,scope,uiHealthObservations','entries,schemaVersion,scope,supplyObservations,uiHealthObservations','entries,events,schemaVersion,scope,supplyObservations,uiHealthObservations','entries,holdObservations,schemaVersion,scope,uiHealthObservations','entries,events,holdObservations,schemaVersion,scope,uiHealthObservations','entries,holdObservations,schemaVersion,scope,supplyObservations,uiHealthObservations','entries,events,holdObservations,schemaVersion,scope,supplyObservations,uiHealthObservations'].includes(topKeys) || data.schemaVersion !== 1 || data.scope !== scope || !Array.isArray(data.entries) || data.entries.length > 100000 ||
      ('events' in data&&(!Array.isArray(data.events)||data.events.length>100000))||('uiHealthObservations' in data&&(!Array.isArray(data.uiHealthObservations)||data.uiHealthObservations.length>100000))||('supplyObservations' in data&&(!Array.isArray(data.supplyObservations)||data.supplyObservations.length>100000))||('holdObservations' in data&&(!Array.isArray(data.holdObservations)||data.holdObservations.length>100000))) throw new Error('JOURNAL_INVALID');
  const seen = new Set<string>();
  for (const e of data.entries) {
    const keys=Object.keys(e||{}).sort().join(',');
    if (!e || typeof e !== 'object' || !['aircraftId,decision,flightId,origin,reviewedAt','aircraftId,decision,flightId,origin,reviewEvidence,reviewedAt'].includes(keys) || !validId(e.aircraftId) || !validId(e.flightId) || !validOrigin(e.origin) || !completed(e.decision) ||
        typeof e.reviewedAt !== 'string' || !Number.isFinite(Date.parse(e.reviewedAt)) || Date.parse(e.reviewedAt) > now.getTime() || seen.has(key(e)) ||
        ('reviewEvidence' in e && !validReviewEvidence(e.reviewEvidence,e.decision))) throw new Error('JOURNAL_INVALID');
    seen.add(key(e));
  }
  const eventIds=new Set<string>();
  for(const e of data.events||[]){if(!((e as any)?.type==='departure'?validDepartureEvent(e,now):validFlightHistoryAnchor(e,now))||eventIds.has(e.eventId))throw new Error('JOURNAL_INVALID');eventIds.add(e.eventId);}
  const uiIds=new Set<string>();for(const e of data.uiHealthObservations||[]){if(!validUiHealthObservation(e,now)||uiIds.has(e.eventId))throw new Error('JOURNAL_INVALID');uiIds.add(e.eventId);}
  const supplyIds=new Set<string>();for(const e of data.supplyObservations||[]){if(!validSupplyObservation(e,now)||supplyIds.has(e.eventId))throw new Error('JOURNAL_INVALID');supplyIds.add(e.eventId);}
  const holdIds=new Set<string>();for(const e of data.holdObservations||[]){if(!validHoldObservation(e,now)||holdIds.has(e.eventId))throw new Error('JOURNAL_INVALID');holdIds.add(e.eventId);}
  return data;
}
export async function appendFlightHistoryAnchors(directory:string,scope:string,runId:string,collection:any,coverage:any[],now=new Date()):Promise<number>{
 if(!validId(scope)||!validId(runId)||!Number.isFinite(now.getTime())||!collection||!Array.isArray(collection.aircraft)||!Array.isArray(coverage))throw new Error('JOURNAL_CONFIG_INVALID');
 const wanted=new Set(coverage.filter(x=>x?.coversReset===false&&x?.historyStatus==='observed'&&Number.isSafeInteger(x?.visibleEntries)&&x.visibleEntries>0).map(x=>x.aircraftId));if(!wanted.size)return 0;
 const root=resolve(directory);await mkdir(root,{recursive:true});return withRunLock(async()=>{const filename=join(root,'return-journal.json');let data:Journal;try{data=validateReturnJournal(JSON.parse(await readFile(filename,'utf8')),scope,now);}catch{throw new Error('JOURNAL_UNAVAILABLE: ancora de historico bloqueada.');}const list=data.events?[...data.events]:[];let added=0;
 for(const a of collection.aircraft){if(!wanted.has(a?.aircraftId)||a?.flightHistory?.status!=='observed'||!Number.isSafeInteger(a?.operational?.cycles)||a.operational.cycles<0)continue;const rows=(a.flightHistory.entries||[]).slice(-8).map((r:any)=>({relativeTime:r.relativeTime,from:r.from,to:r.to,co2Quotas:r.co2Quotas,onboard:{...r.onboard},fuelLbs:r.fuelLbs,revenue:r.revenue}));if(!rows.length)continue;const event:FlightHistoryAnchorEvent={eventId:`hist_${runId}_${a.aircraftId}`,type:'flight-history-anchor',aircraftId:a.aircraftId,registration:a.registration,observedAt:a.flightHistory.observedAt,cycles:a.operational.cycles,rows};if(!validFlightHistoryAnchor(event,now))throw new Error('JOURNAL_FLIGHT_HISTORY_ANCHOR_INVALID');if(list.some(x=>x.eventId===event.eventId))continue;list.push(event);added++;}
 if(!added)return 0;if(list.length>100000)throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');data.events=list;const temporary=join(root,`return-journal.${randomUUID()}.tmp`);try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,filename);}catch{throw new Error('JOURNAL_SAVE_FAILED: ancora de historico nao persistida.');}finally{await unlink(temporary).catch(()=>undefined);}return added;},join(root,'.return-journal.lock'));
}
export async function appendUiHealthObservation(directory:string,scope:string,observedAt:string,surfaces:string[]):Promise<number>{const now=new Date(observedAt);if(!validId(scope)||!Number.isFinite(now.getTime()))throw new Error('JOURNAL_CONFIG_INVALID');const root=resolve(directory);return withRunLock(async()=>{const filename=join(root,'return-journal.json');const data=validateReturnJournal(JSON.parse(await readFile(filename,'utf8')),scope,now);const list=data.uiHealthObservations?[...data.uiHealthObservations]:[];const event:UiHealthObservation={eventId:'ui_'+observedAt.replace(/\D/g,'').slice(0,14),type:'ui-health',observedAt,status:'healthy',surfaces:[...surfaces]};if(!validUiHealthObservation(event,now))throw new Error('JOURNAL_UI_HEALTH_INVALID');if(list.some(x=>x.eventId===event.eventId))return 0;list.push(event);data.uiHealthObservations=list;const temporary=join(root,`return-journal.${randomUUID()}.tmp`);try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,filename);}finally{await unlink(temporary).catch(()=>undefined);}return 1;},join(root,'.return-journal.lock'));}
export async function appendConfirmedRerouteReviews(directory:string,scope:string,decisions:any[],candidates:any[],fleet:any[],origins:ReadonlyMap<string,string>,execution:any,reviewTimeZone:string,now=new Date()):Promise<number>{
 if(!validId(scope)||!Number.isFinite(now.getTime())||!Array.isArray(decisions)||!Array.isArray(candidates)||!Array.isArray(fleet)||!execution||execution.halted===true)throw new Error('JOURNAL_CONFIG_INVALID');const root=resolve(directory);await mkdir(root,{recursive:true});return withRunLock(async()=>{const filename=join(root,'return-journal.json');let data:Journal;try{data=validateReturnJournal(JSON.parse(await readFile(filename,'utf8')),scope,now);}catch{throw new Error('JOURNAL_UNAVAILABLE: historico de reroute bloqueado.');}let added=0;for(const d of decisions){if(d?.decision!=='would_reroute'||!d?.selected||!Number.isSafeInteger(d?.compared)||d.compared<1||!Number.isSafeInteger(d?.dominating)||d.dominating<1)continue;const matches=fleet.filter(a=>a?.aircraftId===d.aircraftId);if(matches.length!==1)continue;const a=matches[0],origin=origins.get(a.aircraftId);if(!origin||a.state!=='ready'||a.issue||a.from!==origin||!validId(a.routeId))continue;const done=(execution.entries||[]).filter((e:any)=>e?.aircraftId===a.aircraftId&&e?.status==='rerouted'&&e?.reason==='NATIVE_REROUTE_AND_FRESH_ROUTE_CONFIRMED'&&e.previousRouteId===a.routeId&&e.previousFrom===a.from&&e.previousTo===a.to&&e.targetFrom===d.selected.from&&e.targetTo===d.selected.to&&e.targetAirportId===d.selected.airportId&&validId(e.confirmedRouteId)&&e.confirmedRouteId!==a.routeId);if(done.length!==1)continue;const target=candidates.filter(c=>c?.aircraftId===a.aircraftId&&c?.from===d.selected.from&&c?.to===d.selected.to&&c?.airportId===d.selected.airportId&&c?.comparisonReady===true&&c?.variableCycleComparison?.comparisonReady===true&&c.variableCycleComparison.status==='candidate_dominates'&&c?.variableCycleComparison?.current?.comparisonReady===true&&c?.candidateVariableCycle?.comparisonReady===true);if(target.length!==1)continue;const v=target[0].variableCycleComparison,current=v.current,candidate=target[0].candidateVariableCycle;if(current.aircraftId!==a.aircraftId||current.from!==a.from||current.to!==a.to||candidate.aircraftId!==a.aircraftId||candidate.from!==d.selected.from||candidate.to!==d.selected.to)continue;const nums=[current.recurringCycleProfit?.expected,current.recurringCycleProfitPerHour?.expected,candidate.recurringCycleProfit?.expected,candidate.recurringCycleProfitPerHour?.expected];if(nums.some(n=>!Number.isFinite(n)))continue;const reviewDate=reviewDay(now,reviewTimeZone);if(data.entries.some(e=>e.aircraftId===a.aircraftId&&e.origin===origin&&reviewDay(new Date(e.reviewedAt),reviewTimeZone)===reviewDate))continue;const day=reviewDate.replace(/-/g,'');const entry:Entry={aircraftId:a.aircraftId,origin,flightId:`daily_${day}`,reviewedAt:now.toISOString(),decision:'would_reroute',reviewEvidence:{trigger:'daily',reviewedRouteId:a.routeId,selectedRouteId:done[0].confirmedRouteId,result:'would_reroute',routePerformance:[{routeId:a.routeId,viable:true,netProfit:current.recurringCycleProfit.expected,netProfitPerHour:current.recurringCycleProfitPerHour.expected,occupancyPercentages:[]},{routeId:done[0].confirmedRouteId,viable:true,netProfit:candidate.recurringCycleProfit.expected,netProfitPerHour:candidate.recurringCycleProfitPerHour.expected,occupancyPercentages:[]}]}};if(data.entries.some(e=>key(e)===key(entry)))continue;if(!validReviewEvidence(entry.reviewEvidence,entry.decision))throw new Error('JOURNAL_REROUTE_REVIEW_INVALID');if(data.entries.length>=100000)throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');data.entries.push(entry);added++;}if(!added)return 0;const temporary=join(root,`return-journal.${randomUUID()}.tmp`);try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,filename);}catch{throw new Error('JOURNAL_SAVE_FAILED: reroute confirmado nao persistido.');}finally{await unlink(temporary).catch(()=>undefined);}return added;},join(root,'.return-journal.lock'));
}
export async function appendVerifiedKeepRouteDecisions(directory:string,scope:string,decisions:any[],candidates:any[],fleet:any[],origins:ReadonlyMap<string,string>,reviewTimeZone:string,now=new Date()):Promise<number>{
 if(!validId(scope)||!Number.isFinite(now.getTime())||!Array.isArray(decisions)||!Array.isArray(candidates)||!Array.isArray(fleet))throw new Error('JOURNAL_CONFIG_INVALID');
 const root=resolve(directory);await mkdir(root,{recursive:true});return withRunLock(async()=>{const filename=join(root,'return-journal.json');let data:Journal;try{data=validateReturnJournal(JSON.parse(await readFile(filename,'utf8')),scope,now);}catch{throw new Error('JOURNAL_UNAVAILABLE: historico de revisao bloqueado.');}
 let added=0;for(const d of decisions){if(d?.decision!=='keep_route'||d?.selected!==null||!Number.isSafeInteger(d?.compared)||d.compared<1||d.reason!=='NO_INSPECTED_CANDIDATE_PROVES_CONSERVATIVE_DOMINANCE')continue;const matches=fleet.filter(a=>a?.aircraftId===d.aircraftId);if(matches.length!==1)continue;const a=matches[0],origin=origins.get(a.aircraftId);if(!origin||a.state!=='ready'||a.issue||a.from!==origin||!validId(a.routeId))continue;const comparable=candidates.filter(c=>c?.aircraftId===a.aircraftId&&c?.comparisonReady===true&&c?.variableCycleComparison?.comparisonReady===true&&c.variableCycleComparison.status==='keep_current'&&c?.variableCycleComparison?.current?.comparisonReady===true);if(comparable.length!==d.compared)continue;const current=comparable.map(c=>c.variableCycleComparison.current);if(current.some(x=>x.aircraftId!==a.aircraftId||x.from!==a.from||x.to!==a.to||!Number.isFinite(x.recurringCycleProfit?.expected)||!Number.isFinite(x.recurringCycleProfitPerHour?.expected)))continue;const profit=current[0].recurringCycleProfit.expected,perHour=current[0].recurringCycleProfitPerHour.expected;if(current.some(x=>x.recurringCycleProfit.expected!==profit||x.recurringCycleProfitPerHour.expected!==perHour))continue;const reviewDate=reviewDay(now,reviewTimeZone);if(data.entries.some(e=>e.aircraftId===a.aircraftId&&e.origin===origin&&reviewDay(new Date(e.reviewedAt),reviewTimeZone)===reviewDate))continue;const day=reviewDate.replace(/-/g,'');const entry:Entry={aircraftId:a.aircraftId,origin,flightId:`daily_${day}`,reviewedAt:now.toISOString(),decision:'keep_route',reviewEvidence:{trigger:'daily',reviewedRouteId:a.routeId,selectedRouteId:null,result:'keep_route',routePerformance:[{routeId:a.routeId,viable:true,netProfit:profit,netProfitPerHour:perHour,occupancyPercentages:[]}]}};if(data.entries.some(e=>key(e)===key(entry)))continue;if(!validReviewEvidence(entry.reviewEvidence,entry.decision))throw new Error('JOURNAL_ROUTE_REVIEW_INVALID');if(data.entries.length>=100000)throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');data.entries.push(entry);added++;}
 if(!added)return 0;const temporary=join(root,`return-journal.${randomUUID()}.tmp`);try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,filename);}catch{throw new Error('JOURNAL_SAVE_FAILED: revisao KEEP nao persistida.');}finally{await unlink(temporary).catch(()=>undefined);}return added;},join(root,'.return-journal.lock'));
}
export async function appendDemandHoldObservations(directory:string,scope:string,runId:string,report:{entries:any[]},now=new Date()):Promise<number>{
 if(!validId(scope)||!validId(runId)||!Number.isFinite(now.getTime()))throw new Error('JOURNAL_CONFIG_INVALID');const root=resolve(directory);await mkdir(root,{recursive:true});return withRunLock(async()=>{const filename=join(root,'return-journal.json');let data:Journal;try{data=validateReturnJournal(JSON.parse(await readFile(filename,'utf8')),scope,now);}catch{throw new Error('JOURNAL_UNAVAILABLE: historico de holds bloqueado.');}const list=data.holdObservations?[...data.holdObservations]:[];let added=0;for(const e of report.entries||[]){if(e?.status!=='held'||e?.demand?.decision!=='hold_insufficient'||!Number.isFinite(e?.demand?.occupancyPercentage))continue;const event:DemandHoldObservation={eventId:`hold_${runId}_${e.aircraftId}_${e.routeId}`,type:'demand-hold',aircraftId:e.aircraftId,routeId:e.routeId,observedAt:now.toISOString(),occupancyPercentage:e.demand.occupancyPercentage,reason:'hold_insufficient'};if(!validHoldObservation(event,now))throw new Error('JOURNAL_HOLD_EVENT_INVALID');if(list.some(x=>x.eventId===event.eventId))continue;list.push(event);added++;}if(!added)return 0;if(list.length>100000)throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');data.holdObservations=list;const temporary=join(root,`return-journal.${randomUUID()}.tmp`);try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,filename);}catch{throw new Error('JOURNAL_SAVE_FAILED: historico de holds nao persistido.');}finally{await unlink(temporary).catch(()=>undefined);}return added;},join(root,'.return-journal.lock'));
}
export async function appendSupplyObservation(directory:string,scope:string,runId:string,kind:'fuel'|'co2',snapshot:{pricePer1000:number;holding:number;remainingCapacity:number;balance:number},now=new Date()):Promise<boolean>{
 if(!validId(scope)||!validId(runId)||!Number.isFinite(now.getTime()))throw new Error('JOURNAL_CONFIG_INVALID');const root=resolve(directory);await mkdir(root,{recursive:true});return withRunLock(async()=>{const filename=join(root,'return-journal.json');let data:Journal;try{data=validateReturnJournal(JSON.parse(await readFile(filename,'utf8')),scope,now);}catch{throw new Error('JOURNAL_UNAVAILABLE: historico de suprimentos bloqueado.');}const event:SupplyObservationEvent={eventId:`sup_${runId}_${kind}`,type:'supply-observation',kind,observedAt:now.toISOString(),pricePer1000:snapshot.pricePer1000,holding:snapshot.holding,remainingCapacity:snapshot.remainingCapacity,balance:snapshot.balance};if(!validSupplyObservation(event,now))throw new Error('JOURNAL_SUPPLY_EVENT_INVALID');const list=data.supplyObservations?[...data.supplyObservations]:[];if(list.some(x=>x.eventId===event.eventId))return false;if(list.length>=100000)throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');list.push(event);data.supplyObservations=list;const temporary=join(root,`return-journal.${randomUUID()}.tmp`);try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,filename);}catch{throw new Error('JOURNAL_SAVE_FAILED: observacao de suprimento nao persistida.');}finally{await unlink(temporary).catch(()=>undefined);}return true;},join(root,'.return-journal.lock'));
}
export async function appendConfirmedDepartures(directory:string,scope:string,runId:string,report:{entries:any[]},now=new Date()):Promise<number>{
  if(!validId(scope)||!validId(runId)||!Number.isFinite(now.getTime()))throw new Error('JOURNAL_CONFIG_INVALID');
  const root=resolve(directory);await mkdir(root,{recursive:true});
  return withRunLock(async()=>{
    const filename=join(root,'return-journal.json');let data:Journal;
    try{data=validateReturnJournal(JSON.parse(await readFile(filename,'utf8')),scope,now);}catch{throw new Error('JOURNAL_UNAVAILABLE: registro invalido/inacessivel; historico de decolagem bloqueado.');}
    const events=data.events?[...data.events]:[];let added=0;
    for(const e of report.entries||[]){
      if(e?.status!=='departed'||e.reason!=='NATIVE_INFLIGHT_IDENTITY_COUNTDOWN_AND_ONBOARD_CONFIRMED'||!e.actualOnboard||!e.demand?.availableBefore||!e.demand?.possiblePassengers||!Number.isFinite(e.demand?.occupancyPercentage))continue;
      const eventId=`dep_${runId}_${e.aircraftId}_${e.routeId}`;
      if(events.some(x=>x.eventId===eventId))continue;
      const event:DepartureHistoryEvent={eventId,type:'departure',aircraftId:e.aircraftId,registration:e.registration,routeId:e.routeId,from:e.from,to:e.to,observedAt:now.toISOString(),result:'departed',
        demand:{availableBefore:{...e.demand.availableBefore},possiblePassengers:{...e.demand.possiblePassengers},occupancyPercentage:e.demand.occupancyPercentage},actualOnboard:{...e.actualOnboard}};
      if(!validDepartureEvent(event,now))throw new Error('JOURNAL_DEPARTURE_EVENT_INVALID');events.push(event);added++;
    }
    if(!added)return 0;if(events.length>100000)throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');data.events=events;
    const temporary=join(root,`return-journal.${randomUUID()}.tmp`);
    try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(data,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temporary,filename);}
    catch{throw new Error('JOURNAL_SAVE_FAILED: historico de decolagem nao persistido.');}finally{await unlink(temporary).catch(()=>undefined);}
    return added;
  },join(root,'.return-journal.lock'));
}
/** Simulation only. Local lock + atomic replace; never execute a game action inside this transaction. */
export async function reviewWithReturnJournal(input: RouteReview, options: JournalOptions, now = new Date()): Promise<RoutePlan> {
  if (!validId(options.scope) || !validOrigin(options.origin) || !validId(input.position.aircraftId) || !Number.isFinite(now.getTime())) throw new Error('JOURNAL_CONFIG_INVALID');
  if (input.position.homeBase !== options.origin || input.previousPosition && input.previousPosition.homeBase !== options.origin) throw new Error('JOURNAL_ORIGIN_MISMATCH');
  const optimizer = new RouteOptimizer(options.minOccupancy, options.minImprovementPercent, options.maxAgeSeconds);
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  return withRunLock(async () => {
    const filename = join(directory, 'return-journal.json');
    let data: Journal;
    try { data = validateReturnJournal(JSON.parse(await readFile(filename, 'utf8')), options.scope, now); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') data = { schemaVersion: 1, scope: options.scope, entries: [] };
      else throw new Error('JOURNAL_UNAVAILABLE: registro invalido/inacessivel; revisao bloqueada.');
    }
    const eventId = reviewEventId(input, now);
    const arrivalKey = eventId ? `${input.position.aircraftId}:${eventId}:${options.origin}` : null;
    if (!arrivalKey) return optimizer.review(input, now);
    if (!validId(eventId)) throw new Error('JOURNAL_FLIGHT_ID_INVALID');
    const entry: Entry = { aircraftId: input.position.aircraftId, origin: options.origin, flightId: eventId!, reviewedAt: now.toISOString(), decision: 'hold' };
    if (data.entries.some(e => key(e) === key(entry))) return { aircraftId: entry.aircraftId, arrivalKey, decision: 'already_reviewed', selectedRouteId: null, scores: [], reason: 'Retorno ja revisado em execucao anterior do mesmo registro.', dryRun: true, mutationAuthorized: false };
    const plan = optimizer.review(input, now);
    if (!completed(plan.decision)) return plan; // Missing data is retryable; never consume the arrival.
    if (data.entries.length >= 100000) throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');
    data.entries.push({ ...entry, decision: plan.decision, reviewEvidence:{
      trigger:input.trigger==='daily'?'daily':'return',reviewedRouteId:input.currentRouteId,selectedRouteId:plan.selectedRouteId,result:plan.decision,
      routePerformance:plan.scores.map(s=>({routeId:s.routeId,viable:s.viable,netProfit:s.netProfit,netProfitPerHour:s.netProfitPerHour,occupancyPercentages:[...s.occupancyPercentages]}))
    } });
    const temporary = join(directory, `return-journal.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(data, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, filename);
    } catch { throw new Error('JOURNAL_SAVE_FAILED: resultado da revisao nao liberado.'); }
    finally { await unlink(temporary).catch(() => undefined); }
    return plan;
  }, join(directory, '.return-journal.lock'));
}
