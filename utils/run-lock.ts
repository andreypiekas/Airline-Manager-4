import { mkdir, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Fail closed on an existing lock. Never delete someone else's or an abandoned lock automatically. */
export async function withRunLock<T>(task: () => Promise<T>, directory = resolve('.am4-run.lock')): Promise<T> {
  try { await mkdir(directory); } catch { throw new Error('[Lock] Outra execucao ou lock pendente; operacao bloqueada.'); }
  try { return await task(); } finally { await rmdir(directory); }
}
