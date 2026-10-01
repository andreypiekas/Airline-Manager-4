import { Cabins, CLASSES } from './types';

export function integerText(text: string): number {
  const value = text.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) throw new Error('Numero ausente ou invalido.');
  const number = Number(value.replace(/,/g, ''));
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Numero fora do intervalo.');
  return number;
}
export interface CabinText { Y: string; J: string; F: string }
export function parseCapacity(text: CabinText): Cabins {
  return { Y: integerText(text.Y), J: integerText(text.J), F: integerText(text.F) };
}
export function parseDemand(text: CabinText): { remaining: Cabins; dailyTotal: Cabins } {
  const remaining = { Y: 0, J: 0, F: 0 }, dailyTotal = { ...remaining };
  for (const k of CLASSES) {
    const pieces = text[k].trim().split('/');
    if (pieces.length !== 2) throw new Error('Esperada demanda restante/total.');
    remaining[k] = integerText(pieces[0]); dailyTotal[k] = integerText(pieces[1]);
    if (remaining[k] > dailyTotal[k]) throw new Error('Demanda restante maior que total.');
  }
  return { remaining, dailyTotal };
}
// DOM-derived identifiers only. This prepares a target, never executes a click.
export function individualDepartureSelector(routeId: string): string {
  if (!/^\d+$/.test(routeId)) throw new Error('ID de rota invalido.');
  return `#routeMainList${routeId} #listDepart${routeId}`;
}

/** Only the inspected Onboard label; malformed values stay unknown, not zero. */
export function parseOnboard(text: string): Cabins | null {
  const match = text.trim().match(/^Onboard:\s*([\d,]+)\s*\/\s*([\d,]+)\s*\/\s*([\d,]+)$/);
  if (!match) return null;
  try { return { Y: integerText(match[1]), J: integerText(match[2]), F: integerText(match[3]) }; }
  catch { return null; }
}
