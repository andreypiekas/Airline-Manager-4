import { Page } from '@playwright/test';
import { mkdir,open,rename,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readDemandConfig } from './config';
import { DemandConfig } from './types';
import { IndividualDepartureExecutor, ExecutionReport } from './executor';
import { PlaywrightDeparturePort } from './departure-port';
import { optimizationConfig } from '../optimization/report';

export function executionEnvironment(config:DemandConfig,env:NodeJS.ProcessEnv=process.env){
  const maxDepartures=Number(env.DEMAND_MAX_DEPARTURES_PER_RUN||'1');
  if(!Number.isSafeInteger(maxDepartures)||maxDepartures<1||maxDepartures>20)throw Error('DEMAND_EXECUTION_LIMIT_INVALID');
  if(!config.enabled||!config.failSafe)throw Error('DEMAND_EXECUTION_DISABLED');
  if(!config.dryRun&&(config.poolScope!=='airport-pair'||env.DEMAND_EXECUTION_ACK!=='individual-return-legs-v1'||env.GITHUB_ACTIONS!=='true'||
    env.GITHUB_REPOSITORY!=='andreypiekas/Airline-Manager-4'||!/^[1-9]\d*$/.test(env.GITHUB_RUN_ID||'')||
    env.GITHUB_RUN_ATTEMPT!=='1'))throw Error('DEMAND_REAL_EXECUTION_CONTEXT_INVALID_OR_RERUN');
  return {dryRun:config.dryRun,maxDepartures};
}
export async function runDemandExecution(page:Page,config=readDemandConfig(),env:NodeJS.ProcessEnv=process.env,directory='test-results/demand'){
  const settings=executionEnvironment(config,env),optimization=optimizationConfig(env);
  await mkdir(directory,{recursive:true});
  // Exclusive marker survives repeated calls in this runner; Actions rejects every real rerun attempt.
  const marker=await open(join(directory,'individual-execution.started'),'wx');await marker.close();
  const safe=(s:string)=>s.replace(/[|\r\n<>]/g,' ');
  const save=async(report:ExecutionReport)=>{
    const target=join(directory,'execution-report.json');
    await writeFile(target+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(target+'.tmp',target);
    await writeFile(join(directory,'execution-report.md'),[
      `# Decolagens individuais — ${report.dryRun?'simulacao':'execucao real'}`,'',
      `Escopo: retorno para a propria base pela rota existente. Avaliadas: ${report.summary.evaluated}; decolagens confirmadas: ${report.summary.departed}; simuladas: ${report.summary.simulated}; retidas: ${report.summary.held}; resultado incerto: ${report.summary.unknown}.`,'',
      '| Aeronave | Trecho | Estado | Motivo |','| --- | --- | --- | --- |',
      ...report.entries.map(e=>`| ${safe(e.registration)} | ${safe(e.from)} → ${safe(e.to)} | ${e.status} | ${safe(e.reason)} |`),'',
      'A cobertura por demanda nao e previsao de ocupacao. Embarque observado consta no JSON apos a decolagem.',
      'Na propria base, revisao incompleta de candidatas/custos mantem a aeronave em solo. Rotas, tarifas e compras continuam sem alteracoes.',''
    ].join('\n'));
  };
  const report=await new IndividualDepartureExecutor(new PlaywrightDeparturePort(page),config,{...settings,
    aircraftOrigins:optimization.aircraftOrigins,airlineBases:optimization.airlineBases},save).run();
  console.log('[IndividualDepartures] '+JSON.stringify(report.summary));
  if(report.halted)throw Error('DEMAND_EXECUTION_HALTED_UNKNOWN_RESULT_NO_RETRY');
  return report;
}
