import { Page } from '@playwright/test';
import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TicketPricingExecutor, PricingExecutionReport } from './executor';
import { PlaywrightPricingPort } from './playwright-port';
import { optimizationConfig } from '../optimization/report';
import { appendUncertainPricingMutations, readUnresolvedPricingRouteIds } from '../optimization/return-journal';

export interface PricingRunSettings {
  enabled:boolean;
  maxAdjustments:number;
  maxAgeSeconds:number;
  mutationDeadlineEpochMs?:number;
}

export function pricingExecutionSettings(env:NodeJS.ProcessEnv=process.env):PricingRunSettings{
  const enabled=(env.ENABLE_TICKET_PRICING_EXECUTION||'false').trim().toLowerCase();
  const maxAdjustments=Number((env.TICKET_PRICING_MAX_ADJUSTMENTS_PER_RUN||'5').trim());
  const maxAgeSeconds=Number((env.DEMAND_MAX_AGE_SECONDS||'300').trim());
  const deadlineRaw=(env.TICKET_PRICING_MUTATION_DEADLINE_EPOCH_MS||'').trim();
  const mutationDeadlineEpochMs=deadlineRaw?Number(deadlineRaw):undefined;
  if(!['true','false'].includes(enabled)||!Number.isSafeInteger(maxAdjustments)||maxAdjustments<1||maxAdjustments>20||
    !Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||
    (mutationDeadlineEpochMs!==undefined&&(!Number.isSafeInteger(mutationDeadlineEpochMs)||mutationDeadlineEpochMs<=0)))throw new Error('PRICING_EXECUTION_CONFIG_INVALID');
  if(enabled==='true'&&(env.TICKET_PRICING_EXECUTION_ACK!=='native-route-price-save-v1'||env.GITHUB_ACTIONS!=='true'||
    env.GITHUB_REPOSITORY!=='andreypiekas/Airline-Manager-4'||!/^[1-9]\d*$/.test(env.GITHUB_RUN_ID||'')||
    env.GITHUB_RUN_ATTEMPT!=='1'))throw new Error('PRICING_REAL_EXECUTION_CONTEXT_INVALID_OR_RERUN');
  return {enabled:enabled==='true',maxAdjustments,maxAgeSeconds,...(mutationDeadlineEpochMs===undefined?{}:{mutationDeadlineEpochMs})};
}

export async function runTicketPricingExecution(page:Page,env:NodeJS.ProcessEnv=process.env,directory='test-results/demand'){
  const settings=pricingExecutionSettings(env),optimization=optimizationConfig(env);
  if(settings.enabled&&!optimization.returnJournal)throw new Error('PRICING_EXECUTION_REQUIRES_PERSISTENT_JOURNAL');
  if(settings.enabled&&settings.mutationDeadlineEpochMs===undefined)throw new Error('PRICING_EXECUTION_REQUIRES_MUTATION_DEADLINE');
  const blockedRouteIds=optimization.returnJournal
    ? await readUnresolvedPricingRouteIds(optimization.returnJournal.directory,optimization.returnJournal.scope)
    : new Set<string>();
  await mkdir(directory,{recursive:true});
  const marker=await open(join(directory,'pricing-execution.started'),'wx');await marker.close();
  const safe=(s:string)=>s.replace(/[|\r\n<>]/g,' ');
  const save=async(report:PricingExecutionReport)=>{
    const target=join(directory,'pricing-execution.json');
    await writeFile(target+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(target+'.tmp',target);
    await writeFile(join(directory,'pricing-execution.md'),[
      '# Tarifas — execucao verificada por rota','',
      `Avaliadas: ${report.summary.evaluated}; ajustadas: ${report.summary.adjusted}; inalteradas: ${report.summary.unchanged}; retidas: ${report.summary.held}; resultado incerto: ${report.summary.unknown}.`,
      report.phaseHoldReason?`Fase retida com seguranca: ${safe(report.phaseHoldReason)}.`:'','',
      '| Aeronave | Route ID | Estado | Antes Y/J/F | Alvo Y/J/F | Depois Y/J/F | Motivo |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...report.entries.map(e=>`| ${safe(e.registration)} | ${e.routeId} | ${e.status} | ${e.before?Object.values(e.before).join('/'):'—'} | ${e.desired?Object.values(e.desired).join('/'):'—'} | ${e.after?Object.values(e.after).join('/'):'—'} | ${safe(e.reason)} |`),'',
      'Somente o controle nativo Save com endpoint set_ticket_prices.php e alvo confirmado como routeId e aceito.',
      'Cada rota e tentada no maximo uma vez por run. Resultado nao confirmado interrompe novas alteracoes e nunca e repetido na mesma execucao.',''
    ].join('\n'));
  };
  const report=await new TicketPricingExecutor(new PlaywrightPricingPort(page),{...settings,blockedRouteIds},save).run();
  console.log('[TicketPricing] '+JSON.stringify({...report.summary,phaseHoldReason:report.phaseHoldReason}));
  if(optimization.returnJournal){
    try{
      const uncertain=await appendUncertainPricingMutations(optimization.returnJournal.directory,optimization.returnJournal.scope,env.GITHUB_RUN_ID||'',report);
      if(uncertain)console.log('[History] Pricings incertos bloqueados acrescentados: '+uncertain);
    }catch{
      if(report.halted)throw new Error('PRICING_UNKNOWN_QUARANTINE_PERSIST_FAILED_NO_RETRY');
      throw new Error('PRICING_HISTORY_PERSIST_FAILED');
    }
  }
  if(report.halted)throw new Error('PRICING_EXECUTION_HALTED_UNKNOWN_RESULT_NO_RETRY');
  return report;
}
