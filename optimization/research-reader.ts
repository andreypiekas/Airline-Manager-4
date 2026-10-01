import { expect, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AircraftSnapshot, CollectionResult } from '../demand/types';
import { DemandReader } from '../demand/reader';
import { OptimizationConfig } from './report';
import { fleetObservations } from './fleet-observations';
import { collectOpenRouteSuggestions } from './suggestion-reader';

export interface ResearchConfig { enabled: boolean; maxAircraft: number; maxSuggestions: number; timeout: number }
export function researchConfig(env: NodeJS.ProcessEnv = process.env): ResearchConfig {
  const enabled = env.ENABLE_ROUTE_RESEARCH?.trim().toLowerCase() || 'false';
  if (!['true','false'].includes(enabled)) throw new Error('RESEARCH_CONFIG_INVALID');
  const bounded = (key: string, fallback: number, maximum: number) => {
    const value = Number(env[key]?.trim() || fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('RESEARCH_CONFIG_INVALID');
    return value;
  };
  return { enabled: enabled === 'true', maxAircraft: bounded('ROUTE_RESEARCH_MAX_AIRCRAFT',3,10),
    maxSuggestions: bounded('ROUTE_RESEARCH_MAX_SUGGESTIONS',3,10), timeout: 10000 };
}

/** Explicitly opens a fresh list: it does not pretend to preserve a previous pagination cursor. */
async function openList(page: Page, timeout: number) {
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

async function findRoute(page: Page, aircraft: AircraftSnapshot, timeout: number) {
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

/** Observation only: quotes are never converted into complete economic reviews. */
export async function researchFleetCandidates(page: Page, collection: CollectionResult, optimization: OptimizationConfig, config = researchConfig()) {
  // Validate injected configuration too, before any navigation.
  if (typeof config.enabled !== 'boolean' || !Number.isSafeInteger(config.maxAircraft) || config.maxAircraft < 1 || config.maxAircraft > 10 ||
    !Number.isSafeInteger(config.maxSuggestions) || config.maxSuggestions < 1 || config.maxSuggestions > 10 ||
    !Number.isSafeInteger(config.timeout) || config.timeout < 1 || config.timeout > 30000) throw new Error('RESEARCH_CONFIG_INVALID');
  const observations = fleetObservations(collection, optimization.aircraftOrigins, new Date(), optimization.maxAgeSeconds, optimization.airlineBases);
  const aircraft = observations.aircraft.map(a => ({aircraftId:a.aircraftId,registration:a.registration,origin:a.operationalOrigin,
    routeId:a.routeId,status:!config.enabled || !optimization.routesEnabled ? 'disabled' : !a.detailsVerified ? 'data_unavailable' :
      !a.operationalOrigin ? 'origin_unavailable' : a.state !== 'ready' ? 'pending_inflight' : a.currentAirport !== a.operationalOrigin ? 'pending_base_return' : 'queued',
    result:null as Awaited<ReturnType<typeof collectOpenRouteSuggestions>> | null}));
  const report = {schemaVersion:1,generatedAt:new Date().toISOString(),dryRun:true,mutationAuthorized:false,
    candidatesComplete:false,comparisonReady:false,collectionComplete:collection.complete,config,uiRestored:true,warnings:[] as string[],aircraft};
  let attempted=0;
  for (const entry of aircraft) {
    if (entry.status !== 'queued') continue;
    if (attempted >= config.maxAircraft) {entry.status='deferred_limit';continue;}
    attempted++;
    try {
      await openList(page,config.timeout);
      const expected = collection.aircraft.find(a => a.aircraftId === entry.aircraftId)!;
      await findRoute(page,expected,config.timeout);
      const fresh = await new DemandReader(page,config.timeout).readReadyAircraftDetails(expected);
      if (!fresh.operational || !expected.operational || fresh.operational.rangeKm !== expected.operational.rangeKm || fresh.operational.minRunwayFt !== expected.operational.minRunwayFt) throw new Error('RESEARCH_CONTEXT_CHANGED');
      const reroute = page.locator('#detailsAction').getByRole('button',{name:/Reroute$/});
      if (await reroute.count() !== 1 || !await reroute.isVisible() || !await reroute.isEnabled() ||
        !new RegExp(`^showFlightInfo\\(this,${fresh.aircraftId},\\d+,false,true\\);closePop\\(\\);$`).test(await reroute.getAttribute('onclick') || '')) throw new Error('RESEARCH_PLANNER_CONTROL_UNVERIFIED');
      await reroute.click({timeout:config.timeout});
      await page.locator('#flightInfoContainer #introSuggest').waitFor({state:'visible',timeout:config.timeout});
      entry.result = await collectOpenRouteSuggestions(page,fresh,entry.origin,config.maxSuggestions,config.timeout);
      entry.status = entry.result.status;
    } catch {entry.status='unavailable';report.warnings.push(`RESEARCH_UNAVAILABLE:${entry.aircraftId}`);}
    finally {
      try {await openList(page,config.timeout);}
      catch {report.uiRestored=false;report.warnings.push('RESEARCH_LIST_RESTORE_FAILED');}
    }
    if (!report.uiRestored) {
      for (const remaining of aircraft) if (remaining.status === 'queued') remaining.status='deferred_restore_failure';
      break;
    }
  }
  return report;
}

export async function writeRouteResearchReport(report: Awaited<ReturnType<typeof researchFleetCandidates>>, directory='test-results/demand') {
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'route-research.json'),JSON.stringify(report,null,2)+'\n');
  const rows = report.aircraft.map(a => `- ${a.aircraftId}: ${a.status}; origem ${a.origin ?? 'indisponivel'}; orcamentos ${a.result?.quotes.length ?? 0}.`);
  await writeFile(join(directory,'route-research.md'),['# Consulta de rotas — somente leitura','',...rows,'',
    'Sugestoes limitadas nao demonstram a melhor rota. Demanda restante, custos completos e tarifas efetivas ainda precisam ser confirmados.',
    ...report.warnings.map(w => '- '+w),''].join('\n'));
}
