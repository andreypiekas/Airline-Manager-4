import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHubReturnState, StateOptions } from '../../optimization/github-state';
import { analyzeOptimizationWithJournal, optimizationConfig } from '../../optimization/report';
import { AircraftSnapshot } from '../../demand/types';
import { RouteReview } from '../../optimization/route-optimizer';

const scope='company-test';
const empty=()=>({schemaVersion:1,scope,entries:[] as any[]});
const event=(id='flight-1')=>({aircraftId:'1',origin:'AAA',flightId:id,reviewedAt:'2026-01-01T00:00:00.000Z',decision:'keep_route'});
function server() {
  let data=empty(), revision=0, sha='a'.repeat(40); const calls: {method:string;body:any;url:string}[]=[];
  const request: typeof fetch=async(url,options)=>{
    const method=String(options?.method);const body=options?.body ? JSON.parse(String(options.body)):null;
    calls.push({method,body,url:String(url)});
    expect(new URL(String(url)).origin).toBe('https://api.github.com');expect(options?.redirect).toBe('error');
    if(method==='GET') {
      expect(new URL(String(url)).searchParams.get('ref')).toBe('am4-runtime-state');
      return new Response(JSON.stringify({type:'file',encoding:'base64',size:JSON.stringify(data).length,sha,content:Buffer.from(JSON.stringify(data)).toString('base64')}),{status:200});
    }
    expect(body.branch).toBe('am4-runtime-state');
    if(body.sha!==sha) return new Response('{}',{status:409});
    data=JSON.parse(Buffer.from(body.content,'base64').toString());sha=(++revision).toString(16).padStart(40,'0');return new Response('{}',{status:200});
  };
  return {request,calls,get data(){return data;}};
}
let root:string;
test.beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'am4-remote-'));});
test.afterEach(async()=>{await rm(root,{recursive:true,force:true});});
const options=(name='runner-1'):StateOptions=>({repository:'owner/repo',scope,directory:join(root,name),token:'fake-test-token'});
async function append(directory:string,id='flight-1') {const path=join(directory,'return-journal.json');const d=JSON.parse(await readFile(path,'utf8'));d.entries.push(event(id));await writeFile(path,JSON.stringify(d));}

test('two fresh runners restore saved state from fixed branch',async()=>{
  const remote=server(), first=new GitHubReturnState(options(),remote.request);await first.restore();await append(options().directory);expect(await first.save()).toBe('saved');
  const second=new GitHubReturnState(options('runner-2'),remote.request);await second.restore();
  expect(JSON.parse(await readFile(join(options('runner-2').directory,'return-journal.json'),'utf8')).entries).toEqual([event()]);
  expect(await second.save()).toBe('unchanged');expect(remote.calls.filter(c=>c.method==='PUT')).toHaveLength(1);
});
test('conflicting runner cannot overwrite newer state',async()=>{
  const remote=server(), a=new GitHubReturnState(options(),remote.request), b=new GitHubReturnState(options('runner-2'),remote.request);
  await a.restore();await b.restore();await append(options().directory,'flight-a');await append(options('runner-2').directory,'flight-b');await a.save();
  await expect(b.save()).rejects.toThrow('STATE_HTTP_409');expect(remote.data.entries).toEqual([event('flight-a')]);
});
for(const status of [404,403,500]) test(`remote failure ${status} never bootstraps empty state`,async()=>{
  const client=new GitHubReturnState(options(),async()=>new Response('{}',{status}));await expect(client.restore()).rejects.toThrow(`STATE_HTTP_${status}`);
  await expect(readFile(join(options().directory,'return-journal.json'))).rejects.toThrow();
});
test('invalid remote scope is rejected',async()=>{
  const body={type:'file',encoding:'base64',size:50,sha:'a'.repeat(40),content:Buffer.from(JSON.stringify({...empty(),scope:'other'})).toString('base64')};
  await expect(new GitHubReturnState(options(),async()=>new Response(JSON.stringify(body))).restore()).rejects.toThrow('STATE_INVALID');
});
test('restore cannot overwrite uncommitted local state',async()=>{
  const remote=server(),client=new GitHubReturnState(options(),remote.request);await client.restore();await append(options().directory);
  await expect(client.restore()).rejects.toThrow('STATE_LOCAL_EXISTS');expect(remote.calls).toHaveLength(1);
});
test('saved history cannot be removed or edited',async()=>{
  const remote=server(),first=new GitHubReturnState(options(),remote.request);await first.restore();await append(options().directory);await first.save();
  const client=new GitHubReturnState(options('runner-2'),remote.request);await client.restore();await writeFile(join(options('runner-2').directory,'return-journal.json'),JSON.stringify(empty()));
  await expect(client.save()).rejects.toThrow('STATE_NOT_APPEND_ONLY');
});
test('network exceptions never expose token or response contents',async()=>{
  const client=new GitHubReturnState(options(),async()=>{throw new Error('fake-test-token response secret');});
  await expect(client.restore()).rejects.toThrow('STATE_NETWORK_FAILED');
});
test('initialize is explicit and never supplies SHA to overwrite a journal',async()=>{
  const calls:any[]=[];const client=new GitHubReturnState(options(),async(url,options)=>{calls.push(JSON.parse(String(options?.body)));return new Response('{}',{status:201});});
  await client.initialize();expect(calls[0]).toMatchObject({branch:'am4-runtime-state'});expect(calls[0].sha).toBeUndefined();
  expect(JSON.parse(Buffer.from(calls[0].content,'base64').toString())).toEqual(empty());
});
test('configuration rejects path traversal and missing scope',()=>{
  expect(()=>new GitHubReturnState({...options(),repository:'../other'})).toThrow();
  expect(()=>optimizationConfig({ENABLE_RETURN_JOURNAL:'true'})).toThrow();expect(()=>optimizationConfig({ENABLE_RETURN_JOURNAL:'yes'})).toThrow();
  expect(optimizationConfig({}).returnJournal).toBeNull();
});
function review():RouteReview {
  const now='2026-01-01T00:00:00.000Z';const leg={from:'AAA',to:'BBB',distanceKm:1000,durationHours:2,originRunwayFt:10000,destinationRunwayFt:10000,demandPool:'AAA-BBB',remaining:{Y:1000,J:0,F:0},automaticFares:{Y:1000,J:0,F:0},expectedLoadFactor:{Y:1,J:0,F:0},costs:{fuel:1000,co2:100,maintenance:100,airportAndOther:100}};
  return {position:{aircraftId:'1',homeBase:'AAA',airport:'AAA',state:'landed',flightId:'flight-1',destination:null,observedAt:now},previousPosition:{aircraftId:'1',homeBase:'AAA',airport:null,state:'inflight',flightId:'flight-1',destination:'AAA',observedAt:'2025-12-31T23:30:00Z'},capacity:{Y:100,J:0,F:0},rangeKm:5000,minRunwayFt:5000,enforceRunway:true,currentRouteId:'current',candidatesComplete:true,candidates:[{id:'current',observedAt:now,setupCost:0,demandNetOfOtherAircraft:true,legs:[leg,{...leg,from:'BBB',to:'AAA'}]}]};
}
test('reports deduplicate an arrival after remote save and fresh runner restore',async()=>{
  const remote=server(),first=new GitHubReturnState(options(),remote.request);await first.restore();const input=review();
  const aircraft:AircraftSnapshot={aircraftId:'1',registration:'TEST',routeId:'current',routeLabel:'AAA-BBB',from:'AAA',to:'BBB',state:'ready',capacity:input.capacity,remaining:{Y:1000,J:0,F:0},dailyTotal:{Y:1000,J:0,F:0},observedAt:input.position.observedAt};
  const config=optimizationConfig({ENABLE_RETURN_JOURNAL:'true',RETURN_JOURNAL_SCOPE:scope,AIRCRAFT_ORIGINS_JSON:'[{"aircraftId":"1","origin":"AAA"}]'});config.returnJournal!.directory=options().directory;
  const collection={aircraft:[aircraft],complete:true,expectedRoutes:1,warnings:[]};
  expect((await analyzeOptimizationWithJournal(collection,config,{'1':input},new Date(input.position.observedAt))).aircraft[0].route.decision).toBe('keep_route');
  await first.save();const second=new GitHubReturnState(options('runner-2'),remote.request);await second.restore();config.returnJournal!.directory=options('runner-2').directory;
  const result=await analyzeOptimizationWithJournal(collection,config,{'1':input},new Date(input.position.observedAt));
  expect(result.aircraft[0].route.decision).toBe('already_reviewed');expect(result.aircraft[0].route.mutationAuthorized).toBe(false);
});
test('enabled report integration refuses absent restored state',async()=>{
  const config=optimizationConfig({ENABLE_RETURN_JOURNAL:'true',RETURN_JOURNAL_SCOPE:scope});config.returnJournal!.directory=options().directory;
  await expect(analyzeOptimizationWithJournal({aircraft:[],complete:true,expectedRoutes:0,warnings:[]},config)).rejects.toThrow();
});

for (const base of ['XAP','GRU','DTW']) test(`multi-run daily lifecycle at ${base}`,async({},testInfo)=>{
  const remote=server(); const timeline:unknown[]=[];
  const config=optimizationConfig({ENABLE_RETURN_JOURNAL:'true',RETURN_JOURNAL_SCOPE:scope,AIRCRAFT_ORIGINS_JSON:JSON.stringify([{aircraftId:'1',origin:base}])});
  const stages=[
    {day:1,complete:false,demand:0,better:false,expected:'unavailable',events:0},
    {day:1,complete:true,demand:0,better:false,expected:'hold',events:1},
    {day:1,complete:true,demand:0,better:false,expected:'already_reviewed',events:1},
    {day:2,complete:true,demand:1000,better:false,expected:'keep_route',events:2},
    {day:2,complete:true,demand:1000,better:false,expected:'already_reviewed',events:2},
    {day:3,complete:true,demand:1000,better:true,expected:'would_reroute',events:3},
  ];
  for(const [index,stage] of stages.entries()) {
    const stateOptions=options(`lifecycle-${base}-${index}`);
    const client=new GitHubReturnState(stateOptions,remote.request); await client.restore();
    config.returnJournal!.directory=stateOptions.directory;
    const input=review(); const now=new Date(`2026-01-0${stage.day}T12:00:00Z`);
    input.previousPosition=null;input.position={...input.position,homeBase:base,airport:base,flightId:null,observedAt:now.toISOString()};
    input.candidatesComplete=stage.complete;
    for(const c of input.candidates) {
      c.observedAt=now.toISOString();
      c.legs[0]={...c.legs[0],from:base,demandPool:`${base}-BBB`,remaining:{Y:stage.demand,J:0,F:0}};
      c.legs[1]={...c.legs[1],to:base,demandPool:`${base}-BBB`,remaining:{Y:stage.demand,J:0,F:0}};
    }
    if(stage.better){const best=JSON.parse(JSON.stringify(input.candidates[0]));best.id='better';best.setupCost=500;best.legs.forEach((l:any)=>l.automaticFares.Y=2000);input.candidates.push(best);}
    const aircraft:AircraftSnapshot={aircraftId:'1',registration:'SIMULATED',routeId:'current',routeLabel:`${base}-BBB`,from:base,to:'BBB',state:'ready',capacity:input.capacity,remaining:{Y:stage.demand,J:0,F:0},dailyTotal:{Y:1000,J:0,F:0},observedAt:now.toISOString()};
    const result=await analyzeOptimizationWithJournal({aircraft:[aircraft],complete:true,expectedRoutes:1,warnings:[]},config,{'1':input},now);
    const plan=result.aircraft[0].route;
    expect(plan.decision).toBe(stage.expected);expect(plan.mutationAuthorized).toBe(false);
    const save=await client.save();expect(remote.data.entries).toHaveLength(stage.events);
    timeline.push({run:index+1,base,date:now.toISOString(),remaining:aircraft.remaining,decision:plan.decision,reason:plan.reason,scores:plan.scores,persistedEvents:remote.data.entries.length,save,mutationAuthorized:false});
  }
  await mkdir(testInfo.outputDir,{recursive:true});
  await writeFile(testInfo.outputPath('simulation-report.json'),JSON.stringify({schemaVersion:1,synthetic:true,transport:'mock-github-api',gameRequests:0,dryRun:true,timeline},null,2));
});

test('operational events are append-only across remote state saves',async()=>{
 const remote=server(),client=new GitHubReturnState(options(),remote.request);await client.restore();
 const p=join(options().directory,'return-journal.json'),d=JSON.parse(await readFile(p,'utf8'));
 d.events=[{eventId:'dep_123_1_current',type:'departure',aircraftId:'1',registration:'TEST',routeId:'current',from:'AAA',to:'BBB',observedAt:'2026-01-01T00:00:00.000Z',result:'departed',demand:{availableBefore:{Y:100,J:0,F:0},possiblePassengers:{Y:90,J:0,F:0},occupancyPercentage:90},actualOnboard:{Y:88,J:0,F:0}}];
 await writeFile(p,JSON.stringify(d));expect(await client.save()).toBe('saved');
 const second=new GitHubReturnState(options('runner-2'),remote.request);await second.restore();const p2=join(options('runner-2').directory,'return-journal.json'),d2=JSON.parse(await readFile(p2,'utf8'));d2.events=[];await writeFile(p2,JSON.stringify(d2));
 await expect(second.save()).rejects.toThrow('STATE_NOT_APPEND_ONLY');
});
