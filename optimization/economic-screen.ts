import { Cabins, CLASSES } from '../demand/types';
import { adjustedPaxFare } from '../pricing/ticket-pricing';
import { CandidateQuote } from './quote-reader';

export interface CandidateEconomicScreen {
  status: 'screened' | 'unavailable';
  demandStatus: 'cannot_meet_threshold' | 'potentially_sufficient' | 'unavailable';
  minCoveragePercent: number;
  capacity: Cabins | null;
  dailyDemandCeiling: Cabins | null;
  passengerCeiling: Cabins | null;
  coverageCeilingPercent: number | null;
  adjustedFareReference: Cabins | null;
  grossRevenueCeilingPerDeparture: number | null;
  firstDepartureAfterSetupFeeCeiling: number | null;
  reason: string;
  comparisonReady: false;
  mutationAuthorized: false;
}

const validCabins = (value: Cabins | null | undefined): value is Cabins =>
  !!value && CLASSES.every(k => Number.isSafeInteger(value[k]) && value[k] >= 0);

const VIP_MODEL_IDS = new Set([371, 383, 384]);

/**
 * Safe pre-screening only.
 * Daily demand is treated strictly as a ceiling, never as remaining demand.
 * It can prove that a route cannot reach the configured seat-coverage threshold,
 * but it cannot by itself authorize a reroute.
 */
export function screenCandidateEconomics(
  quote: CandidateQuote,
  capacity: Cabins | null,
  minCoveragePercent = 80,
  now = new Date(),
  maxAgeSeconds = 300
): CandidateEconomicScreen {
  const base: CandidateEconomicScreen = {
    status: 'unavailable',
    demandStatus: 'unavailable',
    minCoveragePercent,
    capacity: capacity && validCabins(capacity) ? { ...capacity } : null,
    dailyDemandCeiling: null,
    passengerCeiling: null,
    coverageCeilingPercent: null,
    adjustedFareReference: null,
    grossRevenueCeilingPerDeparture: null,
    firstDepartureAfterSetupFeeCeiling: null,
    reason: '',
    comparisonReady: false,
    mutationAuthorized: false,
  };

  const age = now.getTime() - Date.parse(quote.observedAt);
  if (!Number.isFinite(minCoveragePercent) || minCoveragePercent <= 0 || minCoveragePercent > 100 ||
      !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0 ||
      !Number.isFinite(age) || age < 0 || age > maxAgeSeconds * 1000 ||
      !validCabins(capacity) || !validCabins(quote.dailyDemand) ||
      !Number.isFinite(quote.routeFee) || quote.routeFee < 0) {
    return { ...base, reason: 'SCREENING_CONTEXT_UNAVAILABLE' };
  }

  const seats = CLASSES.reduce((sum, k) => sum + capacity[k], 0);
  if (!Number.isSafeInteger(seats) || seats <= 0) {
    return { ...base, reason: 'INVALID_CAPACITY' };
  }

  const passengerCeiling = {
    Y: Math.min(capacity.Y, quote.dailyDemand.Y),
    J: Math.min(capacity.J, quote.dailyDemand.J),
    F: Math.min(capacity.F, quote.dailyDemand.F),
  };
  const covered = CLASSES.reduce((sum, k) => sum + passengerCeiling[k], 0);
  const coverage = 100 * covered / seats;
  const demandStatus = coverage < minCoveragePercent ? 'cannot_meet_threshold' : 'potentially_sufficient';

  let adjustedFareReference: Cabins | null = null;
  let grossRevenueCeilingPerDeparture: number | null = null;
  let firstDepartureAfterSetupFeeCeiling: number | null = null;

  const auto = quote.autopriceReference;
  const effectiveBase=auto
    ? (validCabins(auto.effectiveFares)?auto.effectiveFares:!VIP_MODEL_IDS.has(auto.modelId)&&validCabins(auto.base)?auto.base:null)
    : null;
  if (effectiveBase) {
    try {
      adjustedFareReference = {
        Y: capacity.Y > 0 ? adjustedPaxFare(effectiveBase.Y, 'Y') : 0,
        J: capacity.J > 0 ? adjustedPaxFare(effectiveBase.J, 'J') : 0,
        F: capacity.F > 0 ? adjustedPaxFare(effectiveBase.F, 'F') : 0,
      };
      grossRevenueCeilingPerDeparture = CLASSES.reduce(
        (sum, k) => sum + passengerCeiling[k] * adjustedFareReference![k], 0
      );
      firstDepartureAfterSetupFeeCeiling = grossRevenueCeilingPerDeparture - quote.routeFee;
    } catch {
      adjustedFareReference = null;
      grossRevenueCeilingPerDeparture = null;
      firstDepartureAfterSetupFeeCeiling = null;
    }
  }

  return {
    ...base,
    status: 'screened',
    demandStatus,
    dailyDemandCeiling: { ...quote.dailyDemand },
    passengerCeiling,
    coverageCeilingPercent: coverage,
    adjustedFareReference,
    grossRevenueCeilingPerDeparture,
    firstDepartureAfterSetupFeeCeiling,
    reason: demandStatus === 'cannot_meet_threshold'
      ? 'DAILY_DEMAND_CEILING_BELOW_MINIMUM_COVERAGE'
      : 'DAILY_DEMAND_CAN_REACH_THRESHOLD_BUT_REMAINING_DEMAND_AND_FULL_ECONOMICS_ARE_STILL_REQUIRED',
  };
}
