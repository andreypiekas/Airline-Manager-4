import { readAirlineBases, resolveAircraftOrigin } from './aircraft-origins';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CollectionResult } from '../demand/types';

/** Evidence for setup and diagnosis, never an inferred flight ID or return event. */
export function fleetObservations(collection: CollectionResult, origins: ReadonlyMap<string, string>, now = new Date(), maxAgeSeconds = 300, bases: readonly string[] = readAirlineBases(undefined)) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) throw new Error('OBSERVATION_CONFIG_INVALID');
  const counts = new Map<string, number>();
  for (const a of collection.aircraft) counts.set(a.aircraftId, (counts.get(a.aircraftId) || 0) + 1);
  const aircraft = collection.aircraft.map(a => {
    const validIdentity = /^\d+$/.test(a.aircraftId) && /^\d+$/.test(a.routeId) && counts.get(a.aircraftId) === 1;
    const originResolution = resolveAircraftOrigin(a, collection, origins, bases);
    const origin = originResolution.origin;
    const age = now.getTime() - Date.parse(a.observedAt);
    const detailsVerified = collection.complete && validIdentity && !a.issue && !!a.capacity && !!a.operational &&
      ['ready', 'inflight'].includes(a.state) && Number.isFinite(age) && age >= 0 && age <= maxAgeSeconds * 1000;
    return { aircraftId: a.aircraftId, registration: a.registration, routeId: a.routeId,
      state: a.state, operationalOrigin: origin, originResolution, observedAt: a.observedAt,
      currentAirport: detailsVerified && a.state === 'ready' ? a.from : null,
      destination: detailsVerified ? a.to : null, routeAirports: [a.from, a.to],
      detailsVerified, capacity: a.capacity, operational: a.operational ?? null,
      timing: detailsVerified ? a.timing ?? null : null,
      demandResetHints: detailsVerified ? a.demandResetHints ?? [] : [],
      flightId: null, returnConfirmed: false, mutationAuthorized: false,
      blockers: [...(!validIdentity ? ['INVALID_IDENTITY'] : []), ...(!origin ? ['ORIGIN_NOT_REGISTERED'] : []),
        ...(!detailsVerified ? ['DETAILS_UNVERIFIED'] : []), 'FLIGHT_EVENT_ID_UNVERIFIED'] };
  });
  const observedIds = new Set(collection.aircraft.map(a => a.aircraftId));
  return { schemaVersion: 1, generatedAt: now.toISOString(), collectionComplete: collection.complete,
    observationOnly: true, mutationAuthorized: false,
    missingOrigins: aircraft.filter(a => a.blockers.includes('ORIGIN_NOT_REGISTERED')).length,
    // An absent ID may be parked/pending, not necessarily removed. Never delete configuration automatically.
    configuredButNotObserved: [...origins.keys()].filter(id => !observedIds.has(id)), aircraft };
}

export async function writeFleetObservations(collection: CollectionResult, origins: ReadonlyMap<string, string>, directory = 'test-results/demand', maxAgeSeconds = 300, bases: readonly string[] = readAirlineBases(undefined)) {
  const report = fleetObservations(collection, origins, new Date(), maxAgeSeconds, bases);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'fleet-observations.json'), JSON.stringify(report, null, 2) + '\n');
  // Null is deliberately rejected by AIRCRAFT_ORIGINS_JSON until an operator confirms each origin.
  const unique = new Map(report.aircraft.filter(a => !a.blockers.includes('INVALID_IDENTITY')).map(a => [a.aircraftId,
    { aircraftId: a.aircraftId, origin: a.operationalOrigin }]));
  await writeFile(join(directory, 'aircraft-origins.template.json'), JSON.stringify([...unique.values()], null, 2) + '\n');
  return report;
}
