import { AircraftSnapshot, CollectionResult, DemandConfig, DemandDecision } from './types';
import { DemandManager } from './manager';
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
}
export interface ExecutionEntry {
  aircraftId: string; registration: string; routeId: string; from: string; to: string;
  status: 'held' | 'would_depart' | 'attempting' | 'departed' | 'outcome_unknown';
  reason: string; demand: DemandDecision | null; actualOnboard: AircraftSnapshot['onboard'];
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

/** No retries, bulk fallback, route mutations or financial modules. A report writer must persist BEFORE the click. */
export class IndividualDepartureExecutor {
  private used = false;
  private readonly attemptedAircraft = new Set<string>();
  private readonly attemptedRoutes = new Set<string>();
  constructor(private readonly port: DeparturePort,private readonly demand: DemandConfig,
    private readonly settings: ExecutionSettings,private readonly save: (report: ExecutionReport)=>Promise<void>) {
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
    let initial: CollectionResult;
    try { initial=await this.port.collect(); } catch { report.halted=true;await persist();throw new Error('EXECUTION_INITIAL_COLLECTION_FAILED'); }
    // Original targets only: an aircraft landing during this run is considered on the NEXT execution.
    for(const expected of initial.aircraft.filter(a=>a.state!=='inflight')) {
      const entry: ExecutionEntry={aircraftId:expected.aircraftId,registration:expected.registration,routeId:expected.routeId,
        from:expected.from,to:expected.to,status:'held',reason:'DATA_UNAVAILABLE',demand:null,actualOnboard:null};
      report.entries.push(entry);
      if(report.halted){entry.reason='PREVIOUS_OUTCOME_UNKNOWN';continue;}
      if(this.attemptedAircraft.has(expected.aircraftId)||this.attemptedRoutes.has(expected.routeId)){entry.reason='ALREADY_ATTEMPTED';continue;}
      if(this.attemptedAircraft.size>=this.settings.maxDepartures){entry.reason='EXECUTION_LIMIT';continue;}
      if(!initial.complete){entry.reason='INITIAL_COLLECTION_INCOMPLETE';continue;}
      let collection: CollectionResult;
      try { collection=await this.port.collect(); } catch {entry.reason='FRESH_COLLECTION_FAILED';continue;}
      const matches=collection.aircraft.filter(a=>a.aircraftId===expected.aircraftId);
      if(!collection.complete||matches.length!==1||!sameContext(expected,matches[0])){entry.reason='FLEET_CONTEXT_CHANGED_OR_INCOMPLETE';continue;}
      const current=matches[0];
      const origin=resolveAircraftOrigin(current,collection,this.settings.aircraftOrigins,this.settings.airlineBases);
      if(!origin.origin){entry.reason='ORIGIN_UNAVAILABLE';continue;}
      // Route comparison, remaining demand of new candidates and complete costs are not native verified providers yet.
      // Never bypass the mandatory review at the aircraft's OWN base, even if route optimization is disabled.
      if(current.from===origin.origin){entry.reason='BASE_ROUTE_REVIEW_INCOMPLETE';continue;}
      if(current.to!==origin.origin){entry.reason='NOT_RETURNING_TO_OWN_BASE';continue;}
      let fresh: AircraftSnapshot;
      try {fresh=await this.port.prepare(current);}catch{entry.reason='DEPARTURE_CONTROL_OR_FRESH_DETAILS_UNVERIFIED';continue;}
      if(fresh.state!=='ready'||!sameContext(current,fresh)){entry.reason='AIRCRAFT_CONTEXT_CHANGED';continue;}
      const updated={...collection,aircraft:collection.aircraft.map(a=>a.aircraftId===fresh.aircraftId?fresh:a)};
      const decision=new DemandManager({...this.demand,dryRun:true}).analyze(updated).decisions.find(d=>d.aircraftId===fresh.aircraftId)!;
      entry.demand=decision;
      if(decision.decision!=='would_depart'){entry.reason=decision.reason;continue;}
      entry.reason=decision.reason;
      if(this.settings.dryRun){
        this.attemptedAircraft.add(fresh.aircraftId);this.attemptedRoutes.add(fresh.routeId);
        entry.status='would_depart';await persist();continue;
      }
      this.attemptedAircraft.add(fresh.aircraftId);this.attemptedRoutes.add(fresh.routeId);
      entry.status='attempting';
      // A persistence failure throws BEFORE any click. A crash after this point must never be retried.
      await persist();
      try {
        await this.port.depart(fresh);
        const after=await this.port.confirm(fresh);
        const timing=after?.timing,age=timing?Date.now()-Date.parse(timing.observedAt):NaN;
        if(!after||after.state!=='inflight'||after.issue||!sameContext(fresh,after)||!timing||!after.onboard||
          timing.source!=='inspected-flight-countdown'||timing.aircraftId!==fresh.aircraftId||timing.routeId!==fresh.routeId||
          !Number.isSafeInteger(timing.remainingSeconds)||timing.remainingSeconds<=0||!Number.isFinite(age)||age<0||age>this.demand.maxAgeSeconds*1000||
          (['Y','J','F'] as const).some(k=>!Number.isSafeInteger(after.onboard![k])||after.onboard![k]<0||after.onboard![k]>after.capacity![k]))
          throw new Error('UNCONFIRMED');
        entry.status='departed';entry.actualOnboard=after.onboard;entry.reason='NATIVE_INFLIGHT_IDENTITY_COUNTDOWN_AND_ONBOARD_CONFIRMED';
      } catch {entry.status='outcome_unknown';entry.reason='NO_RETRY_AFTER_CLICK_ATTEMPT';report.halted=true;}
      await persist();
    }
    report.completedAt=new Date().toISOString();await persist();return report;
  }
}
