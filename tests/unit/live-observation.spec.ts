import { test, expect } from '@playwright/test';
import { AircraftSnapshot } from '../../demand/types';
import { DemandManager } from '../../demand/manager';
import { readDemandConfig } from '../../demand/config';
import { automaticFaresFromControl, planTicketPrices } from '../../pricing/ticket-pricing';
import { analyzeOptimization, optimizationConfig } from '../../optimization/report';

// Values transcribed from read-only browser inspection on 2026-09-30.
// This is an offline regression, not a live game test or a complete fleet collection.
const now = new Date('2026-09-30T11:50:00Z');
function observed(): AircraftSnapshot {
  return {
    aircraftId: '22316469', registration: 'BC-605', routeId: '33272938',
    routeLabel: 'GRU - XAP', from: 'XAP', to: 'GRU', state: 'ready',
    capacity: { Y: 12, J: 0, F: 0 }, remaining: { Y: 495, J: 474, F: 72 },
    dailyTotal: { Y: 529, J: 474, F: 72 }, observedAt: now.toISOString(),
    fares: { automatic: automaticFaresFromControl("playSound('neutral_click');ticketPriceSuggest(469,1157,2096,this,383);"),
      current: null, source: 'inspected-auto-control' },
  };
}
test('observed VIP demand and automatic reference remain simulation-only', () => {
  const a = observed();
  const collection = { aircraft: [a], complete: true, expectedRoutes: 1, warnings: [] };
  const demand = new DemandManager(readDemandConfig({})).analyze(collection, now).decisions[0];
  expect(demand).toMatchObject({ decision: 'would_depart', possiblePassengers: { Y: 12, J: 0, F: 0 },
    occupancyPercentage: 100, departureAuthorized: false });
  const prices = planTicketPrices(a, true, now);
  expect(prices).toMatchObject({ automatic: { Y: 845, J: 2083, F: 3773 },
    proposed: { Y: 920, J: null, F: null }, status: 'recommendation_only', mutationAuthorized: false });
  // Owner explicitly confirmed this aircraft's origin as GRU.
  const optimization = analyzeOptimization(collection, optimizationConfig({}), {}, now);
  expect(optimization.aircraft[0].operationalOrigin).toBe('GRU');
  expect(optimization.aircraft[0].route.decision).toBe('unavailable');
});
test('observed spare J/F demand cannot replace depleted Y demand on the VIP layout', () => {
  const a = observed(); a.remaining!.Y = 0;
  const result = new DemandManager(readDemandConfig({})).analyze({ aircraft: [a], complete: true, expectedRoutes: 1, warnings: [] }, now);
  expect(result.decisions[0]).toMatchObject({ decision: 'hold_insufficient', occupancyPercentage: 0, departureAuthorized: false });
});
