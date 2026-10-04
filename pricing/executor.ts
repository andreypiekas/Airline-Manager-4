import { AircraftSnapshot, Cabin, CLASSES, CollectionResult } from '../demand/types';
import { planTicketPrices } from './ticket-pricing';
import { MUTATION_COMPLETION_RESERVE_MS } from '../utils/run-time-budget';

export interface PricingPort {
  collect(): Promise<CollectionResult>;
  prepare(expected: AircraftSnapshot): Promise<AircraftSnapshot>;
  save(expected: AircraftSnapshot, desired: Record<Cabin, number>): Promise<void>;
  confirm(expected: AircraftSnapshot, desired: Record<Cabin, number>): Promise<AircraftSnapshot | null>;
}

export interface PricingExecutionSettings {
  enabled: boolean;
  maxAdjustments: number;
  maxAgeSeconds: number;
  mutationDeadlineEpochMs?: number;
  blockedRouteIds?: ReadonlySet<string>;
}

export interface PricingExecutionEntry {
  aircraftId: string;
  registration: string;
  routeId: string;
  status: 'held' | 'unchanged' | 'attempting' | 'adjusted' | 'outcome_unknown';
  reason: string;
  before: Record<Cabin, number> | null;
  desired: Record<Cabin, number> | null;
  after: Record<Cabin, number> | null;
}

export interface PricingExecutionReport {
  schemaVersion: 1;
  generatedAt: string;
  completedAt: string | null;
  halted: boolean;
  phaseHoldReason: string | null;
  summary: { evaluated: number; adjusted: number; unchanged: number; held: number; unknown: number };
  entries: PricingExecutionEntry[];
}

const sameAircraftContext = (a:AircraftSnapshot,b:AircraftSnapshot) =>
  a.aircraftId===b.aircraftId && a.routeId===b.routeId && a.registration===b.registration &&
  a.state===b.state && a.from===b.from && a.to===b.to && !!a.capacity && !!b.capacity &&
  CLASSES.every(k=>a.capacity![k]===b.capacity![k]);

const validCurrent = (a:AircraftSnapshot) =>
  !!a.fares?.current && CLASSES.every(k=>Number.isSafeInteger(a.fares!.current![k]) && a.fares!.current![k] >= 0);

const routeSaveVerified = (a:AircraftSnapshot) =>
  a.fares?.saveControl?.endpointVerified === true &&
  a.fares.saveControl.target === 'route' &&
  a.fares.saveControl.targetMatchesContext === true;

function desiredFares(a:AircraftSnapshot, maxAgeSeconds:number, now=new Date()):Record<Cabin,number>|null {
  const plan=planTicketPrices(a,true,now,maxAgeSeconds);
  if(plan.status!=='would_adjust'||!plan.proposed||!a.capacity||!a.fares?.current||!validCurrent(a))return null;
  const desired={Y:0,J:0,F:0} as Record<Cabin,number>;
  for(const k of CLASSES){
    const next=a.capacity[k]>0?plan.proposed[k]:a.fares.current[k];
    if(typeof next!=='number'||!Number.isSafeInteger(next)||next<=0)return null;
    desired[k]=next;
  }
  return desired;
}

export class TicketPricingExecutor {
  private used=false;
  private attemptedRoutes=new Set<string>();
  constructor(
    private readonly port:PricingPort,
    private readonly settings:PricingExecutionSettings,
    private readonly saveReport:(report:PricingExecutionReport)=>Promise<void>
  ){
    if(typeof settings.enabled!=='boolean'||!Number.isSafeInteger(settings.maxAdjustments)||settings.maxAdjustments<1||settings.maxAdjustments>20||
      !Number.isSafeInteger(settings.maxAgeSeconds)||settings.maxAgeSeconds<1||
      (settings.mutationDeadlineEpochMs!==undefined&&(!Number.isSafeInteger(settings.mutationDeadlineEpochMs)||settings.mutationDeadlineEpochMs<=0))||
      (settings.blockedRouteIds!==undefined&&[...settings.blockedRouteIds].some(id=>!/^[1-9]\d*$/.test(id))))
      throw new Error('PRICING_EXECUTION_SETTINGS_INVALID');
  }

  async run():Promise<PricingExecutionReport>{
    if(this.used)throw new Error('PRICING_EXECUTION_ALREADY_USED');
    this.used=true;
    const report:PricingExecutionReport={schemaVersion:1,generatedAt:new Date().toISOString(),completedAt:null,halted:false,phaseHoldReason:null,
      summary:{evaluated:0,adjusted:0,unchanged:0,held:0,unknown:0},entries:[]};
    const persist=async()=>{
      report.summary={
        evaluated:report.entries.length,
        adjusted:report.entries.filter(e=>e.status==='adjusted').length,
        unchanged:report.entries.filter(e=>e.status==='unchanged').length,
        held:report.entries.filter(e=>e.status==='held').length,
        unknown:report.entries.filter(e=>e.status==='outcome_unknown').length
      };
      await this.saveReport(report);
    };
    await persist();
    if(!this.settings.enabled){report.completedAt=new Date().toISOString();await persist();return report;}

    let initial:CollectionResult;
    try{initial=await this.port.collect();}catch{
      report.phaseHoldReason='PRICING_INITIAL_COLLECTION_FAILED';
      report.completedAt=new Date().toISOString();await persist();return report;
    }
    if(!initial.complete){
      report.phaseHoldReason='PRICING_INITIAL_COLLECTION_INCOMPLETE';
      for(const a of initial.aircraft.filter(a=>a.state==='ready'))report.entries.push({
        aircraftId:a.aircraftId,registration:a.registration,routeId:a.routeId,status:'held',
        reason:'PRICING_INITIAL_COLLECTION_INCOMPLETE',before:a.fares?.current?{...a.fares.current}:null,desired:null,after:null
      });
      report.completedAt=new Date().toISOString();await persist();return report;
    }

    const routeCounts=new Map<string,number>();
    for(const a of initial.aircraft)routeCounts.set(a.routeId,(routeCounts.get(a.routeId)||0)+1);

    for(const expected of initial.aircraft.filter(a=>a.state==='ready')){
      const entry:PricingExecutionEntry={aircraftId:expected.aircraftId,registration:expected.registration,routeId:expected.routeId,
        status:'held',reason:'DATA_UNAVAILABLE',before:expected.fares?.current?{...expected.fares.current}:null,desired:null,after:null};
      report.entries.push(entry);
      if(report.halted){entry.reason='PREVIOUS_OUTCOME_UNKNOWN';continue;}
      if(this.settings.blockedRouteIds?.has(expected.routeId)){entry.reason='PERSISTED_UNCERTAIN_PRICING_BLOCK';continue;}
      if(this.attemptedRoutes.has(expected.routeId)){entry.reason='ROUTE_ALREADY_ATTEMPTED';continue;}
      if(this.attemptedRoutes.size>=this.settings.maxAdjustments){entry.reason='PRICING_EXECUTION_LIMIT';continue;}
      if(routeCounts.get(expected.routeId)!==1){entry.reason='ROUTE_SHARED_BY_MULTIPLE_AIRCRAFT';continue;}
      if(!routeSaveVerified(expected)){entry.reason='ROUTE_SAVE_CONTROL_UNVERIFIED';continue;}

      const initialPlan=planTicketPrices(expected,true,new Date(),this.settings.maxAgeSeconds);
      if(initialPlan.status==='unchanged'){entry.status='unchanged';entry.reason='ALREADY_AT_TARGET';continue;}
      const initialDesired=desiredFares(expected,this.settings.maxAgeSeconds);
      if(!initialDesired){entry.reason='PRICE_PLAN_UNAVAILABLE';continue;}
      if(this.settings.mutationDeadlineEpochMs!==undefined&&
        Date.now()>this.settings.mutationDeadlineEpochMs-MUTATION_COMPLETION_RESERVE_MS){
        entry.reason='RUN_TIME_BUDGET_EXHAUSTED_BEFORE_PRICE_PREPARE';continue;
      }

      let fresh:AircraftSnapshot;
      try{fresh=await this.port.prepare(expected);}catch{entry.reason='PRICING_CONTROL_OR_FRESH_DETAILS_UNVERIFIED';continue;}
      if(!sameAircraftContext(expected,fresh)||!routeSaveVerified(fresh)){entry.reason='PRICING_CONTEXT_CHANGED';continue;}
      const freshDesired=desiredFares(fresh,this.settings.maxAgeSeconds);
      if(!freshDesired||!CLASSES.every(k=>freshDesired[k]===initialDesired[k])){entry.reason='PRICE_PLAN_CHANGED';continue;}

      entry.before=fresh.fares?.current?{...fresh.fares.current}:null;
      entry.desired={...freshDesired};
      if(this.settings.mutationDeadlineEpochMs!==undefined&&
        Date.now()>this.settings.mutationDeadlineEpochMs-MUTATION_COMPLETION_RESERVE_MS){
        entry.reason='RUN_TIME_BUDGET_EXHAUSTED_BEFORE_PRICE_SAVE';continue;
      }
      this.attemptedRoutes.add(fresh.routeId);
      entry.status='attempting';
      entry.reason='NATIVE_ROUTE_SAVE_PREPARED';
      await persist();

      try{
        await this.port.save(fresh,freshDesired);
        const after=await this.port.confirm(fresh,freshDesired);
        if(!after||!sameAircraftContext(fresh,after)||!after.fares?.current||
          !CLASSES.every(k=>after.fares!.current![k]===freshDesired[k])||!routeSaveVerified(after))throw new Error('UNCONFIRMED');
        entry.status='adjusted';entry.after={...after.fares.current};entry.reason='NATIVE_ROUTE_PRICE_SAVE_AND_FRESH_READ_CONFIRMED';
      }catch{
        entry.status='outcome_unknown';entry.reason='NO_RETRY_AFTER_PRICE_SAVE_ATTEMPT';report.halted=true;
      }
      await persist();
    }
    report.completedAt=new Date().toISOString();await persist();return report;
  }
}
