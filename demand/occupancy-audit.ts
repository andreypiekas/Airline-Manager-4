import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cabins, CLASSES, CollectionResult, DemandConfig } from './types';
const valid = (v: Cabins | null | undefined): v is Cabins => !!v && CLASSES.every(k => Number.isSafeInteger(v[k]) && v[k] >= 0);
/** Observed load in flight, not a forecast at proposed prices or a departure authorization. */
export function occupancyAudit(collection: CollectionResult, config: Pick<DemandConfig,'minPercentage'|'maxAgeSeconds'>, now = new Date()) {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(config.minPercentage) || config.minPercentage <= 0 || config.minPercentage > 100 || !Number.isFinite(config.maxAgeSeconds) || config.maxAgeSeconds <= 0) throw new Error('OCCUPANCY_CONFIG_INVALID');
  const counts = new Map<string,number>();
  collection.aircraft.forEach(a => counts.set(a.aircraftId,(counts.get(a.aircraftId)||0)+1));
  const aircraft = collection.aircraft.filter(a => a.state === 'inflight').map(a => {
    const age = now.getTime()-Date.parse(a.observedAt);
    const base = {aircraftId:a.aircraftId,routeId:a.routeId,from:a.from,to:a.to,onboard:valid(a.onboard)?a.onboard:null,capacity:valid(a.capacity)?a.capacity:null,occupancyPercentage:null as number|null,mutationAuthorized:false};
    if (!collection.complete || counts.get(a.aircraftId)!==1 || a.issue || !Number.isFinite(age) || age<0 || age>config.maxAgeSeconds*1000 || !valid(a.onboard) || !valid(a.capacity) || CLASSES.some(k => a.onboard![k]>a.capacity![k]) || CLASSES.reduce((n,k)=>n+a.capacity![k],0)===0) return {...base,status:'unavailable',reason:'Coleta, identidade, capacidade ou passageiros nao confirmados.'};
    const passengers=CLASSES.reduce((n,k)=>n+a.onboard![k],0);
    const occupancyPercentage=100*passengers/CLASSES.reduce((n,k)=>n+a.capacity![k],0);
    return {...base,occupancyPercentage,status:passengers===0?'empty':occupancyPercentage<config.minPercentage?'low':'sufficient',reason:passengers===0?'Interface informa voo sem passageiros.':occupancyPercentage<config.minPercentage?'Ocupacao observada abaixo do limite configurado.':'Ocupacao observada atende ao limite.'};
  });
  return {schemaVersion:1,generatedAt:now.toISOString(),dryRun:true,mutationAuthorized:false,collectionComplete:collection.complete,thresholdPercentage:config.minPercentage,summary:{evaluated:aircraft.length,empty:aircraft.filter(a=>a.status==='empty').length,low:aircraft.filter(a=>a.status==='low').length,sufficient:aircraft.filter(a=>a.status==='sufficient').length,unavailable:aircraft.filter(a=>a.status==='unavailable').length},aircraft};
}
export async function writeOccupancyAudit(collection: CollectionResult, config: Pick<DemandConfig,'minPercentage'|'maxAgeSeconds'>, directory='test-results/demand') {
  const report=occupancyAudit(collection,config);
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'occupancy-audit.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
