import type { Journal } from './return-journal';

export function reviewDay(date: Date, timeZone = 'America/Sao_Paulo'): string {
  if (!Number.isFinite(date.getTime())) throw new Error('REVIEW_DATE_INVALID');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/** A missing/failed comparison never counts as a completed daily review. */
export function dailyReviewDue(aircraftId: string, origin: string | null, journal: Journal | null, now: Date, timeZone = 'America/Sao_Paulo'): boolean {
  const today = reviewDay(now, timeZone);
  return !journal?.entries.some(e => e.aircraftId === aircraftId && e.origin === origin &&
    Date.parse(e.reviewedAt) <= now.getTime() && reviewDay(new Date(e.reviewedAt), timeZone) === today);
}
