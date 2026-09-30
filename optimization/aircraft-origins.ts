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
