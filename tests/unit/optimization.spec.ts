import { readAircraftOrigins } from '../../optimization/aircraft-origins';
import { test, expect } from '@playwright/test';
import { adjustedPaxFare, automaticFaresFromControl, planTicketPrices } from '../../pricing/ticket-pricing';
import { RouteOptimizer, RouteReview, RouteCandidate, confirmedBaseReturn } from '../../optimization/route-optimizer';
import { analyzeOptimization, optimizationConfig } from '../../optimization/report';
import { AircraftSnapshot } from '../../demand/types';
const now = new Date('2026-09-29T19:00:00Z');
const older = '2026-09-29T18:00:00Z';
const fare = { Y: 1234, J: 3456, F: 17890 };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function aircraft(): AircraftSnapshot {
  return { aircraftId: '1', registration: 'TEST', routeId: 'current', routeLabel: 'AAA-BBB', from: 'AAA', to: 'BBB', state: 'ready',
    capacity: { Y: 100, J: 10, F: 10 }, remaining: { Y: 1000, J: 100, F: 100 }, dailyTotal: { Y: 1000, J: 100, F: 100 }, observedAt: now.toISOString(),
    fares: { automatic: fare, current: fare, source: 'inspected-auto-control' } };
}
function candidate(id = 'current', price = 1000): RouteCandidate {
  const out = { from: 'AAA', to: 'BBB', distanceKm: 1000, durationHours: 2, originRunwayFt: 10000, destinationRunwayFt: 10000,
    demandPool: 'AAA-BBB', remaining: { Y: 1000, J: 100, F: 100 }, automaticFares: { Y: price, J: price * 2, F: price * 3 },
    expectedLoadFactor: { Y: 1, J: 1, F: 1 }, costs: { fuel: 1000, co2: 100, maintenance: 100, airportAndOther: 100 } };
  return { id, observedAt: now.toISOString(), setupCost: 0, demandNetOfOtherAircraft: true, legs: [clone(out), { ...clone(out), from: 'BBB', to: 'AAA' }] };
}
function review(): RouteReview {
  return { position: { aircraftId: '1', homeBase: 'AAA', airport: 'AAA', state: 'landed', flightId: 'flight-1', destination: null, observedAt: now.toISOString() },
    previousPosition: { aircraftId: '1', homeBase: 'AAA', airport: null, state: 'inflight', flightId: 'flight-1', destination: 'AAA', observedAt: older },
    capacity: { Y: 100, J: 10, F: 10 }, rangeKm: 5000, minRunwayFt: 5000, enforceRunway: true, currentRouteId: 'current', candidates: [candidate(), candidate('better', 2000)], candidatesComplete: true };
}
test('all user examples round down in tens exactly', () => {
  expect(adjustedPaxFare(1234, 'Y')).toBe(1350); expect(adjustedPaxFare(3456, 'J')).toBe(3730); expect(adjustedPaxFare(17890, 'F')).toBe(18960);
});
test('integer boundary does not lose a ten due to float rounding', () => {
  expect(adjustedPaxFare(1000, 'Y')).toBe(1100); expect(adjustedPaxFare(1000, 'J')).toBe(1080); expect(adjustedPaxFare(1000, 'F')).toBe(1060);
});
for (const value of [NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER, 1]) test(`invalid automatic fare ${value}`, () => expect(() => adjustedPaxFare(value, 'Y')).toThrow());
test('pricing never compounds prior markup and does not change empty classes', () => {
  const a = aircraft(); a.capacity!.J = 0; a.capacity!.F = 0;
  const first = planTicketPrices(a, true, now); expect(first.proposed).toEqual({ Y: 1350, J: null, F: null });
  a.fares!.current = { Y: 1350, J: 0, F: 0 };
  const second = planTicketPrices(a, true, now); expect(second.status).toBe('unchanged'); expect(second.proposed?.Y).toBe(1350); expect(second.mutationAuthorized).toBe(false);
});
test('unknown current prices produce recommendation only', () => {
  const a = aircraft(); a.fares!.current = null; expect(planTicketPrices(a, true, now).status).toBe('recommendation_only');
});
test('missing or stale automatic reference produces no proposal', () => {
  const a = aircraft(); delete a.fares; expect(planTicketPrices(a, true, now).proposed).toBeNull();
  const stale = aircraft(); stale.observedAt = older; expect(planTicketPrices(stale, true, now).proposed).toBeNull();
});
test('strict Auto callback parser, including inspected VIP factor', () => {
  expect(automaticFaresFromControl("playSound('neutral_click');ticketPriceSuggest(974,2167,3610,this,291);")).toEqual({ Y: 974, J: 2167, F: 3610 });
  expect(automaticFaresFromControl('ticketPriceSuggest(101,201,301,this,371);')).toEqual({ Y: 182, J: 362, F: 542 });
  expect(() => automaticFaresFromControl('otherFunction(1,2,3)')).toThrow();
  expect(() => automaticFaresFromControl('ticketPriceSuggest(1,2,3,this,291);evil()')).toThrow();
});
test('return requires a real transition for same aircraft and flight, at own base', () => {
  const r = review(); expect(confirmedBaseReturn(r.previousPosition, r.position)).toBe('1:flight-1:AAA');
  expect(confirmedBaseReturn(null, r.position)).toBeNull();
  expect(confirmedBaseReturn(r.previousPosition, { ...r.position, airport: 'BBB' })).toBeNull();
  expect(confirmedBaseReturn(r.previousPosition, { ...r.position, flightId: 'different' })).toBeNull();
  expect(confirmedBaseReturn(r.previousPosition, { ...r.position, observedAt: older })).toBeNull();
});
test('best estimate selects route and includes adjusted fares in revenue', () => {
  const r = new RouteOptimizer().review(review(), now);
  expect(r.decision).toBe('would_reroute'); expect(r.selectedRouteId).toBe('better'); expect(r.mutationAuthorized).toBe(false);
  // Y=1100*100, J=2160*10, F=3180*10 per leg, minus 1300 costs per leg.
  expect(r.scores[0].netProfit).toBe(324200);
});
test('route with higher revenue can lose on profit per hour', () => {
  const input = review(); input.candidates[1].legs.forEach(l => l.durationHours = 10);
  expect(new RouteOptimizer().review(input, now).decision).toBe('keep_route');
});
test('route change cost can outweigh revenue improvement', () => {
  const input = review(); input.candidates[1].setupCost = 1000000;
  expect(new RouteOptimizer().review(input, now).decision).toBe('keep_route');
});
test('ties preserve current route even if listed after alternative', () => {
  const input = review(); input.candidates = [candidate('other'), candidate()];
  expect(new RouteOptimizer().review(input, now).selectedRouteId).toBe('current');
});
test('minimum improvement threshold prevents unnecessary swaps', () => {
  expect(new RouteOptimizer(80, 200).review(review(), now).decision).toBe('keep_route');
});
test('does not consider an aircraft away from home or already flying', () => {
  const input = review(); input.position.airport = 'BBB'; expect(new RouteOptimizer().review(input, now).decision).toBe('not_at_base_return');
  input.position.airport = 'AAA'; input.position.state = 'inflight'; expect(new RouteOptimizer().review(input, now).decision).toBe('not_at_base_return');
});
test('reviews once per return; next flight return is a new event', () => {
  const optimizer = new RouteOptimizer(), input = review();
  optimizer.review(input, now); expect(optimizer.review(input, now).decision).toBe('already_reviewed');
  input.position.flightId = 'flight-2'; input.previousPosition!.flightId = 'flight-2'; expect(optimizer.review(input, now).decision).toBe('would_reroute');
  input.lastReviewedArrival = '1:flight-2:AAA'; expect(new RouteOptimizer().review(input, now).decision).toBe('already_reviewed');
});
test('outbound and return reserve the same demand once', () => {
  const input = review(); input.candidates.forEach(c => c.legs.forEach(l => l.remaining = { Y: 100, J: 10, F: 10 }));
  const r = new RouteOptimizer().review(input, now); expect(r.decision).toBe('hold'); expect(r.scores[0].occupancyPercentages).toEqual([100, 0]);
});
test('expected load factor must pass in each leg', () => {
  const input = review(); input.candidates.forEach(c => c.legs[1].expectedLoadFactor = { Y: 0.5, J: 0.5, F: 0.5 });
  expect(new RouteOptimizer().review(input, now).decision).toBe('hold');
});
test('range and runway constraints disqualify a candidate; runway can be explicitly ignored by mode', () => {
  const input = review(); input.candidates[1].legs[0].distanceKm = 6000;
  expect(new RouteOptimizer().review(input, now).decision).toBe('keep_route');
  input.candidates[1].legs[0].distanceKm = 1000; input.candidates[1].legs[0].destinationRunwayFt = 3000;
  expect(new RouteOptimizer().review(input, now).decision).toBe('keep_route');
  input.enforceRunway = false; expect(new RouteOptimizer().review(input, now).decision).toBe('would_reroute');
});
for (const [name, mutate] of [
  ['incomplete', (r: RouteReview) => r.candidatesComplete = false],
  ['missing current', (r: RouteReview) => r.candidates.shift()],
  ['unreserved', (r: RouteReview) => r.candidates[1].demandNetOfOtherAircraft = false],
  ['stale quote', (r: RouteReview) => r.candidates[1].observedAt = older],
  ['stale position', (r: RouteReview) => r.position.observedAt = older],
  ['unknown cost', (r: RouteReview) => r.candidates[1].legs[0].costs.fuel = NaN],
  ['missing costs', (r: RouteReview) => (r.candidates[1].legs[0] as any).costs = undefined],
  ['duplicates', (r: RouteReview) => r.candidates.push(candidate())],
  ['wrong return', (r: RouteReview) => r.candidates[1].legs[1].to = 'CCC'],
] as const) test(`blocks unreliable comparisons: ${name}`, () => {
  const input = review(); mutate(input); expect(new RouteOptimizer().review(input, now).decision).toBe('unavailable');
});
test('unavailable data does not consume arrival review; retry can succeed', () => {
  const optimizer = new RouteOptimizer(), input = review(); input.candidatesComplete = false;
  expect(optimizer.review(input, now).decision).toBe('unavailable'); input.candidatesComplete = true;
  expect(optimizer.review(input, now).decision).toBe('would_reroute');
});
test('report explicitly leaves missing live route adapter pending, but prices can be computed', () => {
  const r = analyzeOptimization({ aircraft: [aircraft()], complete: true, expectedRoutes: 1, warnings: [] }, optimizationConfig({}), {}, now);
  expect(r.aircraft[0].route.decision).toBe('unavailable'); expect(r.aircraft[0].pricing.proposed).toEqual({ Y: 1350, J: 3730, F: 18960 });
});
test('a route change defers prices instead of applying old route reference', () => {
  const r = analyzeOptimization({ aircraft: [aircraft()], complete: true, expectedRoutes: 1, warnings: [] }, optimizationConfig({ AIRCRAFT_ORIGINS_JSON: '[{"aircraftId":"1","origin":"AAA"}]' }), { '1': review() }, now);
  expect(r.aircraft[0].route.decision).toBe('would_reroute'); expect(r.aircraft[0].pricing.proposed).toBeNull();
});
test('mismatched aircraft context cannot trigger reroute', () => {
  const input = review(); input.position.aircraftId = 'another';
  const r = analyzeOptimization({ aircraft: [aircraft()], complete: true, expectedRoutes: 1, warnings: [] }, optimizationConfig({}), { '1': input }, now);
  expect(r.aircraft[0].route.decision).toBe('unavailable');
});
test('incomplete or duplicated collection blocks pricing proposals', () => {
  for (const [items, complete] of [[[aircraft()], false], [[aircraft(), aircraft()], true]] as const) {
    const r = analyzeOptimization({ aircraft: [...items], complete, expectedRoutes: items.length, warnings: [] }, optimizationConfig({}), {}, now);
    expect(r.aircraft.every(a => a.pricing.proposed === null)).toBe(true);
  }
});
test('invalid flags or optimization thresholds rejected', () => {
  expect(() => optimizationConfig({ ENABLE_TICKET_PRICING: 'yes' })).toThrow();
  expect(() => optimizationConfig({ ROUTE_MIN_OCCUPANCY_PERCENT: '0' })).toThrow();
  expect(() => optimizationConfig({ ROUTE_MIN_IMPROVEMENT_PERCENT: '-1' })).toThrow();
});


test('per-aircraft origin is explicit and never defaults to company base', () => {
  expect(readAircraftOrigins(undefined).size).toBe(0);
  const origins = readAircraftOrigins('[{"aircraftId":"1","origin":"GRU"},{"aircraftId":"2","origin":"DTW"}]');
  expect(origins.get('1')).toBe('GRU'); expect(origins.get('2')).toBe('DTW'); expect(origins.get('3')).toBeUndefined();
});
for (const raw of ['{}','null','oops','[{"aircraftId":"1","origin":"gru"}]','[{"aircraftId":"TEST","origin":"GRU"}]','[{"aircraftId":"1","origin":"GRU"},{"aircraftId":"1","origin":"DTW"}]']) {
  test(`rejects invalid or ambiguous origins ${raw}`, () => expect(()=>readAircraftOrigins(raw)).toThrow('AIRCRAFT_ORIGINS_JSON invalido'));
}
test('known return without registered operational origin remains unavailable', () => {
  const r = analyzeOptimization({aircraft:[aircraft()],complete:true,expectedRoutes:1,warnings:[]},optimizationConfig({}),{'1':review()},now);
  expect(r.aircraft[0].route.decision).toBe('unavailable'); expect(r.aircraft[0].operationalOrigin).toBeNull();
});
test('landing at another hub cannot redefine the aircraft origin', () => {
  const config = optimizationConfig({AIRCRAFT_ORIGINS_JSON:'[{"aircraftId":"1","origin":"CCC"}]'});
  const r = analyzeOptimization({aircraft:[aircraft()],complete:true,expectedRoutes:1,warnings:[]},config,{'1':review()},now);
  expect(r.aircraft[0].route.decision).toBe('unavailable'); expect(r.aircraft[0].operationalOrigin).toBe('CCC');
  expect(r.aircraft[0].route.reason).toContain('diverge');
  expect(JSON.parse(JSON.stringify(r)).config.aircraftOrigins).toContainEqual({aircraftId:'1',origin:'CCC'});
});
test('two aircraft returning to their distinct origins can each be reviewed', () => {
  const second = aircraft(); second.aircraftId='2'; second.routeId='second'; second.from='CCC'; second.to='DDD'; second.routeLabel='CCC-DDD';
  const secondReview=review(); secondReview.position.aircraftId='2'; secondReview.previousPosition!.aircraftId='2';
  secondReview.position.homeBase='CCC'; secondReview.position.airport='CCC'; secondReview.previousPosition!.homeBase='CCC'; secondReview.previousPosition!.destination='CCC';
  secondReview.currentRouteId='second'; secondReview.candidates[0].id='second';
  secondReview.candidates.forEach(c=>{c.legs[0].from='CCC';c.legs[0].to='DDD';c.legs[1].from='DDD';c.legs[1].to='CCC';c.legs.forEach(l=>l.demandPool='CCC-DDD');});
  const config=optimizationConfig({AIRCRAFT_ORIGINS_JSON:'[{"aircraftId":"1","origin":"AAA"},{"aircraftId":"2","origin":"CCC"}]'});
  const r=analyzeOptimization({aircraft:[aircraft(),second],complete:true,expectedRoutes:2,warnings:[]},config,{'1':review(),'2':secondReview},now);
  expect(r.aircraft.map(a=>a.route.decision)).toEqual(['would_reroute','would_reroute']);
  expect(r.aircraft.map(a=>a.operationalOrigin)).toEqual(['AAA','CCC']);
});

for (const mismatch of ['airport', 'snapshot-age', 'range', 'runway'] as const) test(`route review must agree with fresh collected aircraft evidence: ${mismatch}`, () => {
  const a = aircraft();
  const input = review();
  if (mismatch === 'airport') a.from = 'BBB';
  if (mismatch === 'snapshot-age') a.observedAt = older;
  if (mismatch === 'range' || mismatch === 'runway') a.operational = {
    rangeKm: mismatch === 'range' ? 1000 : input.rangeKm,
    minRunwayFt: mismatch === 'runway' ? 10000 : input.minRunwayFt,
    flightHours: 100, cycles: 10, homeBase: null, flightId: null,
  };
  const config = optimizationConfig({ AIRCRAFT_ORIGINS_JSON: '[{"aircraftId":"1","origin":"AAA"}]' });
  const result = analyzeOptimization({ aircraft: [a], complete: true, expectedRoutes: 1, warnings: [] }, config, {'1': input}, now);
  expect(result.aircraft[0].route.decision).toBe('unavailable');
  expect(result.aircraft[0].route.mutationAuthorized).toBe(false);
});

test('daily fallback evaluates a grounded aircraft without claiming a return', () => {
  const r=review();r.previousPosition=null;r.position.flightId=null;
  const result=analyzeOptimization({aircraft:[aircraft()],complete:true,expectedRoutes:1,warnings:[]},optimizationConfig({AIRCRAFT_ORIGINS_JSON:'[{"aircraftId":"1","origin":"AAA"}]'}),{'1':r},now);
  expect(result.aircraft[0].route.decision).toBe('would_reroute');
  expect(result.aircraft[0].route.arrivalKey).toBe('1:daily_20260929:AAA');
  expect(result.aircraft[0].dailyReview.historyAvailable).toBe(false);
  expect(result.dailyReviews[0].due).toBe(true); // A proposal without durable state does not complete a daily review.
});
test('yesterday consumed return falls back to new daily comparison', () => {
  const r=review();r.lastReviewedArrival='1:flight-1:AAA';
  const result=analyzeOptimization({aircraft:[aircraft()],complete:true,expectedRoutes:1,warnings:[]},optimizationConfig({AIRCRAFT_ORIGINS_JSON:'[{"aircraftId":"1","origin":"AAA"}]'}),{'1':r},now);
  expect(result.aircraft[0].route.decision).toBe('would_reroute');
  expect(result.aircraft[0].route.arrivalKey).toContain('daily_');
});
