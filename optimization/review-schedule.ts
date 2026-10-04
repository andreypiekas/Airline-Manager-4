import type { Journal } from './return-journal';

export function reviewDay(date: Date, timeZone = 'America/Sao_Paulo'): string {
  if (!Number.isFinite(date.getTime())) throw new Error('REVIEW_DATE_INVALID');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export interface RouteReviewTrigger {
  due:boolean;
  trigger:'return'|'daily'|'none';
  flightId:string|null;
  reason:'CONFIRMED_RETURN_AFTER_LAST_REVIEW'|'DAILY_REVIEW_DUE'|'REVIEW_ALREADY_COMPLETED'|'ORIGIN_UNAVAILABLE';
}

/**
 * Confirmed returns have priority over the daily cadence. Arrival events are
 * created only from confirmed departure history, so uncertain mutations cannot
 * create a return review trigger.
 */
export function routeReviewTrigger(
  aircraftId:string,
  origin:string|null,
  journal:Journal|null,
  now:Date,
  timeZone='America/Sao_Paulo'
):RouteReviewTrigger {
  const today=reviewDay(now,timeZone),nowMs=now.getTime();
  if(!origin)return {due:true,trigger:'none',flightId:null,reason:'ORIGIN_UNAVAILABLE'};

  const reviews=(journal?.entries||[]).filter(e=>
    e.aircraftId===aircraftId&&e.origin===origin&&Number.isFinite(Date.parse(e.reviewedAt))&&Date.parse(e.reviewedAt)<=nowMs
  );
  const latestReviewMs=reviews.reduce((m,e)=>Math.max(m,Date.parse(e.reviewedAt)),Number.NEGATIVE_INFINITY);
  const arrivals=(journal?.events||[]).filter(e=>
    e.type==='arrival-observed'&&e.aircraftId===aircraftId&&e.to===origin&&
    Number.isFinite(Date.parse(e.observedAt))&&Date.parse(e.observedAt)<=nowMs
  ).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const latestArrival=arrivals.at(-1);

  if(latestArrival&&Date.parse(latestArrival.observedAt)>latestReviewMs)
    return {due:true,trigger:'return',flightId:latestArrival.eventId,reason:'CONFIRMED_RETURN_AFTER_LAST_REVIEW'};

  const reviewedToday=reviews.some(e=>reviewDay(new Date(e.reviewedAt),timeZone)===today);
  if(!reviewedToday)
    return {due:true,trigger:'daily',flightId:`daily_${today.replace(/-/g,'')}`,reason:'DAILY_REVIEW_DUE'};

  return {due:false,trigger:'none',flightId:null,reason:'REVIEW_ALREADY_COMPLETED'};
}

/** Route review due flag: a new confirmed return overrides an earlier same-day review. */
export function dailyReviewDue(aircraftId: string, origin: string | null, journal: Journal | null, now: Date, timeZone = 'America/Sao_Paulo'): boolean {
  return routeReviewTrigger(aircraftId,origin,journal,now,timeZone).due;
}
