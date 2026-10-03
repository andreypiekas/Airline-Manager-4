import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateReturnJournal} from '../optimization/return-journal';
import type { Journal } from '../optimization/return-journal';

export interface AdaptiveThreshold { percentage:number; source:'verified-departure-history'; samples:number }
const key=(aircraftId:string,routeId:string)=>aircraftId+':'+routeId;
/** Conservative only: history may raise the configured floor, never lower it. */
export function adaptiveDemandThresholds(journal:Journal,basePercentage:number,minSamples=5,maxPercentage=90):ReadonlyMap<string,AdaptiveThreshold>{
 if(!Number.isFinite(basePercentage)||basePercentage<=0||basePercentage>100||!Number.isSafeInteger(minSamples)||minSamples<2||!Number.isFinite(maxPercentage)||maxPercentage<basePercentage||maxPercentage>100)throw new Error('ADAPTIVE_DEMAND_CONFIG_INVALID');
 const groups=new Map<string,number[]>();
 for(const e of journal.events||[]){
  if(e.type!=='departure'||e.result!=='departed'||!Number.isFinite(e.demand.occupancyPercentage))continue;
  const k=key(e.aircraftId,e.routeId),a=groups.get(k)||[];a.push(e.demand.occupancyPercentage);groups.set(k,a);
 }
 const out=new Map<string,AdaptiveThreshold>();
 for(const [k,samples] of groups){
  if(samples.length<minSamples)continue;
  const verifiedFloor=Math.floor(Math.min(...samples));
  const percentage=Math.min(maxPercentage,Math.max(basePercentage,verifiedFloor));
  if(percentage>basePercentage)out.set(k,{percentage,source:'verified-departure-history',samples:samples.length});
 }
 return out;
}
export const adaptiveDemandKey=key;

export async function loadAdaptiveDemandThresholds(directory:string,scope:string,basePercentage:number,now=new Date()):Promise<ReadonlyMap<string,AdaptiveThreshold>>{
 const journal=validateReturnJournal(JSON.parse(await readFile(join(directory,'return-journal.json'),'utf8')),scope,now);
 return adaptiveDemandThresholds(journal,basePercentage);
}
