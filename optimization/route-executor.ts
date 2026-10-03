import type { AircraftSnapshot, Cabins } from '../demand/types';
import type { VariableRouteDecision } from './route-decision';
import type { RouteMutationControlEvidence } from './route-mutation-control';

export interface RouteExecutionCandidate {
  aircraftId:string;
  from:string;
  to:string;
  airportId:string;
  comparisonReady:boolean;
  capacity:Cabins;
  costIndex:number;
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
  status:'held'|'attempting'|'rerouted'|'outcome_unknown';
  reason:string;
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
      settings.maxReroutes<1||settings.maxReroutes>5)throw new Error('ROUTE_EXECUTION_SETTINGS_INVALID');
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
        targetFrom:selected.from,targetTo:selected.to,targetAirportId:selected.airportId,
        status:'held',reason:'ROUTE_EXECUTION_EVIDENCE_INCOMPLETE'
      };
      report.entries.push(entry);

      if(report.halted){entry.reason='PREVIOUS_ROUTE_OUTCOME_UNKNOWN';continue;}
      if(this.attemptedAircraft.has(decision.aircraftId)){entry.reason='AIRCRAFT_ALREADY_ATTEMPTED';continue;}
      if(this.attemptedAircraft.size>=this.settings.maxReroutes){entry.reason='ROUTE_EXECUTION_LIMIT';continue;}
      if(!expected||matches.length!==1){entry.reason='FLEET_OR_CANDIDATE_CONTEXT_UNAVAILABLE';continue;}
      const target=matches[0];
      if(expected.state!=='ready'||expected.issue||!safeId(expected.aircraftId)||!safeId(expected.routeId)||
        expected.aircraftId!==target.aircraftId||expected.from!==target.from||
        !safeId(target.airportId)||target.from===target.to||!target.comparisonReady||
        !Number.isSafeInteger(target.costIndex)||target.costIndex<0||target.costIndex>200||
        !mutationControlReady(target)){
        entry.reason='ROUTE_EXECUTION_GUARD_REJECTED';continue;
      }

      let fresh:{aircraft:AircraftSnapshot;target:RouteExecutionCandidate};
      try{fresh=await this.port.prepare(expected,target);}
      catch{entry.reason='ROUTE_EXECUTION_PREPARE_FAILED';continue;}
      if(!sameCurrentContext(expected,fresh.aircraft)||
        fresh.target.aircraftId!==target.aircraftId||fresh.target.from!==target.from||
        fresh.target.to!==target.to||fresh.target.airportId!==target.airportId||
        fresh.target.costIndex!==target.costIndex||!fresh.target.comparisonReady||
        !mutationControlReady(fresh.target)){
        entry.reason='ROUTE_EXECUTION_CONTEXT_CHANGED';continue;
      }

      this.attemptedAircraft.add(expected.aircraftId);
      entry.status='attempting';
      entry.reason='NATIVE_REROUTE_PREPARED';
      await persist();

      try{
        await this.port.reroute(fresh.aircraft,fresh.target);
        const after=await this.port.confirm(fresh.aircraft,fresh.target);
        if(!after||after.aircraftId!==expected.aircraftId||after.registration!==expected.registration||
          after.from!==target.from||after.to!==target.to||after.routeId===expected.routeId)
          throw new Error('ROUTE_EXECUTION_UNCONFIRMED');
        entry.status='rerouted';entry.reason='NATIVE_REROUTE_AND_FRESH_ROUTE_CONFIRMED';
      }catch{
        entry.status='outcome_unknown';entry.reason='NO_RETRY_AFTER_ROUTE_MUTATION_ATTEMPT';report.halted=true;
      }
      await persist();
    }
    report.completedAt=new Date().toISOString();
    await persist();
    return report;
  }
}
