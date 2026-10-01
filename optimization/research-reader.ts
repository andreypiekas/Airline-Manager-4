import { expect, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AircraftSnapshot, CollectionResult } from '../demand/types';
import { DemandReader } from '../demand/reader';
import { OptimizationConfig } from './report';
import { fleetObservations } from './fleet-observations';
import { collectOpenRouteSuggestions } from './suggestion-reader';
import { ModelCostReadResult, ModelCostReference, readMarketPriceReferences, readModelCostReferenceResult } from './cost-reference-reader';
import { candidateDemandEvidence } from './candidate-evidence';
import { candidateReservationScenario, reservationConfig } from './reservations';
import { readAircraftMaintenanceReferences } from './maintenance-reader';
import { candidateCostScenarios, effectiveCostBudget } from './cost-budget';
import { emptyFinanceHistory, readFinanceHistoryReference } from './finance-reader';

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

/** Adds available sources without manufacturing a complete RouteReview. */
export async function collectCandidateData(page:Page,collection:CollectionResult,research:Awaited<ReturnType<typeof researchFleetCandidates>>){
  const reservationsConfig=reservationConfig();
  const quotes=research.aircraft.flatMap(a=>a.result?.quotes||[]);
  const models:ModelCostReference[]=[];const warnings:string[]=[];
  const modelReads:ModelCostReadResult[]=[];
  let uiRestored=research.uiRestored;
  let market:Awaited<ReturnType<typeof readMarketPriceReferences>>={fuel:null,co2:null,uiClosed:true,stage:'not_requested',warnings:[],unitLabels:[]};
  let maintenance:Awaited<ReturnType<typeof readAircraftMaintenanceReferences>>={status:'not_requested',stage:'not_requested',observedAt:new Date().toISOString(),complete:false,uiClosed:true,aircraft:[],warnings:[]};
  let financeHistory=emptyFinanceHistory();
  // Market and maintenance sources must be validated even when no aircraft is eligible for research.
  if(research.config.enabled&&uiRestored){
    const ids=[...new Set(quotes.flatMap(q=>q.autopriceReference?[q.autopriceReference.modelId]:[]))];
    if(ids.length>10)warnings.push('MODEL_REFERENCE_LIMIT');
    for(const id of ids.slice(0,10)){
      try {
        await openList(page,research.config.timeout);
        const read=await readModelCostReferenceResult(page,id,research.config.timeout);modelReads.push(read);
        if(read.reference)models.push(read.reference);else warnings.push(`MODEL_REFERENCE_${read.status.toUpperCase()}:${id}`);
      }catch{modelReads.push({modelId:id,status:'unavailable',reference:null});warnings.push(`MODEL_REFERENCE_UNAVAILABLE:${id}`);}
      finally{try{await openList(page,research.config.timeout);}catch{uiRestored=false;warnings.push('COST_REFERENCE_LIST_RESTORE_FAILED');}}
      if(!uiRestored)break;
    }
    if(uiRestored){
      market=await readMarketPriceReferences(page,research.config.timeout);
      try{if(!market.uiClosed)throw new Error();await openList(page,research.config.timeout);}
      catch{uiRestored=false;warnings.push('MARKET_LIST_RESTORE_FAILED');}
    }
    if(uiRestored){
      maintenance=await readAircraftMaintenanceReferences(page,collection,research.config.timeout);
      try{if(!maintenance.uiClosed)throw new Error();await openList(page,research.config.timeout);}
      catch{uiRestored=false;warnings.push('MAINTENANCE_LIST_RESTORE_FAILED');}
    }
    if(uiRestored){
      financeHistory=await readFinanceHistoryReference(page,research.config.timeout);
      try{if(!financeHistory.uiClosed)throw new Error();await openList(page,research.config.timeout);}
      catch{uiRestored=false;warnings.push('FINANCE_LIST_RESTORE_FAILED');}
    }
  }
  const now=new Date();
  const fresh=(stamp:string)=>{const age=now.getTime()-Date.parse(stamp);return Number.isFinite(age)&&age>=0&&age<=reservationsConfig.maxAgeSeconds*1000;};
  const candidates=quotes.map(quote=>{
    const demand=candidateDemandEvidence(quote,collection,now,reservationsConfig.maxAgeSeconds);
    const model=models.find(m=>m.modelId===quote.autopriceReference?.modelId)||null;
    const reservations=candidateReservationScenario(quote,collection,now,reservationsConfig);
    const aircraft=collection.aircraft.find(a=>a.aircraftId===quote.aircraftId);
    const capacity=collection.complete&&aircraft&&aircraft.registration===quote.registration&&aircraft.operational&&!aircraft.issue&&fresh(aircraft.observedAt)?aircraft.capacity:null;
    const costScenarios=candidateCostScenarios(quote,capacity,reservations.forwardAfterReservations,
      {fuel:market.fuel,co2:market.co2,model,maintenance:maintenance.aircraft.find(a=>a.aircraftId===quote.aircraftId)||null},now,reservationsConfig.maxAgeSeconds);
    const effectiveCosts=effectiveCostBudget(quote,{},now,reservationsConfig.maxAgeSeconds);
    const fuel=market.fuel&&fresh(market.fuel.observedAt)&&fresh(quote.observedAt)?quote.fuelLbs*market.fuel.pricePer1000/1000:null;
    return {aircraftId:quote.aircraftId,from:quote.from,to:quote.to,quoteObservedAt:quote.observedAt,
      demand,reservations,costScenarios,effectiveCosts,modelCostReference:model,costs:{fuelAtObservedMarketPrice:fuel,co2:null,maintenance:null,airportAndOther:null},
      setupFee:quote.routeFee,costsComplete:false,netProfit:null,comparisonReady:false,mutationAuthorized:false,
      missing:['FUTURE_OTHER_AIRCRAFT_RESERVATIONS','REVERSE_LEG_ECONOMICS','EFFECTIVE_FARES_AND_LOAD_FACTOR',
        'CO2_QUOTA_CONVERSION','AIRCRAFT_EFFECTIVE_MAINTENANCE','AIRPORT_AND_OTHER_COSTS','FUTURE_SCHEDULE_AND_RESET',
        ...(!demand.remaining?['DIRECTIONAL_REMAINING_DEMAND']:[]),...(fuel===null?['FUEL_MARKET_PRICE']:[])]};
  });
  return {schemaVersion:2,generatedAt:now.toISOString(),dryRun:true,mutationAuthorized:false,comparisonReady:false,
    uiRestored,market,models,modelReads,maintenance,financeHistory,
    warnings:[...warnings,...maintenance.warnings,...financeHistory.warnings],candidates};
}
export async function writeCandidateDataReport(report:Awaited<ReturnType<typeof collectCandidateData>>,directory='test-results/demand'){
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'candidate-data.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(directory,'finance-history.json'),JSON.stringify(report.financeHistory,null,2)+'\n');
  await writeFile(join(directory,'candidate-data.md'),['# Evidencias das candidatas — simulacao','',
    ...report.candidates.map(c=>`- ${c.aircraftId} ${c.from}–${c.to}: demanda ${c.demand.status}; reservas ${c.reservations.status} (${c.reservations.reservations.length} trechos); saldo simulado ${JSON.stringify(c.reservations.forwardAfterReservations)}; combustivel ao preco observado ${c.costs.fuelAtObservedMarketPrice??'indisponivel'}; CO2 de referencia ${c.costScenarios.co2.atDemandCeiling??'indisponivel'}; A-check de referencia ${c.costScenarios.aCheck.catalogProration??'indisponivel'}; custos efetivos faltantes ${c.effectiveCosts.missing.join(', ')}; pendencias ${c.missing.join(', ')}.`),'',
    `Manutencao: ${report.maintenance.status}; referencias individuais ${report.maintenance.aircraft.length}. Reservas sao cenarios limitados de capacidade antes da candidata; nao sao previsao de horarios nem reservas feitas no jogo.`,
    `Historico financeiro: ${report.financeHistory.status}; lancamentos visiveis ${report.financeHistory.transactions.length}. Compras observadas sao referencias de pagamentos; nao comprovam custo medio do estoque, despesa por trecho ou historico completo.`,
    'Referencia de A-check do catalogo nao confirma o custo efetivo da aeronave. Preco de mercado nao confirma o custo de aquisicao do estoque. Taxa de criacao nao e custo recorrente. Nenhum lucro liquido ou troca de rota autorizado.',
    ...report.warnings.map(w=>'- '+w),''].join('\n'));
}
