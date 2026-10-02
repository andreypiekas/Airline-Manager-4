import { Cabins, CLASSES } from '../demand/types';
import { CandidateQuote } from './quote-reader';
import { airportDistanceEvidence, AirportCatalog, AirportDistanceEvidence, RouteCatalog } from './reference-data';
import type { ReverseLegEquivalentEvidence } from './reverse-leg-equivalence';

export interface RoundTripReservationEvidence {
  forwardAfterReservations: Cabins | null;
  reverseAfterReservations: Cabins | null;
  futureScheduleComplete: boolean;
  /** All other aircraft's bounded next legs were conservatively debited without relying on exact times. */
  futureCompetitionComplete?: boolean;
}

export interface CandidateRoundTripScreen {
  status: 'partial' | 'structural_only' | 'unavailable';
  from: string;
  to: string;
  outbound: {
    distanceKm: number;
    durationSeconds: number;
    remainingAfterReservations: Cabins | null;
  };
  returnLeg: {
    from: string;
    to: string;
    routeDistanceReferenceKm: number | null;
    remainingAfterReservations: Cabins | null;
    liveQuoteAvailable: false;
    equivalentQuoteAvailable: boolean;
    equivalentQuoteSource: string | null;
  };
  routeReference: null | {
    source: string;
    sourceRow: number;
    storedDirection: string;
    referenceDemand: Cabins;
    distanceKm: number;
    distanceDeltaKm: number;
  };
  distanceReference: AirportDistanceEvidence | null;
  blockers: string[];
  comparisonReady: false;
  mutationAuthorized: false;
}

const validCabins = (value: Cabins | null): value is Cabins =>
  !!value && CLASSES.every(k => Number.isSafeInteger(value[k]) && value[k] >= 0);

/**
 * Builds a conservative two-leg evidence envelope.
 * The outbound leg is the live quote. The reverse leg is never fabricated:
 * only route-level catalogue distance and independently observed remaining demand
 * may be attached. A real reverse quote (fares/time/fuel/CO2) is still mandatory.
 */
export function buildCandidateRoundTripScreen(
  quote: CandidateQuote,
  catalog: RouteCatalog | null,
  reservations: RoundTripReservationEvidence,
  now = new Date(),
  maxAgeSeconds = 300,
  airportCatalog: AirportCatalog | null = null,
  reverseEquivalent: ReverseLegEquivalentEvidence | null = null
): CandidateRoundTripScreen {
  const result: CandidateRoundTripScreen = {
    status: 'unavailable',
    from: quote.from,
    to: quote.to,
    outbound: {
      distanceKm: quote.distanceKm,
      durationSeconds: quote.durationSeconds,
      remainingAfterReservations: validCabins(reservations.forwardAfterReservations)
        ? { ...reservations.forwardAfterReservations }
        : null,
    },
    returnLeg: {
      from: quote.to,
      to: quote.from,
      routeDistanceReferenceKm: null,
      remainingAfterReservations: validCabins(reservations.reverseAfterReservations)
        ? { ...reservations.reverseAfterReservations }
        : null,
      liveQuoteAvailable: false,
      equivalentQuoteAvailable: false,
      equivalentQuoteSource: null,
    },
    routeReference: null,
    distanceReference: null,
    blockers: [],
    comparisonReady: false,
    mutationAuthorized: false,
  };

  const age = now.getTime() - Date.parse(quote.observedAt);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0 ||
      !Number.isFinite(age) || age < 0 || age > maxAgeSeconds * 1000 ||
      !/^[A-Z0-9]{3}$/.test(quote.from) || !/^[A-Z0-9]{3}$/.test(quote.to) ||
      quote.from === quote.to || !Number.isFinite(quote.distanceKm) || quote.distanceKm <= 0 ||
      !Number.isFinite(quote.durationSeconds) || quote.durationSeconds <= 0) {
    return { ...result, blockers: ['OUTBOUND_QUOTE_UNVERIFIED'] };
  }

  const references = catalog?.schemaVersion === 1 && Array.isArray(catalog.routes)
    ? catalog.routes.filter(r =>
        !r.conflict &&
        ((r.from === quote.from && r.to === quote.to) || (r.from === quote.to && r.to === quote.from)) &&
        Number.isFinite(r.distanceKm) && r.distanceKm > 0 &&
        validCabins(r.referenceDemand))
    : [];

  if (references.length === 1) {
    const ref = references[0];
    result.returnLeg.routeDistanceReferenceKm = ref.distanceKm;
    result.routeReference = {
      source: catalog!.source,
      sourceRow: ref.sourceRow,
      storedDirection: `${ref.from}-${ref.to}`,
      referenceDemand: { ...ref.referenceDemand },
      distanceKm: ref.distanceKm,
      distanceDeltaKm: Math.abs(ref.distanceKm - quote.distanceKm),
    };
  } else if (references.length > 1) {
    result.blockers.push('AMBIGUOUS_ROUTE_REFERENCE');
  } else {
    const distance=airportDistanceEvidence(quote.from,quote.to,airportCatalog,quote.distanceKm,quote.airportId);
    result.distanceReference=distance;
    if(distance.status==='cross_checked'&&distance.distanceKm!==null){
      result.returnLeg.routeDistanceReferenceKm=distance.distanceKm;
    } else {
      result.blockers.push('ROUTE_REFERENCE_UNAVAILABLE');
    }
  }

  if (!result.outbound.remainingAfterReservations) result.blockers.push('OUTBOUND_REMAINING_DEMAND_UNAVAILABLE');
  if (!result.returnLeg.remainingAfterReservations) result.blockers.push('RETURN_REMAINING_DEMAND_UNAVAILABLE');
  if (!reservations.futureScheduleComplete && reservations.futureCompetitionComplete !== true)
    result.blockers.push('FUTURE_COMPETITION_COVERAGE_INCOMPLETE');

  // A real reverse quote is preferred, but a separately cross-checked direct-route
  // symmetry proof may replace only the direction-invariant quote fields. Demand,
  // load and effective costs remain independent requirements.
  const equivalent=reverseEquivalent?.status==='verified'&&reverseEquivalent.from===quote.to&&reverseEquivalent.to===quote.from&&
    reverseEquivalent.distanceKm===quote.distanceKm&&reverseEquivalent.durationSeconds===quote.durationSeconds&&
    reverseEquivalent.fuelLbs===quote.fuelLbs&&reverseEquivalent.co2KgPerPaxKm===quote.co2KgPerPaxKm;
  result.returnLeg.equivalentQuoteAvailable=equivalent;
  result.returnLeg.equivalentQuoteSource=equivalent?reverseEquivalent!.source:null;
  if(!equivalent){
    result.blockers.push(
      'RETURN_LIVE_QUOTE_REQUIRED',
      'RETURN_EFFECTIVE_FARES_REQUIRED',
      'RETURN_DURATION_REQUIRED',
      'RETURN_FUEL_REQUIRED',
      'RETURN_CO2_REQUIRED'
    );
  }
  result.blockers.push('RETURN_EFFECTIVE_COSTS_REQUIRED');

  const structural=!!result.routeReference||result.distanceReference?.status==='cross_checked';
  result.status = structural && result.returnLeg.remainingAfterReservations
    ? 'partial'
    : structural
      ? 'structural_only'
      : 'unavailable';

  return result;
}
