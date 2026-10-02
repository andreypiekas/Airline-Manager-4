import { Cabins, Cabin, CLASSES, AircraftSnapshot } from '../demand/types';
import type { PricingSaveControlEvidence } from './control-evidence';

export const PAX_PERCENT: Cabins = { Y: 110, J: 108, F: 106 };
export interface FareControlEvidence {
  id: string;
  label: string;
  tag: string;
  type: string | null;
  onclickShape: string | null;
}
export interface FareObservation {
  automatic: Cabins | null;
  current: Cabins | null;
  source: 'inspected-auto-control' | 'unavailable';
  controls?: FareControlEvidence[];
  saveControl?: PricingSaveControlEvidence;
  issue?: string;
}
export interface FarePlan {
  aircraftId: string;
  routeId: string;
  status: 'would_adjust' | 'unchanged' | 'recommendation_only' | 'unavailable' | 'disabled';
  automatic: Cabins | null;
  current: Cabins | null;
  proposed: Record<Cabin, number | null> | null;
  reason: string;
  dryRun: true;
  mutationAuthorized: false;
}
/** Integer arithmetic: no floating-point boundary errors or cumulative markups. */
export function adjustedPaxFare(automatic: number, cabin: Cabin): number {
  const numerator = automatic * PAX_PERCENT[cabin];
  if (!Number.isSafeInteger(automatic) || automatic <= 0 || !Number.isSafeInteger(numerator)) throw new Error('Tarifa automatica invalida.');
  const result = Math.floor(numerator / 1000) * 10;
  if (result <= 0) throw new Error('Tarifa ajustada resultaria em zero.');
  return result;
}
/** Parse only the inspected numeric callback signature. Never execute its JavaScript. */
export function automaticFaresFromControl(onclick: string): Cabins {
  const match = onclick.trim().match(/^(?:playSound\('neutral_click'\);\s*)?ticketPriceSuggest\((\d+),(\d+),(\d+),this,(\d+)\);?$/);
  if (!match) throw new Error('Controle Auto desconhecido.');
  const values = match.slice(1).map(Number);
  if (!values.every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Valores Auto invalidos.');
  // Special-case factor observed in the game's ticketPriceSuggest DOM on 2026-09-29.
  const vip = [371, 383, 384].includes(values[3]);
  const transform = (n: number) => {
    if (!Number.isSafeInteger(n * 18)) throw new Error('Tarifa fora do intervalo.');
    return vip ? Math.ceil(n * 18 / 10) : n;
  };
  return { Y: transform(values[0]), J: transform(values[1]), F: transform(values[2]) };
}
export function planTicketPrices(a: AircraftSnapshot, enabled = true, now = new Date(), maxAgeSeconds = 300): FarePlan {
  const observation = a.fares;
  const result: FarePlan = { aircraftId: a.aircraftId, routeId: a.routeId, status: 'unavailable', automatic: observation?.automatic || null,
    current: observation?.current || null, proposed: null, reason: '', dryRun: true, mutationAuthorized: false };
  if (!enabled) return { ...result, status: 'disabled', reason: 'Ajuste de tarifas desativado.' };
  const age = now.getTime() - Date.parse(a.observedAt);
  if (a.state !== 'ready' || !a.capacity || !observation?.automatic || observation.source !== 'inspected-auto-control' || a.issue || observation.issue || !Number.isFinite(age) || age < 0 || age > maxAgeSeconds * 1000) {
    return { ...result, reason: 'Aeronave, configuracao ou referencia Auto indisponivel/expirada.' };
  }
  try {
    if (!CLASSES.every(k => Number.isSafeInteger(a.capacity![k]) && a.capacity![k] >= 0) || CLASSES.every(k => a.capacity![k] === 0)) throw new Error('Layout invalido.');
    const proposed = { Y: null, J: null, F: null } as Record<Cabin, number | null>;
    for (const k of CLASSES) if (a.capacity[k] > 0) proposed[k] = adjustedPaxFare(observation.automatic[k], k);
    const currentKnown = observation.current && CLASSES.every(k => !a.capacity![k] || Number.isSafeInteger(observation.current![k]) && observation.current![k] > 0);
    const same = currentKnown && CLASSES.every(k => proposed[k] === null || proposed[k] === observation.current![k]);
    return { ...result, proposed, status: !currentKnown ? 'recommendation_only' : same ? 'unchanged' : 'would_adjust',
      reason: 'Referencia Auto × Y1,10/J1,08/F1,06; arredondamento para baixo em dezenas. Classes sem assentos nao sao alteradas.' };
  } catch { return { ...result, reason: 'Tarifa automatica ou layout invalido; nenhum ajuste recomendado.' }; }
}
