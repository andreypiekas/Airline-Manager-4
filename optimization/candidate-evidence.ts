import { Cabins, CLASSES, CollectionResult } from '../demand/types';
import { CandidateQuote } from './quote-reader';
import { DemandResetCalibration, historicalRemainingForCandidate } from './demand-reset-ledger';
import type { LiveAnchoredFlightHistoryStitchDiagnostic } from './return-journal';

/** Observations are not reservations, forecasts, or a complete economic review. */
export function candidateDemandEvidence(quote: CandidateQuote, collection: CollectionResult, now = new Date(), maxAgeSeconds = 300,
  resetCalibration: DemandResetCalibration | null = null,
  stitches: readonly LiveAnchoredFlightHistoryStitchDiagnostic[] = []) {
  const result = {status:'unavailable',remaining:null as Cabins|null,reverseRemaining:null as Cabins|null,
    sources:[] as {aircraftId:string;routeId:string;from:string;to:string;observedAt:string;remaining:Cabins}[],
    demandNetOfOtherAircraft:false,comparisonReady:false,reason:''};
  const fresh = (timestamp:string) => {const age=now.getTime()-Date.parse(timestamp);return Number.isFinite(age)&&age>=0&&age<=maxAgeSeconds*1000;};
  if (!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<1||!collection.complete||!fresh(quote.observedAt)||
    !/^[A-Z0-9]{3}$/.test(quote.from)||!/^[A-Z0-9]{3}$/.test(quote.to)||quote.from===quote.to) {
    return {...result,reason:'COLLECTION_OR_QUOTE_UNVERIFIED'};
  }
  const matches=collection.aircraft.filter(a=>a.from===quote.from&&a.to===quote.to||a.from===quote.to&&a.to===quote.from);
  if(!matches.length){
    const historical=resetCalibration?historicalRemainingForCandidate(quote.from,quote.to,quote.dailyDemand,collection,resetCalibration,stitches):null;
    if(historical?.status==='verified'&&historical.remaining){
      return {...result,status:'historical_pair_reconstructed',remaining:{...historical.remaining},reverseRemaining:{...historical.remaining},
        reason:'HISTORICAL_PAIR_LEDGER_VERIFIED',historical};
    }
    return {...result,reason:historical?.reason||'NO_EXISTING_ROUTE_OBSERVATION',historical};
  }
  if(new Set(matches.map(a=>a.aircraftId)).size!==matches.length||new Set(matches.map(a=>a.routeId)).size!==matches.length||
    matches.some(a=>!/^\d+$/.test(a.aircraftId)||!/^\d+$/.test(a.routeId)||a.issue||!a.capacity||!a.operational||
      !['ready','inflight'].includes(a.state)||!fresh(a.observedAt)||!a.remaining||!a.dailyTotal||
      CLASSES.some(k=>!Number.isSafeInteger(a.capacity![k])||a.capacity![k]<0||!Number.isSafeInteger(a.remaining![k])||a.remaining![k]<0||
        !Number.isSafeInteger(a.dailyTotal![k])||a.dailyTotal![k]<0||a.remaining![k]>a.dailyTotal![k]))) {
    return {...result,reason:'MATCHING_ROUTE_DATA_INVALID'};
  }
  result.sources=matches.map(a=>({aircraftId:a.aircraftId,routeId:a.routeId,from:a.from,to:a.to,observedAt:a.observedAt,remaining:{...a.remaining!}}));
  const minimum=(from:string)=>{
    const group=result.sources.filter(s=>s.from===from);
    return group.length?{Y:Math.min(...group.map(s=>s.remaining.Y)),J:Math.min(...group.map(s=>s.remaining.J)),F:Math.min(...group.map(s=>s.remaining.F))}:null;
  };
  result.remaining=minimum(quote.from); result.reverseRemaining=minimum(quote.to);
  if(!result.remaining&&result.reverseRemaining&&resetCalibration){
    const historical=historicalRemainingForCandidate(quote.from,quote.to,quote.dailyDemand,collection,resetCalibration,stitches);
    if(historical?.status==='verified'&&historical.remaining){
      // A reverse live reading is an independent conservative upper bound on
      // the pair reconstruction. Never let history claim more than the live
      // opposite direction already exposes.
      const bounded:Cabins={
        Y:Math.min(historical.remaining.Y,result.reverseRemaining.Y),
        J:Math.min(historical.remaining.J,result.reverseRemaining.J),
        F:Math.min(historical.remaining.F,result.reverseRemaining.F)
      };
      return {...result,status:'historical_pair_reconstructed_reverse_observed',remaining:{...bounded},reverseRemaining:{...bounded},
        reason:'HISTORICAL_PAIR_LEDGER_VERIFIED_WITH_REVERSE_LIVE_BOUND',historical};
    }
  }
  result.status=result.remaining?'direction_observed':'reverse_direction_only';
  result.reason=result.remaining?'OBSERVED_BEFORE_FUTURE_RESERVATIONS':'REVERSE_DIRECTION_SHARING_UNCONFIRMED';
  return result;
}
