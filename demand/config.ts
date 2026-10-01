import { DemandConfig } from './types';

function booleanValue(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`[Demand] ${key} deve ser true ou false.`);
}
export function readDemandConfig(env: NodeJS.ProcessEnv = process.env): DemandConfig {
  const enabled = booleanValue(env, 'ENABLE_DEMAND_MANAGER', true);
  const dryRun = booleanValue(env, 'DEMAND_DRY_RUN', true);
  const failSafe = booleanValue(env, 'DEMAND_FAIL_SAFE', true);
  if (!failSafe || (!dryRun && (!enabled || env.DEMAND_EXECUTION_ACK !== 'individual-return-legs-v1'))) {
    throw new Error('[Demand] Execucao real exige gerenciador e fail-safe ativos e DEMAND_EXECUTION_ACK=individual-return-legs-v1.');
  }
  const minPercentage = Number(env.MIN_DEMAND_PERCENTAGE?.trim() || '80');
  if (!Number.isFinite(minPercentage) || minPercentage <= 0 || minPercentage > 100) {
    throw new Error('[Demand] MIN_DEMAND_PERCENTAGE deve estar entre 0 (exclusivo) e 100.');
  }
  const mode = env.DEMAND_THRESHOLD_MODE?.trim() || 'aggregate';
  const poolScope = env.DEMAND_POOL_SCOPE?.trim() || 'airport-pair';
  const maxAgeSeconds = Number(env.DEMAND_MAX_AGE_SECONDS?.trim() || '300');
  if (mode !== 'aggregate' && mode !== 'per-class') throw new Error('[Demand] DEMAND_THRESHOLD_MODE invalido.');
  if (poolScope !== 'airport-pair' && poolScope !== 'directional') throw new Error('[Demand] DEMAND_POOL_SCOPE invalido.');
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 3600) throw new Error('[Demand] DEMAND_MAX_AGE_SECONDS invalido.');
  return { enabled, dryRun, failSafe: true, minPercentage, mode, poolScope, maxAgeSeconds };
}
