/** Exact read-only callback inspected on landed and inflight cards. */
export const AIRCRAFT_DETAILS_CONTROL = "^playSound\\('neutral_click'\\);Ajax\\('fleet_details\\.php\\?id=([1-9]\\d*)','detailsAction'\\);if\\(intro==0\\)\\{\\$\\('#routeAction'\\)\\.hide\\(\\);\\}$";
export function aircraftIdFromDetailsControl(callback: string): string | null {
  return callback.replace(/\s/g,'').match(new RegExp(AIRCRAFT_DETAILS_CONTROL))?.[1] ?? null;
}
