import { Cabins, CLASSES, CollectionResult } from '../demand/types';
import { candidateDemandEvidence } from './candidate-evidence';
import { CandidateQuote } from './quote-reader';
import type { DemandResetCalibration } from './demand-reset-ledger';
import type { LiveAnchoredFlightHistoryStitchDiagnostic } from './return-journal';

export interface ReservationConfig {
  nextLegs: number;
  poolScope: 'airport-pair' | 'directional';
  maxAgeSeconds: number;
}
export function reservationConfig(env: NodeJS.ProcessEnv = process.env): ReservationConfig {
  const nextLegs = Number(env.ROUTE_RESERVATION_NEXT_LEGS?.trim() || '2');
  const poolScope = env.ROUTE_RESERVATION_POOL_SCOPE?.trim() || 'airport-pair';
  const maxAgeSeconds = Number(env.DEMAND_MAX_AGE_SECONDS?.trim() || '300');
  if (!Number.isSafeInteger(nextLegs) || nextLegs < 1 || nextLegs > 20 ||
      !['airport-pair', 'directional'].includes(poolScope) ||
      !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) throw new Error('RESERVATION_CONFIG_INVALID');
  return { nextLegs, poolScope: poolScope as ReservationConfig['poolScope'], maxAgeSeconds };
}
const cabins = (c: Cabins | null): c is Cabins => !!c && CLASSES.every(k => Number.isSafeInteger(c[k]) && c[k] >= 0) &&
  Number.isSafeInteger(c.Y + c.J + c.F);
const map = (fn: (k: typeof CLASSES[number]) => number): Cabins => ({Y:fn('Y'),J:fn('J'),F:fn('F')});

/** A bounded planning scenario, NOT game reservations or a confirmed future schedule.
 * Each alternative gets its own ledger. Already boarded passengers are never debited again.
 */
export function candidateReservationScenario(quote: CandidateQuote, collection: CollectionResult,
  now = new Date(), config = reservationConfig(), resetCalibration: DemandResetCalibration | null = null,
  stitches: readonly LiveAnchoredFlightHistoryStitchDiagnostic[] = []) {
  // Validate injected settings too; this function performs no navigation or mutations.
  if(!Number.isSafeInteger(config.nextLegs)||config.nextLegs<1||config.nextLegs>20||
    !['airport-pair','directional'].includes(config.poolScope)||!Number.isSafeInteger(config.maxAgeSeconds)||config.maxAgeSeconds<1)
    throw new Error('RESERVATION_CONFIG_INVALID');
  const result = { status:'unavailable', config, scope:'bounded-next-legs' as const,
    currentFlightPassengersAlreadyDebited:true, futureScheduleComplete:false, futureCompetitionComplete:false, demandNetOfOtherAircraft:false,
    comparisonReady:false, mutationAuthorized:false, reservations:[] as {
      aircraftId:string; leg:number; from:string; to:string; poolKey:string; capacity:Cabins; claimed:Cabins|null;
      notBeforeEstimatedAt:string|null;availabilitySource:'observed-ready'|'flight-countdown-estimate'|'unavailable';
    }[], forwardAfterReservations:null as Cabins|null, reverseAfterReservations:null as Cabins|null,
    reason:'' };
  const fresh = (s:string) => {const age=now.getTime()-Date.parse(s);return Number.isFinite(age)&&age>=0&&age<=config.maxAgeSeconds*1000;};
  const own = collection.aircraft.filter(a=>a.aircraftId===quote.aircraftId);
  if (!collection.complete || collection.expectedRoutes !== collection.aircraft.length || own.length !== 1 ||
      own[0].registration !== quote.registration || own[0].state !== 'ready' || own[0].from !== quote.from ||
      !fresh(quote.observedAt) || new Set(collection.aircraft.map(a=>a.aircraftId)).size !== collection.aircraft.length ||
      new Set(collection.aircraft.map(a=>a.routeId)).size !== collection.aircraft.length ||
      collection.aircraft.some(a=>a.issue || !/^\d+$/.test(a.aircraftId) || !/^\d+$/.test(a.routeId) ||
        !/^[A-Z0-9]{3}$/.test(a.from) || !/^[A-Z0-9]{3}$/.test(a.to) || a.from===a.to ||
        !['ready','inflight'].includes(a.state) || !a.operational || !fresh(a.observedAt) || !cabins(a.capacity) ||
        a.capacity.Y+a.capacity.J+a.capacity.F<=0)) return {...result,reason:'FLEET_RESERVATIONS_UNVERIFIED'};
  const evidence = candidateDemandEvidence(quote,collection,now,config.maxAgeSeconds,resetCalibration,stitches);
  const key = (from:string,to:string) => (config.poolScope==='airport-pair'?[from,to].sort():[from,to]).join(':');
  const forwardKey=key(quote.from,quote.to), reverseKey=key(quote.to,quote.from);
  const pools = new Map<string,Cabins>();
  // A reverse-only reading never supplies forward remaining demand, even in the conservative pair scenario.
  if (evidence.remaining) pools.set(forwardKey,{...evidence.remaining});
  if (evidence.reverseRemaining) {
    const current=pools.get(reverseKey);
    pools.set(reverseKey,map(k=>Math.min(current?.[k]??evidence.reverseRemaining![k],evidence.reverseRemaining![k])));
  }
  const others=collection.aircraft.filter(a=>a.aircraftId!==quote.aircraftId).sort((a,b)=>a.aircraftId.localeCompare(b.aircraftId));
  for (const aircraft of others) {
    const timing=aircraft.timing;
    const validTiming=aircraft.state==='inflight'&&!!timing&&timing.source==='inspected-flight-countdown'&&
      timing.aircraftId===aircraft.aircraftId&&timing.routeId===aircraft.routeId&&fresh(timing.observedAt)&&
      Number.isSafeInteger(timing.remainingSeconds)&&timing.remainingSeconds>0&&
      Date.parse(timing.arrivalEstimatedAt)===Date.parse(timing.observedAt)+timing.remainingSeconds*1000&&
      Date.parse(timing.arrivalEstimatedAt)>now.getTime();
    // For an airborne aircraft reserve the next leg AFTER landing, not its ongoing flight.
    let from=aircraft.state==='inflight'?aircraft.to:aircraft.from;
    let to=aircraft.state==='inflight'?aircraft.from:aircraft.to;
    for(let leg=1;leg<=config.nextLegs;leg++) {
      const poolKey=key(from,to);
      if (poolKey===forwardKey || poolKey===reverseKey) {
        const available=pools.get(poolKey);
        const claimed=available?map(k=>Math.min(available[k],aircraft.capacity![k])):null;
        result.reservations.push({aircraftId:aircraft.aircraftId,leg,from,to,poolKey,capacity:{...aircraft.capacity!},claimed,
          notBeforeEstimatedAt:leg!==1?null:aircraft.state==='ready'?now.toISOString():validTiming?timing!.arrivalEstimatedAt:null,
          availabilitySource:leg!==1?'unavailable':aircraft.state==='ready'?'observed-ready':validTiming?'flight-countdown-estimate':'unavailable'});
        if (claimed) pools.set(poolKey,map(k=>available![k]-claimed[k]));
      }
      [from,to]=[to,from];
    }
  }
  result.forwardAfterReservations=evidence.remaining?{...pools.get(forwardKey)!}:null;
  result.reverseAfterReservations=evidence.reverseRemaining||config.poolScope==='airport-pair'&&evidence.remaining?
    {...pools.get(reverseKey)!}:null;
  if(evidence.remaining){
    // For the candidate's single outbound+return cycle, every other aircraft has
    // exactly two deterministic legs on its CURRENT route (ready: current leg then
    // reverse; inflight: reverse after landing then current). Reserving matching
    // capacity unconditionally is conservative: it assumes those flights consume
    // demand before the candidate even when timing would place them later. No
    // demand reset is credited. This closes only the bounded competition horizon;
    // it is not a general timetable forecast and never authorizes mutation.
    result.futureCompetitionComplete=true;
    result.demandNetOfOtherAircraft=true;
    result.status='scenario_only';
    result.reason='BOUNDED_TWO_LEG_COMPETITION_CONSERVATIVELY_RESERVED';
  } else {
    result.status='remaining_unavailable';
    result.reason=evidence.reason;
  }
  return result;
}
