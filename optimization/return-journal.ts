import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withRunLock } from '../utils/run-lock';
import { confirmedBaseReturn, RouteOptimizer, RoutePlan, RouteReview } from './route-optimizer';

type CompletedDecision = 'would_reroute' | 'keep_route' | 'hold';
interface Entry { aircraftId: string; origin: string; flightId: string; reviewedAt: string; decision: CompletedDecision }
export interface Journal { schemaVersion: 1; scope: string; entries: Entry[] }
export interface JournalOptions {
  /** Durable directory supplied by the caller; ephemeral Actions runners require explicit transport. */
  directory: string;
  /** Non-secret company/environment identifier. A journal cannot be reused across scopes. */
  scope: string;
  origin: string;
  minOccupancy?: number;
  minImprovementPercent?: number;
  maxAgeSeconds?: number;
}
const completed = (d: string): d is CompletedDecision => ['would_reroute', 'keep_route', 'hold'].includes(d);
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const validOrigin = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const key = (e: Pick<Entry, 'aircraftId' | 'origin' | 'flightId'>) => JSON.stringify([e.aircraftId, e.origin, e.flightId]);
export function validateReturnJournal(value: unknown, scope: string, now: Date): Journal {
  const data = value as Journal;
  if (!data || typeof data !== 'object' || Object.keys(data).sort().join(',') !== 'entries,schemaVersion,scope' || data.schemaVersion !== 1 || data.scope !== scope || !Array.isArray(data.entries) || data.entries.length > 100000) throw new Error('JOURNAL_INVALID');
  const seen = new Set<string>();
  for (const e of data.entries) {
    if (!e || typeof e !== 'object' || Object.keys(e).sort().join(',') !== 'aircraftId,decision,flightId,origin,reviewedAt' || !validId(e.aircraftId) || !validId(e.flightId) || !validOrigin(e.origin) || !completed(e.decision) ||
        typeof e.reviewedAt !== 'string' || !Number.isFinite(Date.parse(e.reviewedAt)) || Date.parse(e.reviewedAt) > now.getTime() || seen.has(key(e))) throw new Error('JOURNAL_INVALID');
    seen.add(key(e));
  }
  return data;
}
/** Simulation only. Local lock + atomic replace; never execute a game action inside this transaction. */
export async function reviewWithReturnJournal(input: RouteReview, options: JournalOptions, now = new Date()): Promise<RoutePlan> {
  if (!validId(options.scope) || !validOrigin(options.origin) || !validId(input.position.aircraftId) || !Number.isFinite(now.getTime())) throw new Error('JOURNAL_CONFIG_INVALID');
  if (input.position.homeBase !== options.origin || input.previousPosition && input.previousPosition.homeBase !== options.origin) throw new Error('JOURNAL_ORIGIN_MISMATCH');
  const optimizer = new RouteOptimizer(options.minOccupancy, options.minImprovementPercent, options.maxAgeSeconds);
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  return withRunLock(async () => {
    const filename = join(directory, 'return-journal.json');
    let data: Journal;
    try { data = validateReturnJournal(JSON.parse(await readFile(filename, 'utf8')), options.scope, now); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') data = { schemaVersion: 1, scope: options.scope, entries: [] };
      else throw new Error('JOURNAL_UNAVAILABLE: registro invalido/inacessivel; revisao bloqueada.');
    }
    const arrivalKey = confirmedBaseReturn(input.previousPosition, input.position);
    if (!arrivalKey) return optimizer.review(input, now);
    if (!validId(input.position.flightId)) throw new Error('JOURNAL_FLIGHT_ID_INVALID');
    const entry: Entry = { aircraftId: input.position.aircraftId, origin: options.origin, flightId: input.position.flightId, reviewedAt: now.toISOString(), decision: 'hold' };
    if (data.entries.some(e => key(e) === key(entry))) return { aircraftId: entry.aircraftId, arrivalKey, decision: 'already_reviewed', selectedRouteId: null, scores: [], reason: 'Retorno ja revisado em execucao anterior do mesmo registro.', dryRun: true, mutationAuthorized: false };
    const plan = optimizer.review(input, now);
    if (!completed(plan.decision)) return plan; // Missing data is retryable; never consume the arrival.
    if (data.entries.length >= 100000) throw new Error('JOURNAL_FULL: nao descartar historico automaticamente.');
    data.entries.push({ ...entry, decision: plan.decision });
    const temporary = join(directory, `return-journal.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(data, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, filename);
    } catch { throw new Error('JOURNAL_SAVE_FAILED: resultado da revisao nao liberado.'); }
    finally { await unlink(temporary).catch(() => undefined); }
    return plan;
  }, join(directory, '.return-journal.lock'));
}
