import { dailyReviewDue, reviewDay } from './review-schedule';
import type { Journal } from './return-journal';
import { readFile } from 'node:fs/promises';
import { reviewWithReturnJournal, validateReturnJournal } from './return-journal';
import { configuredAircraftOrigins, readAirlineBases, resolveAircraftOrigin } from './aircraft-origins';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CollectionResult } from '../demand/types';
import { planTicketPrices } from '../pricing/ticket-pricing';
import { confirmedBaseReturn, RouteOptimizer, RoutePlan, RouteReview } from './route-optimizer';

export interface OptimizationConfig { reviewTimeZone: string; airlineBases: string[]; returnJournal: {directory: string; scope: string} | null; aircraftOrigins: ReadonlyMap<string, string>; pricingEnabled: boolean; routesEnabled: boolean; minOccupancy: number; minImprovementPercent: number; maxAgeSeconds: number }
export function optimizationConfig(env: NodeJS.ProcessEnv = process.env): OptimizationConfig {
  const flag = (key: string) => {
    const v = env[key]?.trim().toLowerCase() || 'true';
    if (v !== 'true' && v !== 'false') throw new Error(`${key} deve ser true ou false.`);
    return v === 'true';
  };
  const stateEnabled = env.ENABLE_RETURN_JOURNAL?.trim().toLowerCase() || 'false';
  if (!['true', 'false'].includes(stateEnabled)) throw new Error('ENABLE_RETURN_JOURNAL deve ser true ou false.');
  const scope = env.RETURN_JOURNAL_SCOPE || '';
  if (stateEnabled === 'true' && !/^[A-Za-z0-9_-]{1,100}$/.test(scope)) throw new Error('RETURN_JOURNAL_SCOPE obrigatorio e invalido.');
  const returnJournal = stateEnabled === 'true' ? { directory: '.am4-state/github', scope } : null;
  const minOccupancy = Number(env.ROUTE_MIN_OCCUPANCY_PERCENT?.trim() || '80');
  const minImprovementPercent = Number(env.ROUTE_MIN_IMPROVEMENT_PERCENT?.trim() || '0');
  const maxAgeSeconds = Number(env.DEMAND_MAX_AGE_SECONDS?.trim() || '300');
  new RouteOptimizer(minOccupancy, minImprovementPercent, maxAgeSeconds); // Validate before any game navigation.
  const reviewTimeZone = env.ROUTE_REVIEW_TIMEZONE?.trim() || 'America/Sao_Paulo';
  reviewDay(new Date(), reviewTimeZone);
  return { reviewTimeZone, airlineBases: readAirlineBases(env.AIRLINE_BASES_JSON), returnJournal, aircraftOrigins: configuredAircraftOrigins(env.AIRCRAFT_ORIGINS_JSON), pricingEnabled: flag('ENABLE_TICKET_PRICING'), routesEnabled: flag('ENABLE_ROUTE_OPTIMIZER'), minOccupancy, minImprovementPercent, maxAgeSeconds };
}
/** The provider boundary deliberately accepts verified data, never guessed base/candidate selectors. */
export function analyzeOptimization(collection: CollectionResult, config: OptimizationConfig, reviews: Record<string, RouteReview> = {}, now = new Date(), journal: Journal | null = null) {
  const optimizer = new RouteOptimizer(config.minOccupancy, config.minImprovementPercent, config.maxAgeSeconds);
  const counts = new Map<string, number>();
  for (const a of collection.aircraft) counts.set(a.aircraftId, (counts.get(a.aircraftId) || 0) + 1);
  const aircraft = collection.aircraft.filter(a => a.state !== 'inflight').map(a => {
    let route: RoutePlan = { aircraftId: a.aircraftId, arrivalKey: null, decision: 'unavailable', selectedRouteId: null, scores: [],
      reason: config.routesEnabled ? 'Pendente: base, retorno confirmado, demanda reservada e estimativas das rotas candidatas.' : 'Otimizador de rotas desativado.', dryRun: true, mutationAuthorized: false };
    const originResolution = resolveAircraftOrigin(a, collection, config.aircraftOrigins, config.airlineBases);
    const origin = originResolution.origin;
    if (config.routesEnabled && !origin) route.reason = originResolution.reason;
    const suppliedReview = reviews[a.aircraftId];
    const review = suppliedReview && prepareReview(suppliedReview, config, journal, now);
    const dailyDue = dailyReviewDue(a.aircraftId, origin, journal, now, config.reviewTimeZone);
    const snapshotAge = now.getTime() - Date.parse(a.observedAt);
    const trustworthy = collection.complete && a.state === 'ready' && !a.issue && counts.get(a.aircraftId) === 1 &&
      Number.isFinite(snapshotAge) && snapshotAge >= 0 && snapshotAge <= config.maxAgeSeconds * 1000;
    if (config.routesEnabled && trustworthy && review && origin) {
      if (review.position.homeBase !== origin || (review.previousPosition && review.previousPosition.homeBase !== origin)) {
        route.reason = 'Base informada nas observacoes diverge da origem operacional cadastrada para esta aeronave.';
      } else if (review.position.aircraftId !== a.aircraftId || review.position.state !== 'landed' || review.position.airport !== a.from ||
          review.currentRouteId !== a.routeId || !a.capacity || ['Y', 'J', 'F'].some(k => a.capacity![k as keyof typeof a.capacity] !== review.capacity[k as keyof typeof review.capacity]) ||
          a.operational && (review.rangeKm !== a.operational.rangeKm || review.minRunwayFt !== a.operational.minRunwayFt)) {
        route.reason = 'Contexto de otimizacao nao corresponde a aeronave/rota/layout coletados.';
      } else if (review.trigger === 'daily' && !dailyDue) route = { ...route, decision: 'already_reviewed', reason: 'Revisao diaria ja concluida hoje.' };
      else route = optimizer.review(review, now);
    }
    let pricing = planTicketPrices(a, config.pricingEnabled, now, config.maxAgeSeconds);
    if (!trustworthy && config.pricingEnabled) pricing = { ...pricing, status: 'unavailable', proposed: null, reason: 'Coleta incompleta, duplicada ou aeronave indisponivel.' };
    if (route.decision === 'would_reroute') pricing = { ...pricing, status: 'unavailable', proposed: null, reason: 'Recalcular a tarifa Auto da NOVA rota somente apos confirmar a troca; nao usar tarifa da rota anterior.' };
    return { aircraftId: a.aircraftId, registration: a.registration, operationalOrigin: origin, originResolution, dailyReview: { due: dailyDue, historyAvailable: !!journal, day: reviewDay(now, config.reviewTimeZone) }, operational: a.operational ?? null, route, pricing };
  });
  return { schemaVersion: 1, generatedAt: now.toISOString(), dryRun: true, mutationAuthorized: false, collectionComplete: collection.complete,
    dailyReviews: collection.aircraft.map(a => {
      const origin = resolveAircraftOrigin(a, collection, config.aircraftOrigins, config.airlineBases).origin;
      const due = dailyReviewDue(a.aircraftId, origin, journal, now, config.reviewTimeZone);
      return { aircraftId: a.aircraftId, due, historyAvailable: !!journal, day: reviewDay(now, config.reviewTimeZone),
        status: !config.routesEnabled ? 'disabled' : !due ? 'completed_today' : !origin ? 'origin_unavailable' : a.state === 'inflight' ? 'pending_inflight' : a.state !== 'ready' || a.issue || !collection.complete ? 'data_unavailable' : a.from !== origin ? 'pending_base_return' : 'pending_comparison' };
    }), config: { ...config, aircraftOrigins: Array.from(config.aircraftOrigins, ([aircraftId, origin]) => ({ aircraftId, origin })) },
    limitations: ['Comparacao somente entre candidatos fornecidos; nao garante otimo global.', 'Origem atribuida pela unica base da rota ou cadastro explicito; duas bases exigem desambiguacao. Coleta de retorno e candidatos completos ainda pendente.', 'Nenhuma rota ou tarifa sera modificada.'], aircraft };
}
export async function writeOptimizationReport(report: ReturnType<typeof analyzeOptimization>, directory = 'test-results/demand') {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'optimization-report.json'), JSON.stringify(report, null, 2) + '\n');
  const safe = (s: string) => s.replace(/[|\r\n<>]/g, ' ');
  const rows = report.aircraft.map(a => `| ${safe(a.registration)} | ${a.operationalOrigin ?? 'indisponivel'} | ${a.route.decision}: ${safe(a.route.reason)} | ${a.pricing.status} | ${a.pricing.proposed ? ['Y','J','F'].map(k => a.pricing.proposed![k as keyof typeof a.pricing.proposed] ?? '—').join(' / ') : '—'} |`);
  await writeFile(join(directory, 'optimization-report.md'), ['# Rotas e tarifas — somente simulacao', '', '| Aeronave | Origem operacional | Analise da rota | Tarifas | Proposta Y/J/F |', '| --- | --- | --- | --- | --- |', ...rows, '', '## Revisao diaria', '', ...report.dailyReviews.map(d => `- ${safe(d.aircraftId)}: ${d.status}; dia ${d.day}; historico persistente disponivel: ${d.historyAvailable}.`), '', ...report.limitations.map(s => '- ' + s), ''].join('\n'));
}


/** Connect the journal only to already-validated simulation plans; no new UI selectors or game actions. */
export async function analyzeOptimizationWithJournal(collection: CollectionResult, config: OptimizationConfig, reviews: Record<string, RouteReview> = {}, now = new Date()) {
  // Never bootstrap a missing journal on an ephemeral runner.
  const journal = config.returnJournal ? validateReturnJournal(JSON.parse(await readFile(join(config.returnJournal.directory, 'return-journal.json'), 'utf8')), config.returnJournal.scope, now) : null;
  const report = analyzeOptimization(collection, config, reviews, now, journal);
  if (!config.returnJournal) return report;
  for (const aircraft of report.aircraft) {
    if (!['would_reroute', 'keep_route', 'hold'].includes(aircraft.route.decision)) continue;
    aircraft.route = await reviewWithReturnJournal(prepareReview(reviews[aircraft.aircraftId], config, journal, now), {
      ...config.returnJournal, origin: aircraft.operationalOrigin!, minOccupancy: config.minOccupancy,
      minImprovementPercent: config.minImprovementPercent, maxAgeSeconds: config.maxAgeSeconds
    }, now);
    if (['would_reroute', 'keep_route', 'hold'].includes(aircraft.route.decision)) {
      aircraft.dailyReview.due = false;
      const status = report.dailyReviews.find(a => a.aircraftId === aircraft.aircraftId);
      if (status) { status.due = false; status.status = 'completed_today'; }
    }
  }
  return report;
}

function prepareReview(review: RouteReview, config: OptimizationConfig, journal: Journal | null, now: Date): RouteReview {
  const arrival = confirmedBaseReturn(review.previousPosition, review.position);
  const consumed = arrival && (review.lastReviewedArrival === arrival || journal?.entries.some(e => e.aircraftId === review.position.aircraftId && e.origin === review.position.homeBase && e.flightId === review.position.flightId));
  return { ...review, trigger: arrival && !consumed ? 'return' : 'daily', reviewTimeZone: config.reviewTimeZone };
}
