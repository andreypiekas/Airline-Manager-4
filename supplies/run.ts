import {Page} from '@playwright/test';
import {mkdir,open,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {readDemandConfig} from '../demand/config';
import {executionEnvironment} from '../demand/execute-run';
import {Commodity,planPurchase,supplyConfig} from './policy';
import {SupplyPort} from './port';
export async function runSupplies(page:Page,dryRun:boolean,env:NodeJS.ProcessEnv=process.env,directory='test-results/demand',port=new SupplyPort(page)){
 const config=supplyConfig(env);
 if(!dryRun)executionEnvironment({...readDemandConfig(env),dryRun:false},env);
 await mkdir(directory,{recursive:true});
 if(!dryRun){const marker=await open(join(directory,'supplies.started'),'wx');await marker.close();}
 const report:{dryRun:boolean;enabled:boolean;entries:any[];halted:boolean}={dryRun,enabled:config.enabled,entries:[],halted:false};
 const save=async()=>{
  const file=join(directory,'supply-report.json');await writeFile(file+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(file+'.tmp',file);
  await writeFile(join(directory,'supply-report.md'),['# Combustivel e CO2','',`Simulacao: ${dryRun}; habilitado: ${config.enabled}.`,'',
   '| Recurso | Preco / 1.000 | Teto exclusivo | Quantidade | Resultado |','| --- | --- | --- | --- | --- |',
   ...report.entries.map(e=>`| ${e.kind} | ${e.before?.pricePer1000??'—'} | ${config.maxPrice[e.kind as Commodity]} | ${e.plan?.quantity??0} | ${e.status}: ${e.reason} |`),''].join('\n'));
 };
 await save();if(!config.enabled)return report;
 try {
  for(const kind of ['fuel','co2'] as const){
   const entry:any={kind,status:'reading',reason:'PENDING',before:null,plan:null};report.entries.push(entry);await save();
   await port.open(kind);entry.before=await port.snapshot(kind);entry.plan=planPurchase(entry.before,kind,config);
   if(entry.plan.reason==='INVALID_DATA')throw Error('SUPPLY_DATA_INVALID');
   if(!entry.plan.quantity){entry.status='skipped';entry.reason=entry.plan.reason;await save();continue;}
   entry.quotedCost=await port.quote(kind,entry.plan.quantity);
   const fresh=await port.snapshot(kind);
   if(JSON.stringify(fresh)!==JSON.stringify(entry.before)||entry.quotedCost<=0||entry.quotedCost>entry.plan.budget||
     entry.quotedCost>entry.plan.estimatedCost||Math.abs(entry.quotedCost-entry.before.pricePer1000*entry.plan.quantity/1000)>=1)throw Error('SUPPLY_QUOTE_CHANGED_OR_OVER_BUDGET');
   entry.reason='PRICE_AND_BUDGET_ACCEPTED';
   if(dryRun){entry.status='would_buy';await save();continue;}
   entry.status='attempting';await save();
   entry.after=await port.purchase(kind,entry.plan.quantity,entry.before,entry.quotedCost);
   entry.status='purchased';entry.reason='STOCK_AND_PAYMENT_CONFIRMED';await save();
  }
  await port.close();
 }catch(error){
  const raw=error instanceof Error?error.message:'UNCLASSIFIED';
  const code=/^[A-Z0-9_:-]{1,120}$/.test(raw)?raw:'UNCLASSIFIED';
  const entry=report.entries.at(-1);if(entry){
   entry.reason=entry.status==='attempting'?'OUTCOME_UNKNOWN_NO_RETRY:'+code:'READ_OR_VALIDATION_FAILED:'+code;
   entry.status=entry.status==='attempting'?'unknown':'unavailable';
  }
  report.halted=true;await save();throw Error('SUPPLY_HALTED_SEE_REPORT_NO_RETRY:'+code);
 }
 console.log('[Supplies] '+JSON.stringify(report.entries.map(({kind,status,reason})=>({kind,status,reason}))));
 return report;
}
