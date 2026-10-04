import { test, expect } from '@playwright/test';
import { AircraftSnapshot, CollectionResult } from '../../demand/types';
import { PricingPort, TicketPricingExecutor } from '../../pricing/executor';

const now=()=>new Date().toISOString();
const aircraft=(overrides:Partial<AircraftSnapshot>={}):AircraftSnapshot=>({
  aircraftId:'101',registration:'TEST-101',routeId:'9001',routeLabel:'GRU-AAA',from:'GRU',to:'AAA',state:'ready',
  capacity:{Y:100,J:10,F:5},remaining:{Y:100,J:10,F:5},dailyTotal:{Y:100,J:10,F:5},observedAt:now(),
  fares:{
    automatic:{Y:1000,J:2000,F:3000},current:{Y:1000,J:2000,F:3000},
    source:'inspected-auto-control',
    saveControl:{endpointVerified:true,target:'route',targetMatchesContext:true,shape:'native'}
  },
  ...overrides
});
const collection=(items:AircraftSnapshot[]):CollectionResult=>({aircraft:items,complete:true,expectedRoutes:items.length,warnings:[]});

class FakePort implements PricingPort {
  saves:{routeId:string;desired:any}[]=[];
  failConfirm=false;
  constructor(public current:CollectionResult){}
  async collect(){return this.current;}
  async prepare(expected:AircraftSnapshot){
    const found=this.current.aircraft.find(a=>a.aircraftId===expected.aircraftId)!;
    return {...found,observedAt:now()};
  }
  async save(expected:AircraftSnapshot,desired:any){
    this.saves.push({routeId:expected.routeId,desired:{...desired}});
    this.current={...this.current,aircraft:this.current.aircraft.map(a=>a.aircraftId===expected.aircraftId?{
      ...a,observedAt:now(),fares:{...a.fares!,current:{...desired}}
    }:a)};
  }
  async confirm(expected:AircraftSnapshot,desired:any){
    if(this.failConfirm)return null;
    return this.current.aircraft.find(a=>a.aircraftId===expected.aircraftId)||null;
  }
}

test('adjusts one verified unique route and confirms fresh saved fares',async()=>{
  const port=new FakePort(collection([aircraft()]));
  let last:any=null;
  const executor=new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300},async r=>{last=JSON.parse(JSON.stringify(r));});
  const r=await executor.run();
  expect(port.saves).toEqual([{routeId:'9001',desired:{Y:1100,J:2160,F:3180}}]);
  expect(r.summary).toEqual({evaluated:1,adjusted:1,unchanged:0,held:0,unknown:0});
  expect(r.entries[0]).toMatchObject({status:'adjusted',before:{Y:1000,J:2000,F:3000},desired:{Y:1100,J:2160,F:3180},after:{Y:1100,J:2160,F:3180}});
  expect(last.halted).toBe(false);
});

test('already-correct route is left unchanged without Save',async()=>{
  const a=aircraft({fares:{
    automatic:{Y:1000,J:2000,F:3000},current:{Y:1100,J:2160,F:3180},source:'inspected-auto-control',
    saveControl:{endpointVerified:true,target:'route',targetMatchesContext:true,shape:'native'}
  }});
  const port=new FakePort(collection([a]));
  const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300},async()=>{}).run();
  expect(port.saves).toHaveLength(0);
  expect(r.entries[0]).toMatchObject({status:'unchanged',reason:'ALREADY_AT_TARGET'});
});

test('shared route is held because Save is route-wide',async()=>{
  const a=aircraft();
  const b=aircraft({aircraftId:'102',registration:'TEST-102'});
  const port=new FakePort(collection([a,b]));
  const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300},async()=>{}).run();
  expect(port.saves).toHaveLength(0);
  expect(r.entries.map(e=>e.reason)).toEqual(['ROUTE_SHARED_BY_MULTIPLE_AIRCRAFT','ROUTE_SHARED_BY_MULTIPLE_AIRCRAFT']);
});

test('unverified or non-route Save target is held',async()=>{
  const a=aircraft({fares:{
    automatic:{Y:1000,J:2000,F:3000},current:{Y:1000,J:2000,F:3000},source:'inspected-auto-control',
    saveControl:{endpointVerified:true,target:'aircraft',targetMatchesContext:true,shape:'native'}
  }});
  const port=new FakePort(collection([a]));
  const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300},async()=>{}).run();
  expect(r.entries[0]).toMatchObject({status:'held',reason:'ROUTE_SAVE_CONTROL_UNVERIFIED'});
  expect(port.saves).toHaveLength(0);
});

test('unconfirmed result halts all later adjustments with no retry',async()=>{
  const a=aircraft();
  const b=aircraft({aircraftId:'102',registration:'TEST-102',routeId:'9002',to:'BBB'});
  const port=new FakePort(collection([a,b]));port.failConfirm=true;
  const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300},async()=>{}).run();
  expect(port.saves).toHaveLength(1);
  expect(r.halted).toBe(true);
  expect(r.entries[0]).toMatchObject({status:'outcome_unknown',reason:'NO_RETRY_AFTER_PRICE_SAVE_ATTEMPT'});
  expect(r.entries[1]).toMatchObject({status:'held',reason:'PREVIOUS_OUTCOME_UNKNOWN'});
});

test('execution limit prevents more route changes in the same run',async()=>{
  const a=aircraft();
  const b=aircraft({aircraftId:'102',registration:'TEST-102',routeId:'9002',to:'BBB'});
  const port=new FakePort(collection([a,b]));
  const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:1,maxAgeSeconds:300},async()=>{}).run();
  expect(port.saves).toHaveLength(1);
  expect(r.entries[1]).toMatchObject({status:'held',reason:'PRICING_EXECUTION_LIMIT'});
});


test('persisted uncertain pricing quarantine blocks route before prepare or Save',async()=>{
 const a=aircraft();const port=new FakePort(collection([a]));let prepares=0;
 port.prepare=async expected=>{prepares++;return expected;};
 const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300,blockedRouteIds:new Set(['9001'])},async()=>{}).run();
 expect(prepares).toBe(0);expect(port.saves).toHaveLength(0);
 expect(r.entries[0]).toMatchObject({status:'held',reason:'PERSISTED_UNCERTAIN_PRICING_BLOCK'});
});


test('expired global deadline holds pricing before prepare and creates no uncertain result',async()=>{
 const port=new FakePort(collection([aircraft()]));let prepares=0;
 port.prepare=async expected=>{prepares++;return expected;};
 const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300,mutationDeadlineEpochMs:Date.now()-1},async()=>{}).run();
 expect(prepares).toBe(0);expect(port.saves).toHaveLength(0);expect(r.halted).toBe(false);
 expect(r.entries[0]).toMatchObject({status:'held',reason:'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_PRICE_PREPARE'});
});

test('pricing completion reserve avoids expensive prepare when less than four minutes remain',async()=>{
 const port=new FakePort(collection([aircraft()]));let prepares=0;
 port.prepare=async expected=>{prepares++;return expected;};
 const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300,mutationDeadlineEpochMs:Date.now()+120_000},async()=>{}).run();
 expect(prepares).toBe(0);expect(port.saves).toHaveLength(0);expect(r.halted).toBe(false);
 expect(r.entries[0]).toMatchObject({status:'held',reason:'RUN_TIME_BUDGET_EXHAUSTED_BEFORE_PRICE_PREPARE'});
});


test('incomplete initial pricing collection is a safe phase HOLD, not a workflow-fatal error',async()=>{
 const a=aircraft();
 const port=new FakePort({...collection([a]),complete:false,warnings:['synthetic incomplete']});
 const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300},async()=>{}).run();
 expect(port.saves).toHaveLength(0);
 expect(r.halted).toBe(false);
 expect(r.phaseHoldReason).toBe('PRICING_INITIAL_COLLECTION_INCOMPLETE');
 expect(r.entries[0]).toMatchObject({status:'held',reason:'PRICING_INITIAL_COLLECTION_INCOMPLETE'});
 expect(r.summary).toMatchObject({adjusted:0,unknown:0,held:1});
});

test('failed initial pricing collection is a safe phase HOLD before any Save',async()=>{
 const port=new FakePort(collection([aircraft()]));
 port.collect=async()=>{throw new Error('loading');};
 const r=await new TicketPricingExecutor(port,{enabled:true,maxAdjustments:5,maxAgeSeconds:300},async()=>{}).run();
 expect(port.saves).toHaveLength(0);
 expect(r.halted).toBe(false);
 expect(r.phaseHoldReason).toBe('PRICING_INITIAL_COLLECTION_FAILED');
 expect(r.summary).toMatchObject({evaluated:0,adjusted:0,unknown:0});
});
