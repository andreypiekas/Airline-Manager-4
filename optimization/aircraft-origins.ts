import { AircraftSnapshot, CollectionResult } from '../demand/types';
/** Stable aircraft IDs, never registration labels, route direction or the latest landing. */
export interface AircraftOrigin { aircraftId: string; origin: string }
export function readAircraftOrigins(raw: string | undefined): ReadonlyMap<string, string> {
  if (raw === undefined || raw.trim() === '') return new Map();
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error();
    const origins = new Map<string, string>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          Object.keys(entry).length !== 2 || typeof entry.aircraftId !== 'string' ||
          !/^[1-9]\d*$/.test(entry.aircraftId) || typeof entry.origin !== 'string' || !/^[A-Z]{3}$/.test(entry.origin) ||
          origins.has(entry.aircraftId)) throw new Error();
      origins.set(entry.aircraftId, entry.origin);
    }
    return origins;
  } catch { throw new Error('AIRCRAFT_ORIGINS_JSON invalido: use lista de aircraftId unico e origin IATA, sem inferir pela direcao da rota.'); }
}

/** Bases confirmed by the owner; this policy is configurable and does not prove a return. */
export function readAirlineBases(raw: string | undefined): string[] {
  try {
    const value: unknown = JSON.parse(raw?.trim() || '["XAP","GRU","DTW"]');
    if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) || new Set(value).size !== value.length) throw new Error();
    return value;
  } catch { throw new Error('AIRLINE_BASES_JSON invalido: informe lista unica de codigos IATA.'); }
}
export interface OriginResolution { origin: string | null; source: 'registered' | 'unique-route-base' | 'unavailable'; reason: string }
export function resolveAircraftOrigin(a: AircraftSnapshot, collection: CollectionResult, registered: ReadonlyMap<string, string>, bases: readonly string[]): OriginResolution {
  const unavailable = (reason: string): OriginResolution => ({ origin: null, source: 'unavailable', reason });
  if (!/^[1-9]\d*$/.test(a.aircraftId) || collection.aircraft.filter(other => other.aircraftId === a.aircraftId).length !== 1) return unavailable('Identidade da aeronave ausente ou duplicada.');
  const explicit = registered.get(a.aircraftId);
  if (explicit) return { origin: explicit, source: 'registered', reason: 'Origem cadastrada explicitamente por aeronave.' };
  if (!collection.complete || a.issue || !/^[A-Z]{3}$/.test(a.from) || !/^[A-Z]{3}$/.test(a.to) || a.from === a.to) return unavailable('Rota incompleta ou inconsistente para identificar a base.');
  const matches = [...new Set([a.from, a.to].filter(code => bases.includes(code)))];
  if (matches.length === 1) return { origin: matches[0], source: 'unique-route-base', reason: 'Unica base da companhia nos aeroportos da rota, conforme regra do operador.' };
  return unavailable(matches.length === 2 ? 'Rota entre duas bases; exige origem explicita para esta aeronave.' : 'Nenhum aeroporto da rota pertence as bases configuradas.');
}

/** Owner-confirmed exceptions; environment entries can explicitly override them. */
export function configuredAircraftOrigins(raw: string | undefined): ReadonlyMap<string, string> {
  return new Map([['22316469', 'GRU'], ...readAircraftOrigins(raw)]);
}
