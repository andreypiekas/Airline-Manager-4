import { readFile } from 'node:fs/promises';
import { reviewWithReturnJournal, validateReturnJournal } from './return-journal';
import { readAircraftOrigins, readAirlineBases, resolveAircraftOrigin } from './aircraft-origins';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CollectionResult } from '../demand/types';
import { planTicketPrices } from '../pricing/ticket-pricing';
import { RouteOptimizer, RoutePlan, RouteReview } from './route-optimizer';

export interface OptimizationConfig { airlineBases: string[]; returnJournal: {directory: string; scope: string} | null; aircraftOrigins: ReadonlyMap<string, string>; pricingEnabled: boolean; routesEnabled: boolean; minOccupancy: number; minImprovementPercent: number; maxAgeSeconds: number }
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
  return { airlineBases: readAirlineBases(env.AIRLINE_BASES_JSON), returnJournal, aircraftOrigins: readAircraftOrigins(env.AIRCRAFT_ORIGINS_JSON), pricingEnabled: flag('ENABLE_TICKET_PRICING'), routesEnabled: flag('ENABLE_ROUTE_OPTIMIZER'), minOccupancy, minImprovementPercent, maxAgeSeconds };
}
/** The provider boundary deliberately accepts verified data, never guessed base/candidate selectors. */
export function analyzeOptimization(collection: CollectionResult, config: OptimizationConfig, reviews: Record<string, RouteReview> = {}, now = new Date()) {
  const optimizer = new RouteOptimizer(config.minOccupancy, config.minImprovementPercent, config.maxAgeSeconds);
  const counts = new Map<string, number>();
  for (const a of collection.aircraft) counts.set(a.aircraftId, (counts.get(a.aircraftId) || 0) + 1);
  const aircraft = collection.aircraft.filter(a => a.state !== 'inflight').map(a => {
    let route: RoutePlan = { aircraftId: a.aircraftId, arrivalKey: null, decision: 'unavailable', selectedRouteId: null, scores: [],
      reason: config.routesEnabled ? 'Pendente: base, retorno confirmado, demanda reservada e estimativas das rotas candidatas.' : 'Otimizador de rotas desativado.', dryRun: true, mutationAuthorized: false };
    const originResolution = resolveAircraftOrigin(a, collection, config.aircraftOrigins, config.airlineBases);
    const origin = originResolution.origin;
    if (config.routesEnabled && !origin) route.reason = originResolution.reason;
    const review = reviews[a.aircraftId];
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
      } else route = optimizer.review(review, now);
    }
    let pricing = planTicketPrices(a, config.pricingEnabled, now, config.maxAgeSeconds);
    if (!trustworthy && config.pricingEnabled) pricing = { ...pricing, status: 'unavailable', proposed: null, reason: 'Coleta incompleta, duplicada ou aeronave indisponivel.' };
    if (route.decision === 'would_reroute') pricing = { ...pricing, status: 'unavailable', proposed: null, reason: 'Recalcular a tarifa Auto da NOVA rota somente apos confirmar a troca; nao usar tarifa da rota anterior.' };
    return { aircraftId: a.aircraftId, registration: a.registration, operationalOrigin: origin, originResolution, operational: a.operational ?? null, route, pricing };
  });
  return { schemaVersion: 1, generatedAt: now.toISOString(), dryRun: true, mutationAuthorized: false, collectionComplete: collection.complete, config: { ...config, aircraftOrigins: Array.from(config.aircraftOrigins, ([aircraftId, origin]) => ({ aircraftId, origin })) },
    limitations: ['Comparacao somente entre candidatos fornecidos; nao garante otimo global.', 'Origem atribuida pela unica base da rota ou cadastro explicito; duas bases exigem desambiguacao. Coleta de retorno e candidatos completos ainda pendente.', 'Nenhuma rota ou tarifa sera modificada.'], aircraft };
}
export async function writeOptimizationReport(report: ReturnType<typeof analyzeOptimization>, directory = 'test-results/demand') {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'optimization-report.json'), JSON.stringify(report, null, 2) + '\n');
  const safe = (s: string) => s.replace(/[|\r\n<>]/g, ' ');
  const rows = report.aircraft.map(a => `| ${safe(a.registration)} | ${a.operationalOrigin ?? 'indisponivel'} | ${a.route.decision}: ${safe(a.route.reason)} | ${a.pricing.status} | ${a.pricing.proposed ? ['Y','J','F'].map(k => a.pricing.proposed![k as keyof typeof a.pricing.proposed] ?? '—').join(' / ') : '—'} |`);
  await writeFile(join(directory, 'optimization-report.md'), ['# Rotas e tarifas — somente simulacao', '', '| Aeronave | Origem operacional | Analise da rota | Tarifas | Proposta Y/J/F |', '| --- | --- | --- | --- | --- |', ...rows, '', ...report.limitations.map(s => '- ' + s), ''].join('\n'));
}


/** Connect the journal only to already-validated simulation plans; no new UI selectors or game actions. */
export async function analyzeOptimizationWithJournal(collection: CollectionResult, config: OptimizationConfig, reviews: Record<string, RouteReview> = {}, now = new Date()) {
  const report = analyzeOptimization(collection, config, reviews, now);
  if (!config.returnJournal) return report;
  // Never bootstrap a missing journal on an ephemeral runner.
  validateReturnJournal(JSON.parse(await readFile(join(config.returnJournal.directory, 'return-journal.json'), 'utf8')), config.returnJournal.scope, now);
  for (const aircraft of report.aircraft) {
    if (!['would_reroute', 'keep_route', 'hold'].includes(aircraft.route.decision)) continue;
    aircraft.route = await reviewWithReturnJournal(reviews[aircraft.aircraftId], {
      ...config.returnJournal, origin: aircraft.operationalOrigin!, minOccupancy: config.minOccupancy,
      minImprovementPercent: config.minImprovementPercent, maxAgeSeconds: config.maxAgeSeconds
    }, now);
  }
  return report;
}
