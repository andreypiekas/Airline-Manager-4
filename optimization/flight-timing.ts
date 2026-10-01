/** Arrival estimate from the inspected visible #timer; never a future departure or return event. */
export interface FlightTimingObservation {
  aircraftId:string;routeId:string;observedAt:string;remainingSeconds:number;arrivalEstimatedAt:string;
  source:'inspected-flight-countdown';futureDepartureAt:null;returnConfirmed:false;mutationAuthorized:false;
}
export function flightCountdownObservation(aircraftId:string,routeId:string,text:string,observedAt:string):FlightTimingObservation|null {
  const time=text.trim().match(/^(\d{2,3}):([0-5]\d):([0-5]\d)$/);
  const stamp=Date.parse(observedAt);
  if(!/^[1-9]\d*$/.test(aircraftId)||!/^[1-9]\d*$/.test(routeId)||!time||!Number.isFinite(stamp))return null;
  const seconds=Number(time[1])*3600+Number(time[2])*60+Number(time[3]);
  const arrival=stamp+seconds*1000;
  if(seconds<=0||!Number.isSafeInteger(arrival)||Math.abs(arrival)>8640000000000000)return null;
  return {aircraftId,routeId,observedAt,remainingSeconds:seconds,arrivalEstimatedAt:new Date(arrival).toISOString(),
    source:'inspected-flight-countdown',futureDepartureAt:null,returnConfirmed:false,mutationAuthorized:false};
}
