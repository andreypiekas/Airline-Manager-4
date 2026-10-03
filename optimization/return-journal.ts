import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withRunLock } from '../utils/run-lock';
import { reviewEventId, RouteOptimizer, RoutePlan, RouteReview } from './route-optimizer';

type CompletedDecision = 'would_reroute' | 'keep_route' | 'hold';
interface RoutePerformanceEvidence { routeId:string; viable:boolean; netProfit:number|null; netProfitPerHour:number|null; occupancyPercentages:number[] }
interface Entry { aircraftId: string; origin: string; flightId: string; reviewedAt: string; decision: CompletedDecision;
  reviewEvidence?: { trigger:'return'|'daily'; reviewedRouteId:string; selectedRouteId:string|null; result:CompletedDecision; routePerformance:RoutePerformanceEvidence[] } }
export interface DepartureHistoryEvent { eventId:string; type:'departure'; aircraftId:string; registration:string; routeId:string; from:string; to:string; observedAt:string; result:'departed'; demand:{ availableBefore:{Y:number;J:number;F:number}; possiblePassengers:{Y:number;J:number;F:number}; occupancyPercentage:number }; actualOnboard:{Y:number;J:number;F:number} }
export interface Journal { schemaVersion: 1; scope: string; entries: Entry[]; events?:DepartureHistoryEvent[] }
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
const validDepartureEvent=(v:unknown,now:Date):v is DepartureHistoryEvent=>{
  if(!v||typeof v!=='object')return false;const x=v as DepartureHistoryEvent;
  return Object.keys(x).sort().join(',')==='actualOnboard,aircraftId,demand,eventId,from,observedAt,registration,result,routeId,to,type'&&validId(x.eventId)&&x.type==='departure'&&validId(x.aircraftId)&&
    typeof x.registration==='string'&&x.registration.length>0&&x.registration.length<=100&&validId(x.routeId)&&validOrigin(x.from)&&validOrigin(x.to)&&x.from!==x.to&&
    typeof x.observedAt==='string'&&Number.isFinite(Date.parse(x.observedAt))&&Date.parse(x.observedAt)<=now.getTime()&&x.result==='departed'&&
    x.demand&&Object.keys(x.demand).sort().join(',')==='availableBefore,occupancyPercentage,possiblePassengers'&&validCabins(x.demand.availableBefore)&&validCabins(x.demand.possiblePassengers)&&
    Number.isFinite(x.demand.occupancyPercentage)&&x.demand.occupancyPercentage>=0&&x.demand.occupancyPercentage<=100&&validCabins(x.actualOnboard);
};
export function validateReturnJournal(value: unknown, scope: string, now: Date): Journal {
  const data = value as Journal;
  const topKeys=Object.keys(data||{}).sort().join(',');
  if (!data || typeof data !== 'object' || !['entries,schemaVersion,scope','entries,events,schemaVersion,scope'].includes(topKeys) || data.schemaVersion !== 1 || data.scope !== scope || !Array.isArray(data.entries) || data.entries.length > 100000 ||
      ('events' in data&&(!Array.isArray(data.events)||data.events.length>100000))) throw new Error('JOURNAL_INVALID');
  const seen = new Set<string>();
  for (const e of data.entries) {
    const keys=Object.keys(e||{}).sort().join(',');
    if (!e || typeof e !== 'object' || !['aircraftId,decision,flightId,origin,reviewedAt','aircraftId,decision,flightId,origin,reviewEvidence,reviewedAt'].includes(keys) || !validId(e.aircraftId) || !validId(e.flightId) || !validOrigin(e.origin) || !completed(e.decision) ||
        typeof e.reviewedAt !== 'string' || !Number.isFinite(Date.parse(e.reviewedAt)) || Date.parse(e.reviewedAt) > now.getTime() || seen.has(key(e)) ||
        ('reviewEvidence' in e && !validReviewEvidence(e.reviewEvidence,e.decision))) throw new Error('JOURNAL_INVALID');
    seen.add(key(e));
  }
  const eventIds=new Set<string>();
  for(const e of data.events||[]){if(!validDepartureEvent(e,now)||eventIds.has(e.eventId))throw new Error('JOURNAL_INVALID');eventIds.add(e.eventId);}
  return data;
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
