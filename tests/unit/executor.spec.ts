import { test,expect } from '@playwright/test';
import { IndividualDepartureExecutor, DeparturePort, ExecutionReport } from '../../demand/executor';
import { AircraftSnapshot, CollectionResult } from '../../demand/types';
import { readDemandConfig } from '../../demand/config';
import { flightCountdownObservation } from '../../optimization/flight-timing';
import { departureControlShape } from '../../demand/departure-control-evidence';

const snapshot=(change:Partial<AircraftSnapshot>={}):AircraftSnapshot=>({aircraftId:'1',registration:'TEST',routeId:'10',routeLabel:'AAA - GRU',from:'AAA',to:'GRU',state:'ready',capacity:{Y:100,J:0,F:0},remaining:{Y:100,J:0,F:0},dailyTotal:{Y:1000,J:100,F:100},observedAt:new Date().toISOString(),...change});
const collection=(a:AircraftSnapshot[],complete=true):CollectionResult=>({aircraft:a,complete,expectedRoutes:a.length,warnings:[]});
function setup(options:{initial?:CollectionResult;fresh?:CollectionResult;prepared?:AircraftSnapshot;confirmed?:AircraftSnapshot|null;dryRun?:boolean;limit?:number;prepareFail?:boolean;clickFail?:boolean;collectFail?:boolean;saveFail?:boolean;mutationDeadlineEpochMs?:number;blockedDepartureKeys?:ReadonlySet<string>;fuelHoldingLbsAtRunStart?:number}={}) {
  let reads=0,clicks=0;const saved:ExecutionReport[]=[];
  const port:DeparturePort={collect:async()=>{reads++;if(options.collectFail&&reads>1)throw Error('loading');return reads===1?options.initial??collection([snapshot()]):options.fresh??collection([snapshot()]);},
    prepare:async a=>{if(options.prepareFail)throw Error('unverified');return options.prepared??snapshot(a);},
    depart:async()=>{clicks++;if(options.clickFail)throw Error('timeout');},
    confirm:async a=>options.confirmed===null?null:options.confirmed??snapshot({...a,state:'inflight',onboard:{Y:88,J:0,F:0},timing:flightCountdownObservation(a.aircraftId,a.routeId,'01:00:00',new Date().toISOString())})};
  const executor=new IndividualDepartureExecutor(port,readDemandConfig({}),{dryRun:options.dryRun??false,maxDepartures:options.limit??1,aircraftOrigins:new Map(),airlineBases:['GRU'],mutationDeadlineEpochMs:options.mutationDeadlineEpochMs,blockedDepartureKeys:options.blockedDepartureKeys,fuelHoldingLbsAtRunStart:options.fuelHoldingLbsAtRunStart},async r=>{if(options.saveFail&&r.entries.some(e=>e.status==='attempting'))throw Error('disk');saved.push(JSON.parse(JSON.stringify(r)));});
  return {executor,saved,clicks:()=>clicks,reads:()=>reads};
}
test('persist intent before exactly one native click and confirm onboard separately from demand coverage',async()=>{
 const s=setup();const r=await s.executor.run();expect(s.clicks()).toBe(1);expect(s.saved.some(r=>r.entries[0]?.status==='attempting')).toBe(true);
 expect(r.summary).toMatchObject({departed:1,unknown:0});expect(r.entries[0].demand?.occupancyPercentage).toBe(100);expect(r.entries[0].actualOnboard?.Y).toBe(88);
 await expect(s.executor.run()).rejects.toThrow('EXECUTION_ALREADY_USED');expect(s.clicks()).toBe(1);
});
test('simulation uses same checks and never calls depart',async()=>{const s=setup({dryRun:true});expect((await s.executor.run()).summary.simulated).toBe(1);expect(s.clicks()).toBe(0);});
test('aircraft at its own base departs on the existing route when demand is sufficient',async()=>{
 const atBase=snapshot({from:'GRU',to:'AAA',routeLabel:'GRU - AAA'});
 const s=setup({initial:collection([atBase]),fresh:collection([atBase]),prepared:atBase});
 const r=await s.executor.run();
 expect(s.clicks()).toBe(1);
 expect(r.summary).toMatchObject({departed:1,held:0});
 expect(r.entries[0].from).toBe('GRU');
 expect(r.entries[0].to).toBe('AAA');
});
for(const [name,options] of Object.entries({
 'zero demand':{prepared:snapshot({remaining:{Y:0,J:0,F:0}})},
 'partial demand':{prepared:snapshot({remaining:{Y:79,J:0,F:0}})},
 'stale fresh demand':{prepared:snapshot({observedAt:'2020-01-01T00:00:00Z'})},
 'invalid demand':{prepared:snapshot({remaining:{Y:2000,J:0,F:0}})},
 'layout changed':{prepared:snapshot({capacity:{Y:101,J:0,F:0}})},
 'identity changed':{prepared:snapshot({aircraftId:'2'})},
 'unknown origin':{initial:collection([snapshot({to:'BBB'})]),fresh:collection([snapshot({to:'BBB'})])},
 'incomplete initial collection':{initial:collection([snapshot()],false)},
 'incomplete fresh collection':{fresh:collection([snapshot()],false)},
 'duplicate aircraft':{initial:collection([snapshot(),snapshot({routeId:'11'})]),fresh:collection([snapshot(),snapshot({routeId:'11'})])},
 'duplicate route':{initial:collection([snapshot(),snapshot({aircraftId:'2'})]),fresh:collection([snapshot(),snapshot({aircraftId:'2'})])},
 'loading failure':{collectFail:true},'control not verified':{prepareFail:true},
})) test(`holds without clicks: ${name}`,async()=>{const s=setup(options);const r=await s.executor.run();expect(r.summary.departed).toBe(0);expect(r.summary.held).toBeGreaterThan(0);expect(s.clicks()).toBe(0);});
for(const [index,options] of [{clickFail:true},{confirmed:null},{confirmed:snapshot({state:'ready'})},{confirmed:snapshot({state:'inflight',timing:null})}].entries())
 test(`unknown result stops without retry case ${index}`,async()=>{const s=setup(options);const r=await s.executor.run();expect(r.halted).toBe(true);expect(r.summary.unknown).toBe(1);expect(s.clicks()).toBe(1);});
test('persistence failure stops before operation',async()=>{const s=setup({saveFail:true});await expect(s.executor.run()).rejects.toThrow('disk');expect(s.clicks()).toBe(0);});
test('real departure cap prevents additional attempts',async()=>{const list=[snapshot(),snapshot({aircraftId:'2',routeId:'11'})];const s=setup({initial:collection(list),fresh:collection(list)});const r=await s.executor.run();expect(s.clicks()).toBe(1);expect(r.entries[1].reason).toBe('EXECUTION_LIMIT');});
test('shared route capacity is allocated once, not twice',async()=>{const list=[snapshot(),snapshot({aircraftId:'2',routeId:'11',capacity:{Y:50,J:0,F:0}})];const s=setup({dryRun:true,limit:2,initial:collection(list),fresh:collection(list)});const r=await s.executor.run();expect(r.summary.simulated).toBe(1);expect(r.summary.held).toBe(1);expect(s.clicks()).toBe(0);});
test('handler evidence redacts every unrecognized query value',()=>{const shape=departureControlShape("Ajax('route_depart.php?id=123&token=PRIVATE&ref=details&costIndex=0','dummy',this);");expect(shape).not.toContain('PRIVATE');expect(shape).not.toContain('123');expect(shape).toContain('token=<value>');});

test('simulation obeys the same cap as real execution',async()=>{const list=[snapshot(),snapshot({aircraftId:'2',routeId:'11'})];const s=setup({dryRun:true,limit:1,initial:collection(list),fresh:collection(list)});const r=await s.executor.run();expect(r.summary.simulated).toBe(1);expect(r.entries[1].reason).toBe('EXECUTION_LIMIT');expect(s.clicks()).toBe(0);});
test('invalid onboard counts cannot confirm a departure',async()=>{const after=snapshot({state:'inflight',onboard:{Y:101,J:0,F:0},timing:flightCountdownObservation('1','10','01:00:00',new Date().toISOString())});const s=setup({confirmed:after});const r=await s.executor.run();expect(r.halted).toBe(true);expect(s.clicks()).toBe(1);});
test('countdown belonging to a different aircraft cannot confirm departure',async()=>{const after=snapshot({state:'inflight',onboard:{Y:88,J:0,F:0},timing:flightCountdownObservation('2','10','01:00:00',new Date().toISOString())});const s=setup({confirmed:after});const r=await s.executor.run();expect(r.summary.unknown).toBe(1);});


test('run time budget holds before mutation and never creates an uncertain result',async()=>{
 const s=setup({mutationDeadlineEpochMs:Date.now()-1});const r=await s.executor.run();
 expect(s.clicks()).toBe(0);expect(r.halted).toBe(false);expect(r.summary).toMatchObject({departed:0,unknown:0,held:1});expect(r.entries[0].reason).toBe('RUN_TIME_BUDGET_EXHAUSTED_BEFORE_EVALUATION');
});


test('persisted uncertain departure quarantine blocks before any click',async()=>{const s=setup({blockedDepartureKeys:new Set(['1:10'])});const r=await s.executor.run();expect(s.clicks()).toBe(0);expect(r.entries[0].reason).toBe('PERSISTED_UNCERTAIN_DEPARTURE_BLOCK');expect(r.summary).toMatchObject({held:1,unknown:0});});


test('verified historical fuel evidence blocks a departure before the click when run stock is insufficient',async()=>{
 const history=(fuelLbs:number)=>({status:'observed' as const,observedAt:new Date().toISOString(),source:'inspected-aircraft-flight-history' as const,complete:false as const,comparisonReady:false as const,mutationAuthorized:false as const,entries:[0,1,2].map(i=>({relativeTime:`${i+1} hours ago`,from:i%2?'GRU':'AAA',to:i%2?'AAA':'GRU',registrationLabel:'TEST',co2Quotas:100,onboard:{Y:80,J:0,F:0},fuelLbs,revenue:1000}))});
 const a=snapshot({flightHistory:history(59928)});
 const s=setup({initial:collection([a]),fresh:collection([a]),prepared:a,fuelHoldingLbsAtRunStart:20040});
 const r=await s.executor.run();
 expect(s.clicks()).toBe(0);
 expect(r.entries[0]).toMatchObject({status:'held',reason:'FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY',resourceEvidence:{fuelAvailableBefore:20040,verifiedRouteFuelLbs:59928,matchingHistorySamples:3,trackingComplete:true}});
});

test('confirmed departures debit only uniquely verified historical fuel and protect later aircraft',async()=>{
 const history=(from:string,to:string,fuelLbs:number)=>({status:'observed' as const,observedAt:new Date().toISOString(),source:'inspected-aircraft-flight-history' as const,complete:false as const,comparisonReady:false as const,mutationAuthorized:false as const,entries:[0,1,2].map(i=>({relativeTime:`${i+1} hours ago`,from:i%2?to:from,to:i%2?from:to,registrationLabel:'TEST',co2Quotas:100,onboard:{Y:80,J:0,F:0},fuelLbs,revenue:1000}))});
 const one=snapshot({flightHistory:history('AAA','GRU',9781)});
 const two=snapshot({aircraftId:'2',routeId:'11',from:'BBB',to:'GRU',routeLabel:'BBB - GRU',flightHistory:history('BBB','GRU',59928)});
 const list=collection([one,two]);let reads=0,clicks=0;
 const port:DeparturePort={
  collect:async()=>{reads++;return list;},
  prepare:async a=>a.aircraftId==='1'?one:two,
  depart:async()=>{clicks++;},
  confirm:async a=>snapshot({...a,state:'inflight',onboard:{Y:80,J:0,F:0},timing:flightCountdownObservation(a.aircraftId,a.routeId,'01:00:00',new Date().toISOString())})
 };
 const executor=new IndividualDepartureExecutor(port,readDemandConfig({}),{dryRun:false,maxDepartures:2,aircraftOrigins:new Map(),airlineBases:['GRU'],fuelHoldingLbsAtRunStart:29821},async()=>{});
 const r=await executor.run();
 expect(clicks).toBe(1);
 expect(r.entries[0].status).toBe('departed');
 expect(r.entries[1]).toMatchObject({status:'held',reason:'FUEL_STOCK_INSUFFICIENT_BY_VERIFIED_HISTORY',resourceEvidence:{fuelCommittedBefore:9781,fuelAvailableBefore:20040,verifiedRouteFuelLbs:59928}});
});

test('missing historical fuel does not claim a shortage, but makes later run-local tracking fail closed',async()=>{
 const one=snapshot();
 const two=snapshot({aircraftId:'2',routeId:'11',from:'BBB',to:'GRU',routeLabel:'BBB - GRU'});
 const list=collection([one,two]);let clicks=0;
 const port:DeparturePort={collect:async()=>list,prepare:async a=>a,depart:async()=>{clicks++;},confirm:async a=>snapshot({...a,state:'inflight',onboard:{Y:80,J:0,F:0},timing:flightCountdownObservation(a.aircraftId,a.routeId,'01:00:00',new Date().toISOString())})};
 const executor=new IndividualDepartureExecutor(port,readDemandConfig({}),{dryRun:false,maxDepartures:2,aircraftOrigins:new Map(),airlineBases:['GRU'],fuelHoldingLbsAtRunStart:100000},async()=>{});
 const r=await executor.run();
 expect(clicks).toBe(1);
 expect(r.entries[0].status).toBe('departed');
 expect(r.entries[1].reason).toBe('FUEL_BUDGET_UNVERIFIED_AFTER_PRIOR_DEPARTURE');
});


test('completion reserve holds before fresh evaluation and avoids expensive reads near deadline',async()=>{
 const s=setup({mutationDeadlineEpochMs:Date.now()+60_000});
 const r=await s.executor.run();
 expect(s.clicks()).toBe(0);
 expect(s.reads()).toBe(1); // initial snapshot only; no per-aircraft fresh collection
 expect(r.halted).toBe(false);
 expect(r.entries[0]).toMatchObject({status:'held',reason:'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_EVALUATION'});
});
