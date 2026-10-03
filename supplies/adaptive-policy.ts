import type { Journal } from '../optimization/return-journal';
import type { Commodity } from './policy';
export interface AdaptiveSupplyCap { configuredMax:number; effectiveMax:number; source:'configured-cap'|'verified-live-history'; samples:number; historicalReference:number|null }
/** Verified history can only make purchases stricter; it can never raise the configured ceiling. */
export function adaptiveSupplyCap(journal:Journal,kind:Commodity,configuredMax:number,minSamples=5,minFraction=0.8):AdaptiveSupplyCap{
 if(!Number.isSafeInteger(configuredMax)||configuredMax<1||!Number.isSafeInteger(minSamples)||minSamples<2||!Number.isFinite(minFraction)||minFraction<=0||minFraction>1)throw new Error('ADAPTIVE_SUPPLY_CONFIG_INVALID');
 const prices=(journal.supplyObservations||[]).filter(x=>x.kind===kind).map(x=>x.pricePer1000).filter(x=>Number.isSafeInteger(x)&&x>0).sort((a,b)=>a-b);
 if(prices.length<minSamples)return{configuredMax,effectiveMax:configuredMax,source:'configured-cap',samples:prices.length,historicalReference:null};
 const index=Math.floor((prices.length-1)*0.4),reference=prices[index];
 const lower=Math.ceil(configuredMax*minFraction),effectiveMax=Math.min(configuredMax,Math.max(lower,reference+1));
 return{configuredMax,effectiveMax,source:'verified-live-history',samples:prices.length,historicalReference:reference};
}
