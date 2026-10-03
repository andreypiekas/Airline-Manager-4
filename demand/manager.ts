import { AircraftSnapshot, Cabins, CLASSES, CollectionResult, DemandConfig, DemandDecision, DemandReport } from './types';
import { AdaptiveThreshold, adaptiveDemandKey } from './adaptive-threshold';

const validCabins = (value: Cabins | null): value is Cabins => !!value && CLASSES.every(k => Number.isSafeInteger(value[k]) && value[k] >= 0);
const sum = (value: Cabins) => CLASSES.reduce((total, k) => total + value[k], 0);
const mapCabins = (fn: (k: typeof CLASSES[number]) => number): Cabins => ({ Y: fn('Y'), J: fn('J'), F: fn('F') });

export class DemandManager {
  constructor(private readonly config: DemandConfig,private readonly adaptive:ReadonlyMap<string,AdaptiveThreshold>=new Map()) {
    if (!config.dryRun || !config.failSafe || !Number.isFinite(config.minPercentage) || config.minPercentage <= 0 || config.minPercentage > 100 ||
        !['aggregate', 'per-class'].includes(config.mode) || !['airport-pair', 'directional'].includes(config.poolScope) ||
        !Number.isSafeInteger(config.maxAgeSeconds) || config.maxAgeSeconds < 1) throw new Error('Configuracao de demanda insegura/invalida.');
  }
  private pool(a: AircraftSnapshot): string {
    return (this.config.poolScope === 'airport-pair' ? [a.from, a.to].sort() : [a.from, a.to]).join(':');
  }
  private invalid(a: AircraftSnapshot, now: number): string | null {
    if (a.issue) return a.issue;
    if (!a.aircraftId || !a.routeId || !/^[A-Z0-9]{3}$/.test(a.from) || !/^[A-Z0-9]{3}$/.test(a.to) || a.from === a.to) return 'Identidade ou trecho indisponivel.';
    if (!validCabins(a.capacity) || sum(a.capacity) <= 0 || !Number.isSafeInteger(sum(a.capacity))) return 'Capacidade ausente ou inconsistente.';
    if (!validCabins(a.remaining) || !validCabins(a.dailyTotal)) return 'Demanda restante/total ausente ou inconsistente.';
    if (CLASSES.some(k => a.remaining![k] > a.dailyTotal![k])) return 'Demanda restante maior que o total diario.';
    const age = now - Date.parse(a.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > this.config.maxAgeSeconds * 1000) return 'Leitura expirada ou horario inconsistente.';
    return null;
  }
  analyze(collection: CollectionResult, now = new Date()): DemandReport {
    // All allocation state is scoped to ONE analysis, so renewed demand is reconsidered.
    const aircraftCounts = new Map<string, number>();
    const routeCounts = new Map<string, number>();
    for (const a of collection.aircraft) {
      aircraftCounts.set(a.aircraftId, (aircraftCounts.get(a.aircraftId) || 0) + 1);
      routeCounts.set(a.routeId, (routeCounts.get(a.routeId) || 0) + 1);
    }
    const pools = new Map<string, Cabins>();
    const totals = new Map<string, Cabins>();
    const inconsistentPools = new Set<string>();
    for (const a of collection.aircraft) {
      if (a.state !== 'ready' || this.invalid(a, now.getTime())) continue;
      const key = this.pool(a), current = pools.get(key), total = totals.get(key);
      if (total && CLASSES.some(k => total[k] !== a.dailyTotal![k])) inconsistentPools.add(key);
      totals.set(key, { ...a.dailyTotal! });
      // Conservative minimum across readings; do not double count a shared pool.
      pools.set(key, mapCabins(k => Math.min(current?.[k] ?? a.remaining![k], a.remaining![k])));
    }
    const decisions: DemandDecision[] = collection.aircraft.map(a => {
      const key = this.pool(a);
      const adaptive=this.adaptive.get(adaptiveDemandKey(a.aircraftId,a.routeId));
      const threshold=adaptive?.percentage??this.config.minPercentage;
      const d: DemandDecision = { ...a, poolKey: key, decision: 'hold_unavailable', reason: '', availableBefore: null,
        possiblePassengers: null, occupancyPercentage: null, classOccupancy: null, requiredPassengers: null, requiredByClass: null, thresholdPercentage:threshold, thresholdSource:adaptive?.source??'configured-floor', departureAuthorized: false };
      if (a.state === 'inflight') return { ...d, decision: 'not_ready', reason: 'Em voo; nenhuma nova decolagem nesta analise.' };
      if (!this.config.enabled) return { ...d, reason: 'Gerenciador desativado; nenhuma autorizacao emitida.' };
      if (!collection.complete) return { ...d, reason: 'Coleta incompleta; liberacoes simuladas bloqueadas.' };
      if ((aircraftCounts.get(a.aircraftId) || 0) > 1 || (routeCounts.get(a.routeId) || 0) > 1) return { ...d, reason: 'Aeronave ou rota duplicada na coleta.' };
      if (a.state !== 'ready') return { ...d, reason: a.issue || 'Disponibilidade para decolagem nao confirmada.' };
      const invalid = this.invalid(a, now.getTime());
      if (invalid) return { ...d, reason: invalid };
      if (inconsistentPools.has(key)) return { ...d, reason: 'Totais diarios divergentes no mesmo pool; possivel renovacao ou escopo incorreto.' };
      const available = pools.get(key)!;
      const capacity = a.capacity!;
      const possible = mapCabins(k => Math.min(capacity[k], available[k]));
      const totalSeats = sum(capacity), totalPossible = sum(possible);
      const percentage = 100 * totalPossible / totalSeats;
      const requiredByClass = mapCabins(k => Math.ceil(capacity[k] * threshold / 100));
      const requiredPassengers = Math.ceil(totalSeats * threshold / 100);
      const enough = totalPossible > 0 && (this.config.mode === 'aggregate' ? totalPossible >= requiredPassengers : CLASSES.every(k => possible[k] >= requiredByClass[k]));
      d.availableBefore = { ...available };
      d.possiblePassengers = possible;
      d.occupancyPercentage = percentage;
      d.classOccupancy = { Y: capacity.Y ? 100 * possible.Y / capacity.Y : null, J: capacity.J ? 100 * possible.J / capacity.J : null, F: capacity.F ? 100 * possible.F / capacity.F : null };
      d.requiredPassengers = requiredPassengers;
      d.requiredByClass = requiredByClass;
      d.decision = enough ? 'would_depart' : 'hold_insufficient';
      d.reason = totalPossible === 0 ? 'Sem demanda nas classes configuradas.' : `${totalPossible}/${totalSeats} assentos cobertos por demanda (${percentage.toFixed(2)}%); limite ${threshold}% (${this.config.mode}; ${d.thresholdSource}).`;
      if (enough) pools.set(key, mapCabins(k => available[k] - possible[k]));
      return d;
    });
    const count = (decision: DemandDecision['decision']) => decisions.filter(d => d.decision === decision).length;
    return { schemaVersion: 1, generatedAt: now.toISOString(), dryRun: true, config: { ...this.config }, collectionComplete: collection.complete,
      warnings: [...collection.warnings], summary: { fleetSeen: decisions.length, evaluated: decisions.length - count('not_ready'), sufficient: count('would_depart'),
        insufficient: count('hold_insufficient'), unavailable: count('hold_unavailable'), notReady: count('not_ready') }, decisions };
  }
}
