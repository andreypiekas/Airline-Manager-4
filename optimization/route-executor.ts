import type { AircraftSnapshot, Cabins } from '../demand/types';
import type { VariableRouteDecision } from './route-decision';
import type { RouteMutationControlEvidence } from './route-mutation-control';
import { MUTATION_COMPLETION_RESERVE_MS } from '../utils/run-time-budget';

export interface RouteExecutionCandidate {
  aircraftId:string;
  from:string;
  to:string;
  airportId:string;
  comparisonReady:boolean;
  observedAt:string;
  capacity:Cabins;
  autoFares:Cabins;
  costIndex:number;
  distanceKm:number;
  durationSeconds:number;
  fuelLbs:number;
  co2KgPerPaxKm:number;
  routeFee:number;
  routeMutationControl:RouteMutationControlEvidence|null;
}

export interface RouteExecutionPort {
  prepare(expected:AircraftSnapshot,target:RouteExecutionCandidate):Promise<{
    aircraft:AircraftSnapshot;
    target:RouteExecutionCandidate;
  }>;
  reroute(expected:AircraftSnapshot,target:RouteExecutionCandidate):Promise<void>;
  confirm(expected:AircraftSnapshot,target:RouteExecutionCandidate):Promise<AircraftSnapshot|null>;
}

export interface RouteExecutionSettings {
  enabled:boolean;
  maxReroutes:number;
  maxAgeSeconds:number;
  mutationDeadlineEpochMs?:number;
  blockedAircraftIds?:ReadonlySet<string>;
  reviewedTodayAircraftIds?:ReadonlySet<string>;
}

export interface RouteExecutionEntry {
  aircraftId:string;
  registration:string;
  previousRouteId:string;
  previousFrom:string;
  previousTo:string;
  targetFrom:string;
  targetTo:string;
  targetAirportId:string;
  confirmedRouteId:string|null;
  status:'held'|'attempting'|'rerouted'|'outcome_unknown';
  /** Ephemeral authorization: true only after the fresh pre-mutation context is revalidated. */
  mutationAuthorized:boolean;
  reason:string;
  /** Sanitized read-only diagnostic; never feeds authorization decisions. */
  prepareDiagnostic?:string;
}

export interface RouteExecutionReport {
  schemaVersion:1;
  generatedAt:string;
  completedAt:string|null;
  halted:boolean;
  summary:{evaluated:number;rerouted:number;held:number;unknown:number};
  entries:RouteExecutionEntry[];
}

const safeId=(s:string)=>/^[1-9]\d*$/.test(s);
const sameCurrentContext=(a:AircraftSnapshot,b:AircraftSnapshot)=>
  a.aircraftId===b.aircraftId&&a.registration===b.registration&&a.routeId===b.routeId&&
  a.from===b.from&&a.to===b.to&&a.state==='ready'&&b.state==='ready'&&!a.issue&&!b.issue;

const sameCabins=(a:Cabins,b:Cabins)=>['Y','J','F'].every(k=>a[k as keyof Cabins]===b[k as keyof Cabins]);
const validCabins=(a:Cabins)=>['Y','J','F'].every(k=>Number.isSafeInteger(a[k as keyof Cabins])&&a[k as keyof Cabins]>=0)&&
  a.Y+a.J+a.F>0;
const finite=(n:number)=>Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER;
const sameTargetEvidence=(a:RouteExecutionCandidate,b:RouteExecutionCandidate)=>
  a.aircraftId===b.aircraftId&&a.from===b.from&&a.to===b.to&&a.airportId===b.airportId&&
  a.costIndex===b.costIndex&&a.distanceKm===b.distanceKm&&a.durationSeconds===b.durationSeconds&&
  a.fuelLbs===b.fuelLbs&&a.co2KgPerPaxKm===b.co2KgPerPaxKm&&a.routeFee===b.routeFee&&
  sameCabins(a.capacity,b.capacity)&&sameCabins(a.autoFares,b.autoFares);

const sanitizedPrepareDiagnostic=(error:unknown)=>{
  const message=error instanceof Error?error.message:'';
  if(/^[A-Z][A-Z0-9_]{2,100}$/.test(message))return message;
  if(/timeout|timed\s*out/i.test(message))return 'PLAYWRIGHT_TIMEOUT';
  return 'UNCLASSIFIED_PREPARE_FAILURE';
};

const mutationControlReady=(candidate:RouteExecutionCandidate)=>{
  const c=candidate.routeMutationControl;
  return !!c&&c.nativeClickReady&&c.endpointVerified&&c.targetVerified&&c.directRouteVerified&&
    c.aircraftIdMatchesContext&&c.airportIdMatchesContext&&c.registrationInputVerified&&
    c.seatInputsVerified&&c.endCostIndexVerified&&c.nonCharterBranchVerified;
};

export class RouteMutationExecutor {
  private used=false;
  private attemptedAircraft=new Set<string>();

  constructor(
    private readonly port:RouteExecutionPort,
    private readonly settings:RouteExecutionSettings,
    private readonly saveReport:(report:RouteExecutionReport)=>Promise<void>
  ){
    if(typeof settings.enabled!=='boolean'||!Number.isSafeInteger(settings.maxReroutes)||
      settings.maxReroutes<1||settings.maxReroutes>5||!Number.isSafeInteger(settings.maxAgeSeconds)||
      settings.maxAgeSeconds<1||settings.maxAgeSeconds>900||
      (settings.mutationDeadlineEpochMs!==undefined&&(!Number.isSafeInteger(settings.mutationDeadlineEpochMs)||settings.mutationDeadlineEpochMs<=0))||
      (settings.blockedAircraftIds!==undefined&&[...settings.blockedAircraftIds].some(id=>!safeId(id)))||
      (settings.reviewedTodayAircraftIds!==undefined&&[...settings.reviewedTodayAircraftIds].some(id=>!safeId(id))))
      throw new Error('ROUTE_EXECUTION_SETTINGS_INVALID');
  }

  async run(
    fleet:AircraftSnapshot[],
    decisions:VariableRouteDecision[],
    candidates:RouteExecutionCandidate[]
  ):Promise<RouteExecutionReport>{
    if(this.used)throw new Error('ROUTE_EXECUTION_ALREADY_USED');
    this.used=true;
    const report:RouteExecutionReport={
      schemaVersion:1,generatedAt:new Date().toISOString(),completedAt:null,halted:false,
      summary:{evaluated:0,rerouted:0,held:0,unknown:0},entries:[]
    };
    const persist=async()=>{
      report.summary={
        evaluated:report.entries.length,
        rerouted:report.entries.filter(e=>e.status==='rerouted').length,
        held:report.entries.filter(e=>e.status==='held').length,
        unknown:report.entries.filter(e=>e.status==='outcome_unknown').length
      };
      await this.saveReport(report);
    };
    await persist();
    if(!this.settings.enabled){
      report.completedAt=new Date().toISOString();
      await persist();
      return report;
    }

    for(const decision of decisions){
      const selected=decision.selected;
      if(decision.decision!=='would_reroute'||!selected)continue;
      const expected=fleet.find(a=>a.aircraftId===decision.aircraftId);
      const matches=candidates.filter(c=>c.aircraftId===decision.aircraftId&&c.from===selected.from&&
        c.to===selected.to&&c.airportId===selected.airportId);
      const entry:RouteExecutionEntry={
        aircraftId:decision.aircraftId,registration:expected?.registration||'unknown',
        previousRouteId:expected?.routeId||'unknown',previousFrom:expected?.from||'unknown',previousTo:expected?.to||'unknown',
        targetFrom:selected.from,targetTo:selected.to,targetAirportId:selected.airportId,confirmedRouteId:null,
        status:'held',mutationAuthorized:false,reason:'ROUTE_EXECUTION_EVIDENCE_INCOMPLETE'
      };
      report.entries.push(entry);

      if(report.halted){entry.reason='PREVIOUS_ROUTE_OUTCOME_UNKNOWN';continue;}
      if(this.settings.blockedAircraftIds?.has(decision.aircraftId)){entry.reason='PERSISTED_UNCERTAIN_ROUTE_BLOCK';continue;}
      if(this.settings.reviewedTodayAircraftIds?.has(decision.aircraftId)){entry.reason='DAILY_ROUTE_REVIEW_ALREADY_COMPLETED';continue;}
      if(this.attemptedAircraft.has(decision.aircraftId)){entry.reason='AIRCRAFT_ALREADY_ATTEMPTED';continue;}
      if(this.attemptedAircraft.size>=this.settings.maxReroutes){entry.reason='ROUTE_EXECUTION_LIMIT';continue;}
      if(!expected||matches.length!==1){entry.reason='FLEET_OR_CANDIDATE_CONTEXT_UNAVAILABLE';continue;}
      const target=matches[0];
      const age=Date.now()-Date.parse(target.observedAt);
      if(expected.state!=='ready'||expected.issue||!safeId(expected.aircraftId)||!safeId(expected.routeId)||
        expected.aircraftId!==target.aircraftId||expected.from!==target.from||
        !safeId(target.airportId)||target.from===target.to||!target.comparisonReady||
        !Number.isFinite(age)||age<0||age>this.settings.maxAgeSeconds*1000||
        !Number.isSafeInteger(target.costIndex)||target.costIndex<0||target.costIndex>200||
        !Number.isSafeInteger(target.distanceKm)||target.distanceKm<=0||
        !Number.isSafeInteger(target.durationSeconds)||target.durationSeconds<=0||
        !Number.isSafeInteger(target.fuelLbs)||target.fuelLbs<=0||
        !finite(target.co2KgPerPaxKm)||target.co2KgPerPaxKm<=0||
        !Number.isSafeInteger(target.routeFee)||target.routeFee<0||
        !validCabins(target.capacity)||!validCabins(target.autoFares)||
        ['Y','J','F'].some(k=>target.autoFares[k as keyof Cabins]<=0)||
        !mutationControlReady(target)){
        entry.reason='ROUTE_EXECUTION_GUARD_REJECTED';continue;
      }

      if(this.settings.mutationDeadlineEpochMs!==undefined&&
        Date.now()>this.settings.mutationDeadlineEpochMs-MUTATION_COMPLETION_RESERVE_MS){
        entry.reason='RUN_TIME_BUDGET_EXHAUSTED_BEFORE_ROUTE_PREPARE';continue;
      }

      let fresh:{aircraft:AircraftSnapshot;target:RouteExecutionCandidate};
      try{fresh=await this.port.prepare(expected,target);}
      catch(error){
        entry.reason='ROUTE_EXECUTION_PREPARE_FAILED';
        entry.prepareDiagnostic=sanitizedPrepareDiagnostic(error);
        continue;
      }
      const freshAge=Date.now()-Date.parse(fresh.target.observedAt);
      if(!sameCurrentContext(expected,fresh.aircraft)||!sameTargetEvidence(target,fresh.target)||
        !fresh.target.comparisonReady||!Number.isFinite(freshAge)||freshAge<0||
        freshAge>this.settings.maxAgeSeconds*1000||!mutationControlReady(fresh.target)){
        entry.reason='ROUTE_EXECUTION_CONTEXT_CHANGED';continue;
      }

      if(this.settings.mutationDeadlineEpochMs!==undefined&&
        Date.now()>this.settings.mutationDeadlineEpochMs-MUTATION_COMPLETION_RESERVE_MS){
        entry.reason='RUN_TIME_BUDGET_EXHAUSTED_BEFORE_ROUTE_MUTATION';continue;
      }
      this.attemptedAircraft.add(expected.aircraftId);
      // Authorization is deliberately local to this already-fresh fingerprint.
      // It is persisted before the single mutation attempt for auditability and
      // never feeds back into candidate/readiness evidence.
      entry.status='attempting';
      entry.mutationAuthorized=true;
      entry.reason='FRESH_CONTEXT_VERIFIED_NATIVE_REROUTE_AUTHORIZED';
      await persist();

      try{
        await this.port.reroute(fresh.aircraft,fresh.target);
        const after=await this.port.confirm(fresh.aircraft,fresh.target);
        if(!after||after.aircraftId!==expected.aircraftId||after.registration!==expected.registration||
          after.from!==target.from||after.to!==target.to||after.routeId===expected.routeId)
          throw new Error('ROUTE_EXECUTION_UNCONFIRMED');
        entry.status='rerouted';entry.confirmedRouteId=after.routeId;entry.mutationAuthorized=false;entry.reason='NATIVE_REROUTE_AND_FRESH_ROUTE_CONFIRMED';
      }catch{
        entry.status='outcome_unknown';entry.mutationAuthorized=false;entry.reason='NO_RETRY_AFTER_ROUTE_MUTATION_ATTEMPT';report.halted=true;
      }
      await persist();
    }
    report.completedAt=new Date().toISOString();
    await persist();
    return report;
  }
}
