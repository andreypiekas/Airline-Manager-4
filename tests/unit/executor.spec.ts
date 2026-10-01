import { test,expect } from '@playwright/test';
import { IndividualDepartureExecutor, DeparturePort, ExecutionReport } from '../../demand/executor';
import { AircraftSnapshot, CollectionResult } from '../../demand/types';
import { readDemandConfig } from '../../demand/config';
import { flightCountdownObservation } from '../../optimization/flight-timing';
import { departureControlShape } from '../../demand/departure-control-evidence';

const snapshot=(change:Partial<AircraftSnapshot>={}):AircraftSnapshot=>({aircraftId:'1',registration:'TEST',routeId:'10',routeLabel:'AAA - GRU',from:'AAA',to:'GRU',state:'ready',capacity:{Y:100,J:0,F:0},remaining:{Y:100,J:0,F:0},dailyTotal:{Y:1000,J:100,F:100},observedAt:new Date().toISOString(),...change});
const collection=(a:AircraftSnapshot[],complete=true):CollectionResult=>({aircraft:a,complete,expectedRoutes:a.length,warnings:[]});
function setup(options:{initial?:CollectionResult;fresh?:CollectionResult;prepared?:AircraftSnapshot;confirmed?:AircraftSnapshot|null;dryRun?:boolean;limit?:number;prepareFail?:boolean;clickFail?:boolean;collectFail?:boolean;saveFail?:boolean}={}) {
  let reads=0,clicks=0;const saved:ExecutionReport[]=[];
  const port:DeparturePort={collect:async()=>{reads++;if(options.collectFail&&reads>1)throw Error('loading');return reads===1?options.initial??collection([snapshot()]):options.fresh??collection([snapshot()]);},
    prepare:async a=>{if(options.prepareFail)throw Error('unverified');return options.prepared??snapshot(a);},
    depart:async()=>{clicks++;if(options.clickFail)throw Error('timeout');},
    confirm:async a=>options.confirmed===null?null:options.confirmed??snapshot({...a,state:'inflight',onboard:{Y:88,J:0,F:0},timing:flightCountdownObservation(a.aircraftId,a.routeId,'01:00:00',new Date().toISOString())})};
  const executor=new IndividualDepartureExecutor(port,readDemandConfig({}),{dryRun:options.dryRun??false,maxDepartures:options.limit??1,aircraftOrigins:new Map(),airlineBases:['GRU']},async r=>{if(options.saveFail&&r.entries.some(e=>e.status==='attempting'))throw Error('disk');saved.push(JSON.parse(JSON.stringify(r)));});
  return {executor,saved,clicks:()=>clicks};
}
test('persist intent before exactly one native click and confirm onboard separately from demand coverage',async()=>{
 const s=setup();const r=await s.executor.run();expect(s.clicks()).toBe(1);expect(s.saved.some(r=>r.entries[0]?.status==='attempting')).toBe(true);
 expect(r.summary).toMatchObject({departed:1,unknown:0});expect(r.entries[0].demand?.occupancyPercentage).toBe(100);expect(r.entries[0].actualOnboard?.Y).toBe(88);
 await expect(s.executor.run()).rejects.toThrow('EXECUTION_ALREADY_USED');expect(s.clicks()).toBe(1);
});
test('simulation uses same checks and never calls depart',async()=>{const s=setup({dryRun:true});expect((await s.executor.run()).summary.simulated).toBe(1);expect(s.clicks()).toBe(0);});
for(const [name,options] of Object.entries({
 'zero demand':{prepared:snapshot({remaining:{Y:0,J:0,F:0}})},
 'partial demand':{prepared:snapshot({remaining:{Y:79,J:0,F:0}})},
 'stale fresh demand':{prepared:snapshot({observedAt:'2020-01-01T00:00:00Z'})},
 'invalid demand':{prepared:snapshot({remaining:{Y:2000,J:0,F:0}})},
 'layout changed':{prepared:snapshot({capacity:{Y:101,J:0,F:0}})},
 'identity changed':{prepared:snapshot({aircraftId:'2'})},
 'landed at own base':{initial:collection([snapshot({from:'GRU',to:'AAA'})]),fresh:collection([snapshot({from:'GRU',to:'AAA'})])},
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
