import { reviewDay } from './review-schedule';
import { Cabins, CLASSES } from '../demand/types';
import { adjustedPaxFare } from '../pricing/ticket-pricing';

export interface AircraftPosition {
  aircraftId: string;
  homeBase: string | null;
  airport: string | null;
  state: 'landed' | 'inflight';
  flightId: string | null;
  destination: string | null;
  observedAt: string;
}
/** A landed aircraft is not enough: require an observed flight -> landing transition at its own base. */
export function confirmedBaseReturn(previous: AircraftPosition | null, current: AircraftPosition): string | null {
  if (!previous || previous.aircraftId !== current.aircraftId || !current.homeBase || previous.homeBase !== current.homeBase ||
      previous.state !== 'inflight' || current.state !== 'landed' || current.airport !== current.homeBase || previous.destination !== current.homeBase ||
      !current.flightId || previous.flightId !== current.flightId || !Number.isFinite(Date.parse(previous.observedAt)) || !Number.isFinite(Date.parse(current.observedAt)) ||
      Date.parse(previous.observedAt) >= Date.parse(current.observedAt)) return null;
  return `${current.aircraftId}:${current.flightId}:${current.homeBase}`;
}
export interface RouteLeg {
  from: string; to: string; distanceKm: number; durationHours: number;
  originRunwayFt: number; destinationRunwayFt: number;
  demandPool: string; remaining: Cabins; automaticFares: Cabins;
  // Required estimate calibrated at the PROPOSED fares, not an assumed 100% load factor.
  expectedLoadFactor: Cabins;
  costs: { fuel: number; co2: number; maintenance: number; airportAndOther: number };
}
export interface RouteCandidate {
  id: string;
  observedAt: string;
  demandNetOfOtherAircraft: boolean;
  setupCost: number;
  legs: [RouteLeg, RouteLeg];
}
export interface RouteReview {
  trigger?: 'return' | 'daily';
  reviewTimeZone?: string;
  position: AircraftPosition;
  previousPosition: AircraftPosition | null;
  lastReviewedArrival?: string;
  capacity: Cabins;
  rangeKm: number;
  minRunwayFt: number;
  enforceRunway: boolean;
  currentRouteId: string;
  candidates: RouteCandidate[];
  candidatesComplete: boolean;
}
/** Daily review is a distinct event, never a fabricated flight/arrival. */
export function reviewEventId(input: RouteReview, now: Date): string | null {
  if (input.trigger === 'daily') {
    if (input.position.state !== 'landed' || !input.position.homeBase || input.position.airport !== input.position.homeBase) return null;
    return `daily_${reviewDay(now, input.reviewTimeZone).replace(/-/g, '')}`;
  }
  if (input.trigger !== undefined && input.trigger !== 'return') return null;
  return confirmedBaseReturn(input.previousPosition, input.position) ? input.position.flightId : null;
}
export interface RouteScore {
  routeId: string;
  valid: boolean;
  viable: boolean;
  netProfit: number | null;
  netProfitPerHour: number | null;
  occupancyPercentages: number[];
  reason: string;
}
export interface RoutePlan {
  aircraftId: string;
  arrivalKey: string | null;
  decision: 'would_reroute' | 'keep_route' | 'hold' | 'not_at_base_return' | 'already_reviewed' | 'unavailable';
  selectedRouteId: string | null;
  scores: RouteScore[];
  reason: string;
  dryRun: true;
  mutationAuthorized: false;
}
const airport = (s: string | null) => !!s && /^[A-Z0-9]{3}$/.test(s);
const countCabins = (c: Cabins) => c && CLASSES.every(k => Number.isSafeInteger(c[k]) && c[k] >= 0);
const finiteNonnegative = (n: number) => Number.isFinite(n) && n >= 0;

/** Best ESTIMATED contribution/hour among supplied candidates, not a global optimum guarantee. */
export class RouteOptimizer {
  private readonly reviewed = new Set<string>();
  constructor(private readonly minOccupancy = 80, private readonly minImprovementPercent = 0, private readonly maxAgeSeconds = 300) {
    if (!Number.isFinite(minOccupancy) || minOccupancy <= 0 || minOccupancy > 100 || !finiteNonnegative(minImprovementPercent) || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) throw new Error('Configuracao de rotas invalida.');
  }
  private score(candidate: RouteCandidate, input: RouteReview, now: Date): RouteScore {
    const result: RouteScore = { routeId: candidate.id, valid: false, viable: false, netProfit: null, netProfitPerHour: null, occupancyPercentages: [], reason: '' };
    const age = now.getTime() - Date.parse(candidate.observedAt);
    const base = input.position.homeBase;
    if (!candidate.id || !candidate.demandNetOfOtherAircraft || !Number.isFinite(age) || age < 0 || age > this.maxAgeSeconds * 1000 || !finiteNonnegative(candidate.setupCost) || candidate.legs.length !== 2) {
      return { ...result, reason: 'Candidato incompleto/expirado ou demanda sem reservas das outras aeronaves.' };
    }
    const [out, back] = candidate.legs;
    if (out.from !== base || back.to !== base || out.to !== back.from || out.from === out.to || !airport(out.to)) return { ...result, reason: 'Ciclo nao sai e retorna a base confirmada.' };
    const pools = new Map<string, Cabins>();
    for (const leg of candidate.legs) {
      if (!leg.demandPool || !countCabins(leg.remaining) || !countCabins(leg.automaticFares) || !CLASSES.every(k => finiteNonnegative(leg.expectedLoadFactor[k]) && leg.expectedLoadFactor[k] <= 1) ||
          !Number.isFinite(leg.distanceKm) || leg.distanceKm <= 0 || !Number.isFinite(leg.durationHours) || leg.durationHours <= 0 ||
          !finiteNonnegative(leg.originRunwayFt) || !finiteNonnegative(leg.destinationRunwayFt) || !['fuel', 'co2', 'maintenance', 'airportAndOther'].every(k => finiteNonnegative(leg.costs[k as keyof RouteLeg['costs']]))) {
        return { ...result, reason: 'Demanda, tarifas, ocupacao ou custos invalidos.' };
      }
      if (leg.distanceKm > input.rangeKm || input.enforceRunway && Math.min(leg.originRunwayFt, leg.destinationRunwayFt) < input.minRunwayFt) {
        return { ...result, valid: true, reason: 'Trecho fora do alcance ou pista insuficiente.' };
      }
      const existing = pools.get(leg.demandPool);
      pools.set(leg.demandPool, { Y: Math.min(existing?.Y ?? leg.remaining.Y, leg.remaining.Y), J: Math.min(existing?.J ?? leg.remaining.J, leg.remaining.J), F: Math.min(existing?.F ?? leg.remaining.F, leg.remaining.F) });
    }
    let revenue = 0, costs = candidate.id === input.currentRouteId ? 0 : candidate.setupCost, hours = 0;
    let occupancyOkay = true;
    try {
      for (const leg of candidate.legs) {
        const remaining = pools.get(leg.demandPool)!;
        let passengers = 0;
        for (const k of CLASSES) {
          if (input.capacity[k] === 0) continue;
          const n = Math.min(remaining[k], Math.floor(input.capacity[k] * leg.expectedLoadFactor[k]));
          revenue += n * adjustedPaxFare(leg.automaticFares[k], k);
          passengers += n; remaining[k] -= n;
        }
        const occupancy = 100 * passengers / (input.capacity.Y + input.capacity.J + input.capacity.F);
        result.occupancyPercentages.push(occupancy);
        occupancyOkay = occupancyOkay && occupancy >= this.minOccupancy;
        costs += leg.costs.fuel + leg.costs.co2 + leg.costs.maintenance + leg.costs.airportAndOther;
        hours += leg.durationHours;
      }
    } catch { return { ...result, reason: 'Tarifas invalidas nas classes utilizadas.' }; }
    const netProfit = revenue - costs, perHour = netProfit / hours;
    if (!Number.isFinite(netProfit) || !Number.isFinite(perHour)) return { ...result, reason: 'Resultado numerico inconsistente.' };
    return { ...result, valid: true, viable: occupancyOkay && netProfit > 0, netProfit, netProfitPerHour: perHour,
      reason: !occupancyOkay ? 'Ocupacao estimada abaixo do limite em pelo menos um trecho.' : netProfit <= 0 ? 'Ciclo sem lucro liquido estimado positivo.' : 'Ciclo viavel pelas estimativas informadas.' };
  }
  review(input: RouteReview, now = new Date()): RoutePlan {
    const eventId = reviewEventId(input, now);
    const arrivalKey = eventId ? `${input.position.aircraftId}:${eventId}:${input.position.homeBase}` : null;
    const result: RoutePlan = { aircraftId: input.position.aircraftId, arrivalKey, decision: 'unavailable', selectedRouteId: null, scores: [], reason: '', dryRun: true, mutationAuthorized: false };
    const positionAge = now.getTime() - Date.parse(input.position.observedAt);
    if (!Number.isFinite(positionAge) || positionAge < 0 || positionAge > this.maxAgeSeconds * 1000) return { ...result, reason: 'Posicao atual ausente ou expirada.' };
    if (!arrivalKey) return { ...result, decision: 'not_at_base_return', reason: input.trigger === 'daily' ? 'Revisao diaria pendente: aeronave precisa estar em solo na propria base.' : 'Retorno a propria base ainda nao confirmado por transicao de voo.' };
    if (this.reviewed.has(arrivalKey) || input.lastReviewedArrival === arrivalKey) return { ...result, decision: 'already_reviewed', reason: 'Este retorno ja foi avaliado.' };
    if (!airport(input.position.homeBase) || !input.candidatesComplete || !countCabins(input.capacity) || input.capacity.Y + input.capacity.J + input.capacity.F <= 0 || !Number.isFinite(input.rangeKm) || input.rangeKm <= 0 || !finiteNonnegative(input.minRunwayFt) || typeof input.enforceRunway !== 'boolean' || !input.currentRouteId || new Set(input.candidates.map(c => c.id)).size !== input.candidates.length) {
      return { ...result, reason: 'Identidade, aeronave ou conjunto de candidatos incompleto/inconsistente.' };
    }
    const scores = input.candidates.map(c => {
      try { return this.score(c, input, now); }
      catch { return { routeId: c.id, valid: false, viable: false, netProfit: null, netProfitPerHour: null, occupancyPercentages: [], reason: 'Dados obrigatorios ausentes no candidato.' }; }
    });
    const current = scores.find(s => s.routeId === input.currentRouteId);
    if (!current || !current.valid || scores.some(s => !s.valid)) return { ...result, scores, reason: 'Faltam estimativas validas para comparar a rota atual com todos os candidatos.' };
    const viable = scores.filter(s => s.viable).sort((a, b) => b.netProfitPerHour! - a.netProfitPerHour! || (a.routeId === input.currentRouteId ? -1 : b.routeId === input.currentRouteId ? 1 : a.routeId.localeCompare(b.routeId)));
    this.reviewed.add(arrivalKey);
    if (!viable.length) return { ...result, scores, decision: 'hold', reason: 'Nenhuma rota candidata atende ocupacao e lucro; manter em solo na simulacao.' };
    const best = viable[0];
    const threshold = current.netProfitPerHour === null ? -Infinity : current.netProfitPerHour + Math.abs(current.netProfitPerHour) * this.minImprovementPercent / 100;
    const change = best.routeId !== current.routeId && (!current.viable || best.netProfitPerHour! > threshold);
    return { ...result, scores, decision: change ? 'would_reroute' : 'keep_route', selectedRouteId: change ? best.routeId : current.routeId,
      reason: change ? 'Maior lucro liquido estimado por hora entre candidatos, com custo de troca no primeiro ciclo.' : 'Rota atual empatada, melhor ou sem melhoria minima configurada.' };
  }
}
