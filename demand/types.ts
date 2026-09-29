export const CLASSES = ['Y', 'J', 'F'] as const;
export type Cabin = typeof CLASSES[number];
export type Cabins = Record<Cabin, number>;
export type AircraftState = 'ready' | 'inflight' | 'unavailable';
export interface AircraftSnapshot {
  aircraftId: string;
  registration: string;
  routeId: string;
  routeLabel: string;
  from: string;
  to: string;
  state: AircraftState;
  capacity: Cabins | null;
  remaining: Cabins | null;
  dailyTotal: Cabins | null;
  observedAt: string;
  issue?: string;
}
export interface DemandConfig {
  enabled: boolean;
  dryRun: true;
  failSafe: true;
  minPercentage: number;
  mode: 'aggregate' | 'per-class';
  poolScope: 'airport-pair' | 'directional';
  maxAgeSeconds: number;
}
export type Decision = 'would_depart' | 'hold_insufficient' | 'hold_unavailable' | 'not_ready';
export interface DemandDecision extends AircraftSnapshot {
  decision: Decision;
  reason: string;
  poolKey: string;
  availableBefore: Cabins | null;
  possiblePassengers: Cabins | null;
  occupancyPercentage: number | null;
  classOccupancy: Record<Cabin, number | null> | null;
  requiredPassengers: number | null;
  requiredByClass: Cabins | null;
  // A simulation decision is never an execution authorization.
  departureAuthorized: false;
}
export interface CollectionResult {
  aircraft: AircraftSnapshot[];
  complete: boolean;
  expectedRoutes: number | null;
  warnings: string[];
}
export interface DemandReport {
  schemaVersion: 1;
  generatedAt: string;
  dryRun: true;
  config: DemandConfig;
  collectionComplete: boolean;
  warnings: string[];
  summary: {
    fleetSeen: number;
    evaluated: number;
    sufficient: number;
    insufficient: number;
    unavailable: number;
    notReady: number;
  };
  decisions: DemandDecision[];
}
