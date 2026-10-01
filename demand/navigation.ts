import { expect, Page } from '@playwright/test';
import { AircraftSnapshot } from './types';

/** Explicitly opens a fresh list: it does not pretend to preserve a previous pagination cursor. */
export async function openFleetList(page: Page, timeout: number) {
  const menu = page.locator('#mapRoutes');
  const fleet = page.locator('#popBtn1');
  // The main Fleet menu TOGGLES the popup. Use its Fleet tab when already open.
  const tabOpen = await fleet.count() === 1 && await fleet.isVisible();
  const control = tabOpen ? fleet : menu;
  const allowed = tabOpen ? "$('.popMenuBtn').removeClass('active');$(this).addClass('active');$('#detailsAction').hide();Ajax('routes.php','routeAction',this,false,false);" : "hideAllWhenClick();menuFleet('Routes');";
  if (await control.count() !== 1 || !await control.isVisible() ||
    (await control.getAttribute('onclick') || '').replace(/\s/g,'') !== allowed) throw new Error('RESEARCH_LIST_CONTROL_UNVERIFIED');
  const previous = await page.locator('#routesContainer').count() === 1 ? await page.locator('#routesContainer').elementHandle() : null;
  try {
    await control.click({timeout});
    // Prevent an old hidden list from satisfying the loading checks.
    if (previous) await expect.poll(() => previous.evaluate(e => e.isConnected),{timeout}).toBe(false);
  } finally { await previous?.dispose(); }
  await page.locator('#routesContainer').waitFor({state:'visible',timeout});
  await page.locator('#routesContainer [id^="routeMainList"]').first().waitFor({state:'visible',timeout});
  if (await page.locator('#newRouteInfo').isVisible()) throw new Error('RESEARCH_QUOTE_NOT_CLOSED');
}

export async function findFleetRoute(page: Page, aircraft: AircraftSnapshot, timeout: number) {
  const seen = new Set<string>();
  for (let index=0; index<100; index++) {
    const rows = page.locator('#routesContainer [id^="routeMainList"]');
    const first = await rows.first().getAttribute('id');
    if (!first || seen.has(first)) throw new Error('RESEARCH_PAGINATION_INVALID');
    seen.add(first);
    const row = page.locator(`#routeMainList${aircraft.routeId}`);
    if (await row.count() === 1 && await row.isVisible()) return;
    const next = page.locator('#routesContainer .pagination').getByRole('link',{name:'Next',exact:true});
    if (await next.count() !== 1) throw new Error('RESEARCH_ROUTE_NOT_FOUND');
    const callback = await next.getAttribute('onclick') || '';
    const match = callback.match(/^Ajax\('routes\.php\?start=(\d+)&sort=','routeAction',this\);$/);
    if (!match || Number(match[1]) !== (index+1)*20) throw new Error('RESEARCH_PAGINATION_CONTROL_UNVERIFIED');
    await next.click({timeout});
    await expect.poll(() => rows.first().getAttribute('id'),{timeout}).not.toBe(first);
  }
  throw new Error('RESEARCH_PAGINATION_LIMIT');
}

