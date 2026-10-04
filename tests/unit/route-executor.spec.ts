import { test,expect } from '@playwright/test';
import type { AircraftSnapshot } from '../../demand/types';
import { RouteMutationExecutor, type RouteExecutionCandidate, type RouteExecutionPort } from '../../optimization/route-executor';

const aircraft=(o:Partial<AircraftSnapshot>={}):AircraftSnapshot=>({
  aircraftId:'101',registration:'TEST-101',routeId:'9001',routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'ready',
  capacity:{Y:100,J:10,F:5},remaining:{Y:100,J:10,F:5},dailyTotal:{Y:200,J:20,F:10},observedAt:new Date().toISOString(),...o
});
const candidate=(o:Partial<RouteExecutionCandidate>={}):RouteExecutionCandidate=>({
  aircraftId:'101',from:'AAA',to:'CCC',airportId:'300',comparisonReady:true,observedAt:new Date().toISOString(),
  capacity:{Y:100,J:10,F:5},autoFares:{Y:1000,J:2000,F:3000},costIndex:200,
  distanceKm:1200,durationSeconds:5400,fuelLbs:12000,co2KgPerPaxKm:.12,routeFee:25000,
  routeMutationControl:{
    observed:true,source:'jquery-direct-click',endpointVerified:true,targetVerified:true,
    aircraftIdMatchesContext:true,airportIdMatchesContext:true,registrationInputVerified:true,
    seatInputsVerified:true,endCostIndexVerified:true,nonCharterBranchVerified:true,charterBranchObserved:false,
    stopoverIds:[0],ferryModes:[0],directRouteVerified:true,nativeClickReady:true,shape:'native',mutationAuthorized:false
  },...o
});
const decision:any={
  aircraftId:'101',decision:'would_reroute',selected:{from:'AAA',to:'CCC',airportId:'300',conservativeProfitPerHour:100,firstCycleLow:1000},
  compared:1,dominating:1,reason:'verified',dryRun:true,mutationAuthorized:false
};

class FakePort implements RouteExecutionPort{
  reroutes=0;failConfirm=false;prepareChange=false;
  async prepare(expected:AircraftSnapshot,target:RouteExecutionCandidate){
    return {aircraft:this.prepareChange?{...expected,to:'ZZZ'}:{...expected},target:{...target}};
  }
  async reroute(){this.reroutes++;}
  async confirm(expected:AircraftSnapshot,target:RouteExecutionCandidate){
    if(this.failConfirm)return null;
    return {...expected,routeId:'9999',from:target.from,to:target.to,routeLabel:target.from+'-'+target.to};
  }
}

test('persists intent, mutates once and confirms a changed route',async()=>{
 const port=new FakePort();let reports:any[]=[];
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300},async x=>{reports.push(JSON.parse(JSON.stringify(x)));})
  .run([aircraft()],[decision],[candidate()]);
 expect(port.reroutes).toBe(1);
 expect(r.summary).toEqual({evaluated:1,rerouted:1,held:0,unknown:0});
 expect(r.entries[0]).toMatchObject({status:'rerouted',confirmedRouteId:'9999',reason:'NATIVE_REROUTE_AND_FRESH_ROUTE_CONFIRMED'});
 expect(reports.some(x=>x.entries[0]?.status==='attempting'&&x.entries[0]?.mutationAuthorized===true&&x.entries[0]?.reason==='FRESH_CONTEXT_VERIFIED_NATIVE_REROUTE_AUTHORIZED')).toBe(true);
 expect(r.entries[0].mutationAuthorized).toBe(false);
});

test('disabled executor never prepares or mutates',async()=>{
 const port=new FakePort();
 const r=await new RouteMutationExecutor(port,{enabled:false,maxReroutes:1,maxAgeSeconds:300},async()=>{}).run([aircraft()],[decision],[candidate()]);
 expect(port.reroutes).toBe(0);expect(r.entries).toHaveLength(0);
});

test('unverified candidate stays held without mutation',async()=>{
 const port=new FakePort();
 const bad=candidate({comparisonReady:false});
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300},async()=>{}).run([aircraft()],[decision],[bad]);
 expect(port.reroutes).toBe(0);
 expect(r.entries[0]).toMatchObject({status:'held',mutationAuthorized:false,reason:'ROUTE_EXECUTION_GUARD_REJECTED'});
});

test('stale or changed target fingerprint stays held before mutation',async()=>{
 const port=new FakePort();
 const stale=candidate({observedAt:new Date(Date.now()-301000).toISOString()});
 const staleResult=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300},async()=>{}).run([aircraft()],[decision],[stale]);
 expect(staleResult.entries[0]).toMatchObject({status:'held',reason:'ROUTE_EXECUTION_GUARD_REJECTED'});
 expect(port.reroutes).toBe(0);
 const changedPort=new FakePort();
 changedPort.prepare=async(expected,target)=>({aircraft:{...expected},target:{...target,routeFee:target.routeFee+1}});
 const changed=await new RouteMutationExecutor(changedPort,{enabled:true,maxReroutes:1,maxAgeSeconds:300},async()=>{}).run([aircraft()],[decision],[candidate()]);
 expect(changed.entries[0]).toMatchObject({status:'held',mutationAuthorized:false,reason:'ROUTE_EXECUTION_CONTEXT_CHANGED'});
 expect(changedPort.reroutes).toBe(0);
});

test('context change before mutation fails closed',async()=>{
 const port=new FakePort();port.prepareChange=true;
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300},async()=>{}).run([aircraft()],[decision],[candidate()]);
 expect(port.reroutes).toBe(0);
 expect(r.entries[0]).toMatchObject({status:'held',mutationAuthorized:false,reason:'ROUTE_EXECUTION_CONTEXT_CHANGED'});
});

test('unconfirmed mutation halts without retry',async()=>{
 const port=new FakePort();port.failConfirm=true;
 const d2={...decision,aircraftId:'102',selected:{...decision.selected,to:'DDD',airportId:'301'}};
 const a2=aircraft({aircraftId:'102',registration:'TEST-102',routeId:'9002'});
 const c2=candidate({aircraftId:'102',to:'DDD',airportId:'301',routeMutationControl:{...candidate().routeMutationControl!,
   aircraftIdMatchesContext:true,airportIdMatchesContext:true}});
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:2,maxAgeSeconds:300},async()=>{})
   .run([aircraft(),a2],[decision,d2],[candidate(),c2]);
 expect(port.reroutes).toBe(1);
 expect(r.halted).toBe(true);
 expect(r.entries[0]).toMatchObject({status:'outcome_unknown',mutationAuthorized:false,reason:'NO_RETRY_AFTER_ROUTE_MUTATION_ATTEMPT'});
 expect(r.entries[1]).toMatchObject({status:'held',reason:'PREVIOUS_ROUTE_OUTCOME_UNKNOWN'});
});


test('persisted uncertain route quarantine blocks before prepare or reroute',async()=>{
 const port=new FakePort();let prepares=0;
 port.prepare=async(expected,target)=>{prepares++;return {aircraft:{...expected},target:{...target}};};
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300,blockedAircraftIds:new Set(['101'])},async()=>{})
  .run([aircraft()],[decision],[candidate()]);
 expect(prepares).toBe(0);expect(port.reroutes).toBe(0);
 expect(r.entries[0]).toMatchObject({status:'held',mutationAuthorized:false,reason:'PERSISTED_UNCERTAIN_ROUTE_BLOCK'});
});


test('expired global deadline holds reroute before prepare and creates no uncertain result',async()=>{
 const port=new FakePort();let prepares=0;
 port.prepare=async(expected,target)=>{prepares++;return {aircraft:{...expected},target:{...target}};};
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300,mutationDeadlineEpochMs:Date.now()-1},async()=>{})
  .run([aircraft()],[decision],[candidate()]);
 expect(prepares).toBe(0);expect(port.reroutes).toBe(0);expect(r.halted).toBe(false);
 expect(r.entries[0]).toMatchObject({status:'held',mutationAuthorized:false,reason:'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_ROUTE_PREPARE'});
});

test('route completion reserve avoids expensive prepare when less than four minutes remain',async()=>{
 const port=new FakePort();let prepares=0;
 port.prepare=async(expected,target)=>{prepares++;return {aircraft:{...expected},target:{...target}};};
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300,mutationDeadlineEpochMs:Date.now()+120_000},async()=>{})
  .run([aircraft()],[decision],[candidate()]);
 expect(prepares).toBe(0);expect(port.reroutes).toBe(0);expect(r.halted).toBe(false);
 expect(r.entries[0]).toMatchObject({status:'held',reason:'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_ROUTE_PREPARE'});
});


test('completed daily route review blocks before prepare or reroute',async()=>{
 const port=new FakePort();let prepares=0;
 port.prepare=async(expected,target)=>{prepares++;return {aircraft:{...expected},target:{...target}};};
 const r=await new RouteMutationExecutor(port,{
   enabled:true,maxReroutes:1,maxAgeSeconds:300,reviewedTodayAircraftIds:new Set(['101'])
 },async()=>{}).run([aircraft()],[decision],[candidate()]);
 expect(prepares).toBe(0);expect(port.reroutes).toBe(0);expect(r.halted).toBe(false);
 expect(r.entries[0]).toMatchObject({status:'held',mutationAuthorized:false,reason:'DAILY_ROUTE_REVIEW_ALREADY_COMPLETED'});
});


test('prepare failure keeps generic HOLD reason while persisting only a sanitized diagnostic',async()=>{
 const port=new FakePort();
 port.prepare=async()=>{throw new Error('RESEARCH_ROUTE_NOT_FOUND');};
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300},async()=>{})
  .run([aircraft()],[decision],[candidate()]);
 expect(port.reroutes).toBe(0);
 expect(r.entries[0]).toMatchObject({
  status:'held',mutationAuthorized:false,reason:'ROUTE_EXECUTION_PREPARE_FAILED',
  prepareDiagnostic:'RESEARCH_ROUTE_NOT_FOUND'
 });
});

test('arbitrary prepare errors are not copied into persisted route diagnostics',async()=>{
 const port=new FakePort();
 port.prepare=async()=>{throw new Error('account-specific selector foo@example.com timed out');};
 const r=await new RouteMutationExecutor(port,{enabled:true,maxReroutes:1,maxAgeSeconds:300},async()=>{})
  .run([aircraft()],[decision],[candidate()]);
 expect(r.entries[0].prepareDiagnostic).toBe('PLAYWRIGHT_TIMEOUT');
 expect(JSON.stringify(r)).not.toContain('foo@example.com');
});
