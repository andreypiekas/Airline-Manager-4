import { AircraftSnapshot, CollectionResult, DemandConfig, DemandDecision } from './types';
import { DemandManager } from './manager';
import type { AdaptiveThreshold } from './adaptive-threshold';
import { MUTATION_COMPLETION_RESERVE_MS } from '../utils/run-time-budget';
import { resolveAircraftOrigin } from '../optimization/aircraft-origins';

export interface DeparturePort {
  collect(): Promise<CollectionResult>;
  /** Fresh identity/layout/demand AND a strictly verified native departure control. */
  prepare(expected: AircraftSnapshot): Promise<AircraftSnapshot>;
  depart(expected: AircraftSnapshot): Promise<void>;
  confirm(expected: AircraftSnapshot): Promise<AircraftSnapshot | null>;
}
export interface ExecutionSettings {
  dryRun: boolean;
  maxDepartures: number;
  aircraftOrigins: ReadonlyMap<string,string>;
  airlineBases: readonly string[];
  /** Absolute deadline after which no new departure mutation may start. */
  mutationDeadlineEpochMs?: number;
  blockedDepartureKeys?: ReadonlySet<string>;
  /** Verified fuel holding observed in this same run. Used only to block unsafe clicks. */
  fuelHoldingLbsAtRunStart?: number;
}
export interface ExecutionEntry {
  aircraftId: string; registration: string; routeId: string; from: string; to: string;
  status: 'held' | 'would_depart' | 'attempting' | 'departed' | 'outcome_unknown';
  reason: string; demand: DemandDecision | null; actualOnboard: AircraftSnapshot['onboard'];
  resourceEvidence?: {
    fuelHoldingLbsAtRunStart:number;
    fuelCommittedBefore:number;
    fuelAvailableBefore:number;
    verifiedRouteFuelLbs:number|null;
    matchingHistorySamples:number;
    trackingComplete:boolean;
  };
}
export interface ExecutionReport {
  schemaVersion: 1; dryRun: boolean; scope: 'existing-route-return-legs';
  generatedAt: string; completedAt: string | null; halted: boolean;
  summary: { evaluated: number; departed: number; simulated: number; held: number; unknown: number };
  entries: ExecutionEntry[];
}
const sameContext = (a: AircraftSnapshot,b: AircraftSnapshot) => a.aircraftId === b.aircraftId && a.routeId === b.routeId &&
  a.registration === b.registration && a.from === b.from && a.to === b.to && !!a.capacity && !!b.capacity &&
  (['Y','J','F'] as const).every(k=>a.capacity![k]===b.capacity![k]);

const routePairKey=(a:string,b:string)=>[a,b].sort().join(':');
function verifiedHistoricalFuelRequirement(a:AircraftSnapshot):{fuelLbs:number;samples:number}|null{
  const history=a.flightHistory;
  if(!history||history.status!=='observed'||!Array.isArray(history.entries))return null;
  const pair=routePairKey(a.from,a.to);
  const matching=history.entries.filter(e=>routePairKey(e.from,e.to)===pair&&Number.isSafeInteger(e.fuelLbs)&&e.fuelLbs>0);
  if(matching.length<3)return null;
  const values=[...new Set(matching.map(e=>e.fuelLbs))];
  return values.length===1?{fuelLbs:values[0],samples:matching.length}:null;
}

/** No retries, bulk fallback, route mutations or financial modules. A report writer must persist BEFORE the click. */
export class IndividualDepartureExecutor {
  private used = false;
  private readonly attemptedAircraft = new Set<string>();
  private readonly attemptedRoutes = new Set<string>();
  constructor(private readonly port: DeparturePort,private readonly demand: DemandConfig,
    private readonly settings: ExecutionSettings,private readonly save: (report: ExecutionReport)=>Promise<void>,
    private readonly adaptive:ReadonlyMap<string,AdaptiveThreshold>=new Map()) {
    if (!demand.enabled || !demand.failSafe || !Number.isSafeInteger(settings.maxDepartures) || settings.maxDepartures<1 || settings.maxDepartures>100 ||
      !settings.airlineBases.length || settings.airlineBases.some(b=>!/^[A-Z]{3}$/.test(b))) throw new Error('EXECUTION_SETTINGS_INVALID');
  }
  async run(): Promise<ExecutionReport> {
    if(this.used)throw new Error('EXECUTION_ALREADY_USED');
    this.used=true;
    const report: ExecutionReport={schemaVersion:1,dryRun:this.settings.dryRun,scope:'existing-route-return-legs',
      generatedAt:new Date().toISOString(),completedAt:null,halted:false,summary:{evaluated:0,departed:0,simulated:0,held:0,unknown:0},entries:[]};
    const persist=async()=>{
      report.summary={evaluated:report.entries.length,departed:report.entries.filter(e=>e.status==='departed').length,
        simulated:report.entries.filter(e=>e.status==='would_depart').length,held:report.entries.filter(e=>e.status==='held').length,
        unknown:report.entries.filter(e=>e.status==='outcome_unknown').length};
      await this.save(report);
    };
    await persist();
    let fuelCommitted=0;
    let fuelTrackingComplete=this.settings.fuelHoldingLbsAtRunStart===undefined?false:
      Number.isSafeInteger(this.settings.fuelHoldingLbsAtRunStart)&&this.settings.fuelHoldingLbsAtRunStart>=0;
    if(this.settings.fuelHoldingLbsAtRunStart!==undefined&&!fuelTrackingComplete)throw new Error('EXECUTION_FUEL_BUDGET_INVALID');
    let initial: CollectionResult;
    try { initial=await this.port.collect(); } catch { report.halted=true;await persist();throw new Error('EXECUTION_INITIAL_COLLECTION_FAILED'); }
    // Original targets only: an aircraft landing during this run is considered on the NEXT execution.
    for(const expected of initial.aircraft.filter(a=>a.state!=='inflight')) {
      const entry: ExecutionEntry={aircraftId:expected.aircraftId,registration:expected.registration,routeId:expected.routeId,
        from:expected.from,to:expected.to,status:'held',reason:'DATA_UNAVAILABLE',demand:null,actualOnboard:null};
      report.entries.push(entry);
      if(report.halted){entry.reason='PREVIOUS_OUTCOME_UNKNOWN';continue;}
      if(this.attemptedAircraft.has(expected.aircraftId)||this.attemptedRoutes.has(expected.routeId)){entry.reason='ALREADY_ATTEMPTED';continue;}
      if(this.settings.blockedDepartureKeys?.has(expected.aircraftId+':'+expected.routeId)){entry.reason='PERSISTED_UNCERTAIN_DEPARTURE_BLOCK';continue;}
      if(this.attemptedAircraft.size>=this.settings.maxDepartures){entry.reason='EXECUTION_LIMIT';continue;}
      if(!initial.complete){entry.reason='INITIAL_COLLECTION_INCOMPLETE';continue;}
      if(!this.settings.dryRun&&this.settings.mutationDeadlineEpochMs!==undefined&&
        Date.now()>this.settings.mutationDeadlineEpochMs-MUTATION_COMPLETION_RESERVE_MS){
        entry.reason='RUN_TIME_BUDGET_EXHAUSTED_BEFORE_EVALUATION';continue;
      }
      let collection: CollectionResult;
      try { collection=await this.port.collect(); } catch {entry.reason='FRESH_COLLECTION_FAILED';continue;}
      const matches=collection.aircraft.filter(a=>a.aircraftId===expected.aircraftId);
      if(!collection.complete||matches.length!==1||!sameContext(expected,matches[0])){entry.reason='FLEET_CONTEXT_CHANGED_OR_INCOMPLETE';continue;}
      const current=matches[0];
      const origin=resolveAircraftOrigin(current,collection,this.settings.aircraftOrigins,this.settings.airlineBases);
      if(!origin.origin){entry.reason='ORIGIN_UNAVAILABLE';continue;}
      // A rota existente pode sair da propria base ou retornar para ela.
      // Mantemos a aeronave em solo apenas se o trecho atual nao incluir a base operacional confirmada.
      const departingOwnBase=current.from===origin.origin;
      const returningOwnBase=current.to===origin.origin;
      if(!departingOwnBase&&!returningOwnBase){entry.reason='ROUTE_DOES_NOT_INCLUDE_OWN_BASE';continue;}
      let fresh: AircraftSnapshot;
      try {fresh=await this.port.prepare(current);}catch{entry.reason='DEPARTURE_CONTROL_OR_FRESH_DETAILS_UNVERIFIED';continue;}
      if(fresh.state!=='ready'||!sameContext(current,fresh)){entry.reason='AIRCRAFT_CONTEXT_CHANGED';continue;}
      const updated={...collection,aircraft:collection.aircraft.map(a=>a.aircraftId===fresh.aircraftId?fresh:a)};
      const decision=new DemandManager({...this.demand,dryRun:true},this.adaptive).analyze(updated).decisions.find(d=>d.aircraftId===fresh.aircraftId)!;
      entry.demand=decision;
      if(decision.decision!=='would_depart'){entry.reason=decision.reason;continue;}
      entry.reason=decision.reason;
      const fuelEvidence=verifiedHistoricalFuelRequirement(fresh);
      if(!this.settings.dryRun&&this.settings.fuelHoldingLbsAtRunStart!==undefined){
        const available=Math.max(0,this.settings.fuelHoldingLbsAtRunStart-fuelCommitted);
        entry.resourceEvidence={
          fuelHoldingLbsAtRunStart:this.settings.fuelHoldingLbsAtRunStart,
          fuelCommittedBefore:fuelCommitted,
          fuelAvailableBefore:available,
          verifiedRouteFuelLbs:fuelEvidence?.fuelLbs??null,
          matchingHistorySamples:fuelEvidence?.samples??0,
          trackingComplete:fuelTrackingComplete
        };
        if(!fuelTrackingComplete){entry.reason='FUEL_BUDGET_UNVERIFIED_AFTER_PRIOR_DEPARTURE';continue;}
        if(fuelEvidence&&available<fuelEvidence.fuelLbs){entry.reason='FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY';continue;}
      }
      if(this.settings.dryRun){
        this.attemptedAircraft.add(fresh.aircraftId);this.attemptedRoutes.add(fresh.routeId);
        entry.status='would_depart';await persist();continue;
      }
      if(this.settings.mutationDeadlineEpochMs!==undefined&&
        Date.now()>this.settings.mutationDeadlineEpochMs-MUTATION_COMPLETION_RESERVE_MS){
        entry.reason='RUN_TIME_BUDGET_EXHAUSTED_BEFORE_MUTATION';continue;
      }
      this.attemptedAircraft.add(fresh.aircraftId);this.attemptedRoutes.add(fresh.routeId);
      entry.status='attempting';
      // A persistence failure throws BEFORE any click. A crash after this point must never be retried.
      await persist();
      const code=(error:unknown)=>{
        const message=error instanceof Error?error.message:'UNCLASSIFIED';
        return /^[A-Z0-9_:-]{1,120}$/.test(message)?message:'UNCLASSIFIED';
      };
      try {
        await this.port.depart(fresh);
      } catch(error) {
        entry.status='outcome_unknown';entry.reason='NO_RETRY_AFTER_CLICK_ATTEMPT:'+code(error);report.halted=true;
        await persist();continue;
      }
      try {
        const after=await this.port.confirm(fresh);
        if(!after)throw new Error('CONFIRMATION_MISSING');
        if(after.state!=='inflight')throw new Error('CONFIRM_STATE_NOT_INFLIGHT');
        if(after.issue)throw new Error('CONFIRM_AIRCRAFT_ISSUE');
        if(!sameContext(fresh,after))throw new Error('CONFIRM_CONTEXT_CHANGED');
        const timing=after.timing;
        if(!timing)throw new Error('CONFIRM_TIMING_MISSING');
        if(!after.onboard)throw new Error('CONFIRM_ONBOARD_MISSING');
        if(timing.source!=='inspected-flight-countdown')throw new Error('CONFIRM_TIMING_SOURCE_INVALID');
        if(timing.aircraftId!==fresh.aircraftId||timing.routeId!==fresh.routeId)throw new Error('CONFIRM_TIMING_ID_MISMATCH');
        if(!Number.isSafeInteger(timing.remainingSeconds)||timing.remainingSeconds<=0)throw new Error('CONFIRM_COUNTDOWN_INVALID');
        const age=Date.now()-Date.parse(timing.observedAt);
        if(!Number.isFinite(age)||age<0||age>this.demand.maxAgeSeconds*1000)throw new Error('CONFIRM_OBSERVATION_STALE');
        if((['Y','J','F'] as const).some(k=>!Number.isSafeInteger(after.onboard![k])||after.onboard![k]<0||after.onboard![k]>after.capacity![k]))
          throw new Error('CONFIRM_ONBOARD_INVALID');
        entry.status='departed';entry.actualOnboard=after.onboard;entry.reason='NATIVE_INFLIGHT_IDENTITY_COUNTDOWN_AND_ONBOARD_CONFIRMED';
        if(this.settings.fuelHoldingLbsAtRunStart!==undefined){
          if(fuelEvidence)fuelCommitted+=fuelEvidence.fuelLbs;
          else fuelTrackingComplete=false;
        }
      } catch(error) {
        entry.status='outcome_unknown';entry.reason='NO_RETRY_AFTER_CLICK_ATTEMPT:'+code(error);report.halted=true;
      }
      await persist();
    }
    report.completedAt=new Date().toISOString();await persist();return report;
  }
}
