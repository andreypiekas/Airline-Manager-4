import { Cabins, CLASSES, CollectionResult } from '../demand/types';
import type { DemandLabelCalibrationReport } from './demand-label-calibration';
import type { LiveAnchoredFlightHistoryStitchDiagnostic } from './return-journal';

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
const lifetimeHistoryCovered=(a:CollectionResult['aircraft'][number],visibleEntries:number,boundaryMinutes:number)=>{
  const op=a.operational;
  if(!op||!Number.isSafeInteger(op.cycles)||op.cycles<0||!Number.isFinite(op.deliveredAgeMinutes)||op.deliveredAgeMinutes!<0||op.deliveredAgeMinutes!>boundaryMinutes)return false;
  // Live fleet evidence shows an inflight aircraft's current cycle is not yet in
  // the completed-flight history. Accept exactly that one-cycle gap only when
  // the current onboard manifest is independently observed; never generalize it.
  if(a.state==='inflight')return op.cycles===visibleEntries+1&&valid(a.onboard);
  return a.state==='ready'&&op.cycles===visibleEntries;
};


interface EffectiveHistoryRow {
  from:string;to:string;onboard:Cabins;ageLowerMinutes:number;ageUpperMinutes:number;
}
interface EffectiveHistory {
  rows:EffectiveHistoryRow[];
  stitched:boolean;
}
function stitchedHistoryForAircraft(
  a:CollectionResult['aircraft'][number],
  stitches:readonly LiveAnchoredFlightHistoryStitchDiagnostic[]
):EffectiveHistory|null{
  const matches=stitches.filter(s=>s.aircraftId===a.aircraftId);
  if(matches.length!==1)return null;
  const s=matches[0],h=a.flightHistory,cycles=a.operational?.cycles;
  if(s.status!=='verified_chain'||s.liveAnchorVerified!==true||s.registration!==a.registration||
    !h||h.status!=='observed'||s.currentObservedAt!==h.observedAt||s.latestObservedAt!==h.observedAt||
    s.currentCycles!==cycles||s.latestCycles!==cycles||!Number.isSafeInteger(cycles)||cycles!<0||
    !Array.isArray(s.rows)||!s.rows.length)return null;
  const rows:EffectiveHistoryRow[]=[];
  for(const r of s.rows){
    if(!/^[A-Z0-9]{3}$/.test(r.from)||!/^[A-Z0-9]{3}$/.test(r.to)||r.from===r.to||!valid(r.onboard)||
      !Number.isFinite(r.ageLowerMinutes)||!Number.isFinite(r.ageUpperMinutes)||r.ageLowerMinutes<0||
      r.ageUpperMinutes<r.ageLowerMinutes)return null;
    rows.push({from:r.from,to:r.to,onboard:{...r.onboard},ageLowerMinutes:r.ageLowerMinutes,ageUpperMinutes:r.ageUpperMinutes});
  }
  const oldestLower=Math.max(...rows.map(r=>r.ageLowerMinutes));
  if(!Number.isFinite(s.oldestAgeLowerMinutes)||Math.abs(oldestLower-s.oldestAgeLowerMinutes!)>1e-9)return null;
  return {rows,stitched:true};
}
function effectiveHistory(
  a:CollectionResult['aircraft'][number],
  stitches:readonly LiveAnchoredFlightHistoryStitchDiagnostic[]
):EffectiveHistory|null{
  const stitched=stitchedHistoryForAircraft(a,stitches);
  if(stitched)return stitched;
  const h=a.flightHistory;
  if(!h||h.status!=='observed')return null;
  const rows:EffectiveHistoryRow[]=[];
  for(const e of h.entries){
    const age=relativeAgeIntervalMinutes(e.relativeTime);
    if(age===null||!valid(e.onboard))return null;
    rows.push({from:e.from,to:e.to,onboard:{...e.onboard},ageLowerMinutes:age.lower,ageUpperMinutes:age.upper});
  }
  return {rows,stitched:false};
}

export function relativeAgeMinutes(text:string):number|null{
  const s=text.trim().toLowerCase();
  let m=s.match(/^(\d+) (?:seconds?|secs?) ago$/); if(m)return Number(m[1])/60;
  m=s.match(/^(\d+) (?:minutes?|mins?) ago$/); if(m)return Number(m[1]);
  m=s.match(/^(\d+) (?:hours?|hrs?) ago$/); if(m)return Number(m[1])*60;
  m=s.match(/^(\d+) days? ago$/); if(m)return Number(m[1])*1440;
  if(s==='a second ago'||s==='1 second ago')return 1/60;
  if(s==='a minute ago'||s==='1 minute ago')return 1;
  if(s==='an hour ago'||s==='1 hour ago')return 60;
  if(s==='a day ago'||s==='1 day ago')return 1440;
  return null;
}

/**
 * UI relative ages are coarse labels, not timestamps. Preserve the complete
 * bucket so reset inference cannot treat "6 hours ago" as exactly 360 minutes.
 */
export function relativeAgeIntervalMinutes(text:string):{lower:number;upper:number}|null{
  const s=text.trim().toLowerCase();
  let m=s.match(/^(\d+) (?:seconds?|secs?) ago$/);
  if(m){const n=Number(m[1]);return {lower:n/60,upper:(n+1)/60};}
  m=s.match(/^(\d+) (?:minutes?|mins?) ago$/);
  if(m){const n=Number(m[1]);return {lower:n,upper:n+1};}
  m=s.match(/^(\d+) (?:hours?|hrs?) ago$/);
  if(m){const n=Number(m[1]);return {lower:n*60,upper:(n+1)*60};}
  m=s.match(/^(\d+) days? ago$/);
  if(m){const n=Number(m[1]);return {lower:n*1440,upper:(n+1)*1440};}
  if(s==='a second ago'||s==='1 second ago')return {lower:1/60,upper:2/60};
  if(s==='a minute ago'||s==='1 minute ago')return {lower:1,upper:2};
  if(s==='an hour ago'||s==='1 hour ago')return {lower:60,upper:120};
  if(s==='a day ago'||s==='1 day ago')return {lower:1440,upper:2880};
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
        const age=relativeAgeIntervalMinutes(h.relativeTime);return age===null?[]:[age];
      });
      if(sameDirection.length){
        // No consumption means reset is newer than the newest same-direction
        // flight. Its bucket upper edge is the safe reset-age upper bound.
        const newestUpper=Math.min(...sameDirection.map(x=>x.upper));
        if(Number.isFinite(newestUpper)&&newestUpper>0)base.upperBoundSources.push({
          aircraftId:sample.aircraftId,routeId:sample.routeId,from:sample.from,to:sample.to,newestSameDirectionFlightAgeMinutes:newestUpper
        });
      }
    }
    const entries=collection.aircraft.flatMap(a=>(a.flightHistory?.status==='observed'?a.flightHistory.entries:[])
      .filter(h=>key(h.from,h.to)===pairKey)
      .flatMap(h=>{
        const age=relativeAgeIntervalMinutes(h.relativeTime);
        return age===null||!valid(h.onboard)?[]:[{lower:age.lower,upper:age.upper,onboard:h.onboard,aircraftId:a.aircraftId}];
      }));
    if(!entries.length)continue;
    const bucketLowers=[...new Set(entries.map(e=>e.lower))].sort((a,b)=>a-b);
    let running=zero(),matchedLower:number|null=null;
    for(const lower of bucketLowers){
      for(const e of entries.filter(x=>x.lower===lower))running=add(running,e.onboard);
      if(eq(running,consumed)){matchedLower=lower;break;}
      if(CLASSES.some(k=>running[k]>consumed[k]))break;
    }
    if(matchedLower===null)continue;
    const olderLower=bucketLowers.find(x=>x>matchedLower);
    if(olderLower===undefined)continue;
    const olderEntries=entries.filter(x=>x.lower===olderLower);
    const excludedUpper=Math.max(...olderEntries.map(x=>x.upper));
    if(!Number.isFinite(excludedUpper)||excludedUpper<=matchedLower)continue;
    const sourceAircraftIds=[...new Set(entries.filter(e=>e.lower<=matchedLower).map(e=>e.aircraftId))].sort();
    // The matched bucket proves only a lower bound on reset age; the first
    // excluded bucket proves only an upper bound. Everything between remains
    // ambiguous and historicalRemainingForCandidate already rejects pair
    // flights crossing that gap.
    base.windows.push({pairKey,includedMaxAgeMinutes:matchedLower,excludedMinAgeMinutes:excludedUpper,consumed,observedAt:sample.observedAt,sourceAircraftIds});
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

export function fleetHistoryCoverageDiagnostics(
  collection:CollectionResult,
  calibration:DemandResetCalibration,
  stitches:readonly LiveAnchoredFlightHistoryStitchDiagnostic[]=[]
){
  const requiredExcludedMin=calibration.windows.length?Math.min(...calibration.windows.map(w=>w.excludedMinAgeMinutes)):calibration.resetAgeUpperBoundMinutes;
  return collection.aircraft.map(a=>{
    const history=effectiveHistory(a,stitches);
    const oldestAgeMinutes=history?.rows.length?Math.max(...history.rows.map(r=>r.ageLowerMinutes)):null;
    const visibleEntries=a.flightHistory?.status==='observed'?a.flightHistory.entries.length:0;
    const lifetimeCovered=requiredExcludedMin!==null&&a.flightHistory?.status==='observed'?lifetimeHistoryCovered(a,visibleEntries,requiredExcludedMin):false;
    const coversReset=requiredExcludedMin!==null&&!!history&&(lifetimeCovered||(oldestAgeMinutes!==null&&oldestAgeMinutes>=requiredExcludedMin));
    return {aircraftId:a.aircraftId,registration:a.registration,state:a.state,cycles:a.operational?.cycles??null,
      historyStatus:a.flightHistory?.status??'unavailable',visibleEntries,oldestAgeMinutes,requiredExcludedMin,lifetimeCovered,coversReset};
  });
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
  from:string,to:string,dailyTotal:Cabins,collection:CollectionResult,calibration:DemandResetCalibration,
  stitches:readonly LiveAnchoredFlightHistoryStitchDiagnostic[]=[]
):HistoricalRemainingEvidence{
  const pairKey=key(from,to);
  const base:HistoricalRemainingEvidence={status:'unavailable',pairKey,dailyTotal:{...dailyTotal},consumedSinceReset:null,remaining:null,
    historyCoverageVerified:false,resetWindow:null,reason:'RESET_LEDGER_UNAVAILABLE',comparisonReady:false,mutationAuthorized:false};
  if(!collection.complete||!valid(dailyTotal)||from===to)return base;
  const windows=calibration.windows;
  let upperBoundFailure:string|null=null;
  if(calibration.resetAgeUpperBoundMinutes!==null){
    const upper=calibration.resetAgeUpperBoundMinutes;
    if(Number.isFinite(upper)&&upper>0){
      let covered=true,pairInside=false,unparseable=false,missing=false;
      for(const a of collection.aircraft){
        const history=effectiveHistory(a,stitches);
        if(!history){missing=true;covered=false;continue;}
        if(history.rows.some(x=>!Number.isFinite(x.ageLowerMinutes)||!Number.isFinite(x.ageUpperMinutes))){unparseable=true;covered=false;continue;}
        const visibleEntries=a.flightHistory?.status==='observed'?a.flightHistory.entries.length:0;
        const lifetimeCovered=a.flightHistory?.status==='observed'&&lifetimeHistoryCovered(a,visibleEntries,upper);
        const oldest=history.rows.length?Math.max(...history.rows.map(x=>x.ageLowerMinutes)):null;
        if(!lifetimeCovered&&(oldest===null||oldest<upper))covered=false;
        if(history.rows.some(x=>x.ageLowerMinutes<upper&&key(x.from,x.to)===pairKey&&CLASSES.some(k=>x.onboard[k]>0)))
          pairInside=true;
      }
      if(covered&&!pairInside)return {...base,status:'verified',consumedSinceReset:zero(),remaining:{...dailyTotal},historyCoverageVerified:true,
        reason:'NO_PAIR_FLIGHT_WITHIN_VERIFIED_RESET_UPPER_BOUND'};
      upperBoundFailure=missing?'FLEET_HISTORY_MISSING':unparseable?'HISTORY_AGE_UNPARSEABLE':
        pairInside?'PAIR_FLIGHT_INSIDE_RESET_UPPER_BOUND':'FLEET_HISTORY_DOES_NOT_COVER_RESET_UPPER_BOUND';
    }
  }
  if(!windows.length)return {...base,reason:upperBoundFailure||base.reason};
  // Every calibrated pair bounds the SAME airline-wide reset instant. Exact
  // excluded buckets may differ simply because each route has different flight
  // spacing. Intersect all verified intervals conservatively instead of
  // requiring byte-identical boundaries.
  const included=Math.max(...windows.map(w=>w.includedMaxAgeMinutes));
  const excluded=Math.min(...windows.map(w=>w.excludedMinAgeMinutes));
  if(!Number.isFinite(included)||!Number.isFinite(excluded)||included<0||excluded<=included)
    return {...base,reason:'RESET_WINDOW_GLOBAL_INTERSECTION_EMPTY'};
  const window:DemandResetWindow={
    pairKey:'GLOBAL',
    includedMaxAgeMinutes:included,
    excludedMinAgeMinutes:excluded,
    consumed:zero(),
    observedAt:windows.map(w=>w.observedAt).sort().at(-1)||new Date(0).toISOString(),
    sourceAircraftIds:[...new Set(windows.flatMap(w=>w.sourceAircraftIds))].sort()
  };
  let consumed=zero();
  for(const a of collection.aircraft){
    const history=effectiveHistory(a,stitches);
    if(!history)return {...base,resetWindow:window,reason:'FLEET_HISTORY_MISSING'};
    const visibleEntries=a.flightHistory?.status==='observed'?a.flightHistory.entries.length:0;
    const lifetimeCovered=a.flightHistory?.status==='observed'&&lifetimeHistoryCovered(a,visibleEntries,excluded);
    const oldest=history.rows.length?Math.max(...history.rows.map(x=>x.ageLowerMinutes)):null;
    if(!lifetimeCovered&&(oldest===null||oldest<excluded))return {...base,resetWindow:window,reason:'FLEET_HISTORY_DOES_NOT_COVER_RESET'};
    if(history.rows.some(x=>key(x.from,x.to)===pairKey&&x.ageUpperMinutes>included&&x.ageLowerMinutes<excluded))
      return {...base,resetWindow:window,reason:'PAIR_FLIGHT_IN_RESET_BOUNDARY_GAP'};
    for(const x of history.rows){
      if(x.ageUpperMinutes<=included&&key(x.from,x.to)===pairKey){
        if(!valid(x.onboard))return {...base,resetWindow:window,reason:'HISTORY_ONBOARD_INVALID'};
        consumed=add(consumed,x.onboard);
      }
    }
  }
  if(CLASSES.some(k=>consumed[k]>dailyTotal[k]))return {...base,resetWindow:window,reason:'HISTORICAL_CONSUMPTION_EXCEEDS_DAILY_TOTAL'};
  const remaining:Cabins={Y:dailyTotal.Y-consumed.Y,J:dailyTotal.J-consumed.J,F:dailyTotal.F-consumed.F};
  return {...base,status:'verified',consumedSinceReset:consumed,remaining,historyCoverageVerified:true,resetWindow:window,
    reason:'FLEET_HISTORY_COVERS_GLOBAL_RESET_WINDOW_INTERSECTION'};
}
