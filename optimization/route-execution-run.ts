import { Page } from '@playwright/test';
import { mkdir,open,readFile,rename,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DemandSimulationContext } from '../demand/run';
import type { Cabins } from '../demand/types';
import { PlaywrightRouteExecutionPort } from './route-playwright-port';
import { RouteMutationExecutor,type RouteExecutionCandidate,type RouteExecutionReport } from './route-executor';
import { optimizationConfig } from './report';
import { resolveAircraftOrigin } from './aircraft-origins';
import { appendConfirmedRerouteReviews, appendUncertainRouteMutations, appendVerifiedKeepRouteDecisions, readUnresolvedRouteAircraftIds, validateReturnJournal } from './return-journal';
import { dailyReviewDue } from './review-schedule';

export interface RouteExecutionRuntimeSettings {
  enabled:boolean;
  maxReroutes:number;
  maxAgeSeconds:number;
  mutationDeadlineEpochMs?:number;
}

export function routeExecutionSettings(env:NodeJS.ProcessEnv=process.env):RouteExecutionRuntimeSettings{
  const raw=(env.ENABLE_ROUTE_EXECUTION||'false').trim().toLowerCase();
  const maxReroutes=Number((env.ROUTE_MAX_REROUTES_PER_RUN||'1').trim());
  const maxAgeSeconds=Number((env.DEMAND_MAX_AGE_SECONDS||'300').trim());
  const deadlineRaw=(env.ROUTE_EXECUTION_MUTATION_DEADLINE_EPOCH_MS||'').trim();
  const mutationDeadlineEpochMs=deadlineRaw?Number(deadlineRaw):undefined;
  if(!['true','false'].includes(raw)||!Number.isSafeInteger(maxReroutes)||maxReroutes<1||maxReroutes>5||
    !Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||maxAgeSeconds>900||
    (mutationDeadlineEpochMs!==undefined&&(!Number.isSafeInteger(mutationDeadlineEpochMs)||mutationDeadlineEpochMs<=0)))
    throw new Error('ROUTE_EXECUTION_CONFIG_INVALID');
  const enabled=raw==='true';
  if(enabled&&(
    env.ROUTE_EXECUTION_ACK!=='native-direct-reroute-v1'||
    env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='andreypiekas/Airline-Manager-4'||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID||'')||env.GITHUB_RUN_ATTEMPT!=='1'||
    (env.DEMAND_DRY_RUN||'').trim().toLowerCase()!=='false'||
    (env.ENABLE_ROUTE_OPTIMIZER||'true').trim().toLowerCase()!=='true'
  ))throw new Error('ROUTE_REAL_EXECUTION_CONTEXT_INVALID_OR_RERUN');
  return {enabled,maxReroutes,maxAgeSeconds,...(mutationDeadlineEpochMs===undefined?{}:{mutationDeadlineEpochMs})};
}

function validCabins(v:unknown):v is Cabins{
  if(!v||typeof v!=='object')return false;
  const c=v as Cabins;
  return ['Y','J','F'].every(k=>Number.isSafeInteger(c[k as keyof Cabins])&&c[k as keyof Cabins]>=0);
}

export function routeExecutionCandidates(context:DemandSimulationContext):RouteExecutionCandidate[]{
  const readiness=context.candidateData.routeReadiness.candidates;
  return context.candidateData.candidates.flatMap(c=>{
    const ready=readiness.find(r=>r.aircraftId===c.aircraftId&&r.from===c.from&&r.to===c.to);
    const e=c.routeExecutionEvidence;
    const capacity=c.screening.capacity;
    if(!e||!validCabins(capacity)||!validCabins(e.autoFares)||
      !['Y','J','F'].every(k=>e.autoFares![k as keyof Cabins]>0))return [];
    return [{
      aircraftId:c.aircraftId,from:c.from,to:c.to,airportId:c.airportId,
      comparisonReady:ready?.comparisonReady===true,
      observedAt:e.observedAt,capacity:{...capacity},autoFares:{...e.autoFares},
      costIndex:e.costIndex,distanceKm:e.distanceKm,durationSeconds:e.durationSeconds,
      fuelLbs:e.fuelLbs,co2KgPerPaxKm:e.co2KgPerPaxKm,routeFee:e.routeFee,
      routeMutationControl:c.routeMutationControl
    }];
  });
}

export async function runRouteExecution(
  page:Page,
  context:DemandSimulationContext,
  env:NodeJS.ProcessEnv=process.env,
  directory='test-results/demand'
){
  const settings=routeExecutionSettings(env),optimization=optimizationConfig(env);
  if(settings.enabled&&!optimization.returnJournal)throw new Error('ROUTE_EXECUTION_REQUIRES_PERSISTENT_JOURNAL');
  if(settings.enabled&&settings.mutationDeadlineEpochMs===undefined)throw new Error('ROUTE_EXECUTION_REQUIRES_MUTATION_DEADLINE');
  const blockedAircraftIds=optimization.returnJournal
    ? await readUnresolvedRouteAircraftIds(optimization.returnJournal.directory,optimization.returnJournal.scope)
    : new Set<string>();
  const reviewedTodayAircraftIds=new Set<string>();
  if(optimization.returnJournal){
    const reviewGateNow=new Date();
    const journal=validateReturnJournal(
      JSON.parse(await readFile(join(optimization.returnJournal.directory,'return-journal.json'),'utf8')),
      optimization.returnJournal.scope,reviewGateNow
    );
    for(const aircraft of context.collection.aircraft){
      const origin=resolveAircraftOrigin(aircraft,context.collection,optimization.aircraftOrigins,optimization.airlineBases).origin;
      if(origin&&!dailyReviewDue(aircraft.aircraftId,origin,journal,reviewGateNow,optimization.reviewTimeZone))
        reviewedTodayAircraftIds.add(aircraft.aircraftId);
    }
  }
  await mkdir(directory,{recursive:true});
  const marker=await open(join(directory,'route-execution.started'),'wx');await marker.close();

  const save=async(report:RouteExecutionReport)=>{
    const target=join(directory,'route-execution.json');
    await writeFile(target+'.tmp',JSON.stringify(report,null,2)+'\n');
    await rename(target+'.tmp',target);
    const safe=(s:string)=>s.replace(/[|\r\n<>]/g,' ');
    await writeFile(join(directory,'route-execution.md'),[
      '# Reroute — execucao fail-closed','',
      `Avaliadas: ${report.summary.evaluated}; reroutes: ${report.summary.rerouted}; retidas: ${report.summary.held}; resultado incerto: ${report.summary.unknown}.`,'',
      '| Aeronave | Rota anterior | Alvo | Estado | Motivo |',
      '| --- | --- | --- | --- | --- |',
      ...report.entries.map(e=>`| ${safe(e.registration)} | ${safe(e.previousFrom)}–${safe(e.previousTo)} | ${safe(e.targetFrom)}–${safe(e.targetTo)} | ${e.status} | ${safe(e.reason)} |`),
      '',
      'Somente decisoes would_reroute com comparacao conservadora pronta, fingerprint fresco e controle nativo direto verificado podem chegar ao clique.',
      'Cada aeronave e tentada no maximo uma vez. Resultado nao confirmado interrompe os demais reroutes e nunca repete a mutacao.',''
    ].join('\n'));
  };

  const executor=new RouteMutationExecutor(
    new PlaywrightRouteExecutionPort(page),
    {...settings,blockedAircraftIds,reviewedTodayAircraftIds},
    save
  );
  const report=await executor.run(
    context.collection.aircraft,
    context.candidateData.routeDecisions,
    routeExecutionCandidates(context)
  );
  console.log('[RouteExecution] '+JSON.stringify(report.summary));
  if(optimization.returnJournal){
    try{
      const uncertain=await appendUncertainRouteMutations(optimization.returnJournal.directory,optimization.returnJournal.scope,env.GITHUB_RUN_ID||'',report);
      if(uncertain)console.log('[History] Reroutes incertos bloqueados acrescentados: '+uncertain);
      const origins=new Map<string,string>();
      for(const a of context.collection.aircraft){
        const o=resolveAircraftOrigin(a,context.collection,optimization.aircraftOrigins,optimization.airlineBases).origin;
        if(o)origins.set(a.aircraftId,o);
      }
      const added=await appendVerifiedKeepRouteDecisions(optimization.returnJournal.directory,optimization.returnJournal.scope,context.candidateData.routeDecisions,context.candidateData.candidates,context.collection.aircraft,origins,optimization.reviewTimeZone);
      if(added)console.log('[History] Revisoes KEEP verificadas acrescentadas: '+added);
      const reroutes=await appendConfirmedRerouteReviews(optimization.returnJournal.directory,optimization.returnJournal.scope,context.candidateData.routeDecisions,context.candidateData.candidates,context.collection.aircraft,origins,report,optimization.reviewTimeZone);
      if(reroutes)console.log('[History] Revisoes REROUTE confirmadas acrescentadas: '+reroutes);
    }catch{
      if(report.halted)throw new Error('ROUTE_UNKNOWN_QUARANTINE_PERSIST_FAILED_NO_RETRY');
      throw new Error('ROUTE_HISTORY_PERSIST_FAILED');
    }
  }
  if(report.halted)throw new Error('ROUTE_EXECUTION_HALTED_UNKNOWN_RESULT_NO_RETRY');
  return report;
}
