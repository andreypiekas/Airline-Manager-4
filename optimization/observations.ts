import { Locator } from '@playwright/test';
import { integerText } from '../demand/parsing';

export interface AircraftOperationalObservation {
  rangeKm: number;
  minRunwayFt: number;
  flightHours: number;
  cycles: number;
  // Deliberately not a home-base/flight identifier: neither was confirmed in this panel.
  homeBase: null;
  flightId: null;
}
/** Read only visible labels and their adjacent values, as inspected on 2026-09-30. */
export async function readOperationalObservation(details: Locator): Promise<AircraftOperationalObservation | null> {
  try {
    const values = await details.evaluate(el => {
      const value = (label: string) => {
        const matches = Array.from(el.querySelectorAll('span.s-text')).filter(e => e.textContent?.trim() === label && e.getClientRects().length);
        if (matches.length !== 1) throw new Error('Ambiguous label');
        let next = matches[0].nextElementSibling;
        if (next?.tagName === 'BR') next = next.nextElementSibling;
        if (!next?.matches('span.m-text') || !next.getClientRects().length) throw new Error('Missing value');
        return next.textContent?.trim() || '';
      };
      return { range: value('Range'), runway: value('Min runway'), cycles: value('Flight hours/Cycles') };
    });
    const range = values.range.match(/^([\d,]+)km$/), runway = values.runway.match(/^([\d,]+)ft$/);
    const cycles = values.cycles.match(/^([\d,]+)\s*\/\s*([\d,]+)$/);
    if (!range || !runway || !cycles) return null;
    const result = { rangeKm: integerText(range[1]), minRunwayFt: integerText(runway[1]), flightHours: integerText(cycles[1]), cycles: integerText(cycles[2]), homeBase: null, flightId: null };
    if (result.rangeKm <= 0 || result.minRunwayFt <= 0) return null;
    return result;
  } catch { return null; }
}
