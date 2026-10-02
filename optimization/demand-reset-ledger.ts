import { Cabins, CLASSES, CollectionResult } from '../demand/types';
import type { DemandLabelCalibrationReport } from './demand-label-calibration';

export interface DemandResetWindow {
  pairKey:string;
  includedMaxAgeMinutes:number;
  excludedMinAgeMinutes:number;
  consumed:Cabins;
  observedAt:string;
  sourceAircraftIds:string[];
}
export interface DemandResetCalibration {
  status:'verified'|'upper_bound_only'|'unavailable';
  windows:DemandResetWindow[];
  resetAgeUpperBoundMinutes:number|null;
  upperBoundSources:Array<{aircraftId:string;routeId:string;from:string;to:string;newestSameDirectionFlightAgeMinutes:number}>;
  warnings:string[];
  comparisonReady:false;
  mutationAuthorized:false;
}

const key=(a:string,b:string)=>[a,b].sort().join(':');
const zero=():Cabins=>({Y:0,J:0,F:0});
const add=(a:Cabins,b:Cabins):Cabins=>({Y:a.Y+b.Y,J:a.J+b.J,F:a.F+b.F});
const eq=(a:Cabins,b:Cabins)=>CLASSES.every(k=>a[k]===b[k]);
const valid=(c:Cabins|null|undefined):c is Cabins=>!!c&&CLASSES.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0);

export function relativeAgeMinutes(text:string):number|null{
  const s=text.trim().toLowerCase();
  let m=s.match(/^(\d+) minutes? ago$/); if(m)return Number(m[1]);
  m=s.match(/^(\d+) hours? ago$/); if(m)return Number(m[1])*60;
  m=s.match(/^(\d+) days? ago$/); if(m)return Number(m[1])*1440;
  if(s==='a minute ago'||s==='1 minute ago')return 1;
  if(s==='an hour ago'||s==='1 hour ago')return 60;
  if(s==='a day ago'||s==='1 day ago')return 1440;
  return null;
}

/**
 * Calibrates a pair-shared reset boundary from a current route where the live
 * daily-total label and the current remaining demand are both observed.
 * The exact consumed cabins must match a whole prefix of visible flight-history
 * age buckets, and an older bucket must exist beyond the boundary.
 */
export function calibrateDemandResetWindows(
  collection:CollectionResult,
  labels:DemandLabelCalibrationReport
):DemandResetCalibration{
  const base:DemandResetCalibration={status:'unavailable',windows:[],resetAgeUpperBoundMinutes:null,upperBoundSources:[],warnings:[],comparisonReady:false,mutationAuthorized:false};
  if(!collection.complete||labels.status!=='observed')return base;
  for(const sample of labels.samples){
    if(!valid(sample.dailyTotal)||!valid(sample.remaining)||CLASSES.some(k=>sample.remaining[k]>sample.dailyTotal[k]))continue;
    const consumed:Cabins={Y:sample.dailyTotal.Y-sample.remaining.Y,J:sample.dailyTotal.J-sample.remaining.J,F:sample.dailyTotal.F-sample.remaining.F};
    const pairKey=key(sample.from,sample.to);
    const current=collection.aircraft.find(a=>a.aircraftId===sample.aircraftId&&a.routeId===sample.routeId);
    if(sample.matchesDailyTotal&&sample.matchesRemaining&&eq(consumed,zero())&&current?.flightHistory?.status==='observed'){
      const sameDirection=current.flightHistory.entries.flatMap(h=>{
        if(h.from!==sample.from||h.to!==sample.to||!valid(h.onboard)||CLASSES.every(k=>h.onboard[k]===0))return [];
        const age=relativeAgeMinutes(h.relativeTime);return age===null?[]:[age];
      });
      if(sameDirection.length){
        const newest=Math.min(...sameDirection);
        if(Number.isFinite(newest)&&newest>0)base.upperBoundSources.push({
          aircraftId:sample.aircraftId,routeId:sample.routeId,from:sample.from,to:sample.to,newestSameDirectionFlightAgeMinutes:newest
        });
      }
    }
    const entries=collection.aircraft.flatMap(a=>(a.flightHistory?.status==='observed'?a.flightHistory.entries:[])
      .filter(h=>key(h.from,h.to)===pairKey)
      .flatMap(h=>{
        const age=relativeAgeMinutes(h.relativeTime);
        return age===null||!valid(h.onboard)?[]:[{age,onboard:h.onboard,aircraftId:a.aircraftId}];
      }));
    if(!entries.length)continue;
    const buckets=[...new Set(entries.map(e=>e.age))].sort((a,b)=>a-b);
    let running=zero(),matched:number|null=null;
    for(const age of buckets){
      for(const e of entries.filter(x=>x.age===age))running=add(running,e.onboard);
      if(eq(running,consumed)){matched=age;break;}
      if(CLASSES.some(k=>running[k]>consumed[k]))break;
    }
    if(matched===null)continue;
    const older=buckets.find(x=>x>matched);
    if(older===undefined)continue;
    const sourceAircraftIds=[...new Set(entries.filter(e=>e.age<=matched).map(e=>e.aircraftId))].sort();
    base.windows.push({pairKey,includedMaxAgeMinutes:matched,excludedMinAgeMinutes:older,consumed,observedAt:sample.observedAt,sourceAircraftIds});
  }
  const unique=new Map<string,DemandResetWindow>();
  for(const w of base.windows){
    const old=unique.get(w.pairKey);
    if(!old)unique.set(w.pairKey,w);
    else if(old.includedMaxAgeMinutes!==w.includedMaxAgeMinutes||old.excludedMinAgeMinutes!==w.excludedMinAgeMinutes||!eq(old.consumed,w.consumed)){
      unique.delete(w.pairKey);base.warnings.push('RESET_WINDOW_CONFLICT:'+w.pairKey);
    }
  }
  base.windows=[...unique.values()];
  if(base.upperBoundSources.length)base.resetAgeUpperBoundMinutes=Math.min(...base.upperBoundSources.map(s=>s.newestSameDirectionFlightAgeMinutes));
  base.status=base.windows.length?'verified':base.resetAgeUpperBoundMinutes!==null?'upper_bound_only':'unavailable';
  return base;
}

export interface HistoricalRemainingEvidence {
  status:'verified'|'unavailable';
  pairKey:string;
  dailyTotal:Cabins;
  consumedSinceReset:Cabins|null;
  remaining:Cabins|null;
  historyCoverageVerified:boolean;
  resetWindow:DemandResetWindow|null;
  reason:string;
  comparisonReady:false;
  mutationAuthorized:false;
}

/**
 * Reconstructs remaining demand for a candidate only when every aircraft's
 * visible history proves coverage beyond the calibrated reset window (or its
 * lifetime cycles fit entirely in the visible history), and no flight falls in
 * the boundary's ambiguous age interval.
 */
export function historicalRemainingForCandidate(
  from:string,to:string,dailyTotal:Cabins,collection:CollectionResult,calibration:DemandResetCalibration
):HistoricalRemainingEvidence{
  const pairKey=key(from,to);
  const base:HistoricalRemainingEvidence={status:'unavailable',pairKey,dailyTotal:{...dailyTotal},consumedSinceReset:null,remaining:null,
    historyCoverageVerified:false,resetWindow:null,reason:'RESET_LEDGER_UNAVAILABLE',comparisonReady:false,mutationAuthorized:false};
  if(!collection.complete||!valid(dailyTotal)||from===to)return base;
  const windows=calibration.windows;
  if(!windows.length&&calibration.resetAgeUpperBoundMinutes!==null){
    const upper=calibration.resetAgeUpperBoundMinutes;
    if(!Number.isSafeInteger(upper)||upper<=0)return base;
    for(const a of collection.aircraft){
      const h=a.flightHistory;
      if(!h||h.status!=='observed')return {...base,reason:'FLEET_HISTORY_MISSING'};
      const parsed=h.entries.map(e=>({entry:e,age:relativeAgeMinutes(e.relativeTime)}));
      if(parsed.some(x=>x.age===null))return {...base,reason:'HISTORY_AGE_UNPARSEABLE'};
      const ages=parsed.map(x=>x.age!);
      const lifetimeCovered=!!a.operational&&Number.isSafeInteger(a.operational.cycles)&&a.operational.cycles<=h.entries.length;
      const oldest=ages.length?Math.max(...ages):null;
      if(!lifetimeCovered&&(oldest===null||oldest<upper))return {...base,reason:'FLEET_HISTORY_DOES_NOT_COVER_RESET_UPPER_BOUND'};
      if(parsed.some(x=>x.age!<upper&&key(x.entry.from,x.entry.to)===pairKey&&valid(x.entry.onboard)&&CLASSES.some(k=>x.entry.onboard[k]>0)))
        return {...base,reason:'PAIR_FLIGHT_INSIDE_RESET_UPPER_BOUND'};
    }
    return {...base,status:'verified',consumedSinceReset:zero(),remaining:{...dailyTotal},historyCoverageVerified:true,
      reason:'NO_PAIR_FLIGHT_WITHIN_VERIFIED_RESET_UPPER_BOUND'};
  }
  if(!windows.length)return base;
  // Reset time is airline-wide; accept it only when all calibrated pairs agree.
  const signatures=[...new Set(windows.map(w=>w.includedMaxAgeMinutes+':'+w.excludedMinAgeMinutes))];
  if(signatures.length!==1)return {...base,reason:'RESET_WINDOW_NOT_GLOBAL'};
  const window=windows[0];
  const included=window.includedMaxAgeMinutes,excluded=window.excludedMinAgeMinutes;
  let consumed=zero();
  for(const a of collection.aircraft){
    const h=a.flightHistory;
    if(!h||h.status!=='observed')return {...base,resetWindow:window,reason:'FLEET_HISTORY_MISSING'};
    const parsed=h.entries.map(e=>({entry:e,age:relativeAgeMinutes(e.relativeTime)}));
    if(parsed.some(x=>x.age===null))return {...base,resetWindow:window,reason:'HISTORY_AGE_UNPARSEABLE'};
    const ages=parsed.map(x=>x.age!) ;
    const lifetimeCovered=!!a.operational&&Number.isSafeInteger(a.operational.cycles)&&a.operational.cycles<=h.entries.length;
    const oldest=ages.length?Math.max(...ages):null;
    if(!lifetimeCovered&&(oldest===null||oldest<excluded))return {...base,resetWindow:window,reason:'FLEET_HISTORY_DOES_NOT_COVER_RESET'};
    if(parsed.some(x=>x.age!>included&&x.age!<excluded&&key(x.entry.from,x.entry.to)===pairKey))
      return {...base,resetWindow:window,reason:'PAIR_FLIGHT_IN_RESET_BOUNDARY_GAP'};
    for(const x of parsed){
      if(x.age!<=included&&key(x.entry.from,x.entry.to)===pairKey){
        if(!valid(x.entry.onboard))return {...base,resetWindow:window,reason:'HISTORY_ONBOARD_INVALID'};
        consumed=add(consumed,x.entry.onboard);
      }
    }
  }
  if(CLASSES.some(k=>consumed[k]>dailyTotal[k]))return {...base,resetWindow:window,reason:'HISTORICAL_CONSUMPTION_EXCEEDS_DAILY_TOTAL'};
  const remaining:Cabins={Y:dailyTotal.Y-consumed.Y,J:dailyTotal.J-consumed.J,F:dailyTotal.F-consumed.F};
  return {...base,status:'verified',consumedSinceReset:consumed,remaining,historyCoverageVerified:true,resetWindow:window,
    reason:'FLEET_HISTORY_COVERS_CALIBRATED_RESET_WINDOW'};
}
