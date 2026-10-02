import { openFleetList as openList, findFleetRoute as findRoute } from '../demand/navigation';
import { expect, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AircraftSnapshot, CollectionResult } from '../demand/types';
import { DemandReader } from '../demand/reader';
import { OptimizationConfig } from './report';
import { fleetObservations } from './fleet-observations';
import { collectOpenRouteSuggestions, probeOpenRouteControl } from './suggestion-reader';
import { ModelCostReadResult, ModelCostReference, readMarketPriceReferences, readModelCostReferenceResult } from './cost-reference-reader';
import { candidateDemandEvidence } from './candidate-evidence';
import { candidateReservationScenario, reservationConfig } from './reservations';
import { readAircraftMaintenanceReferences } from './maintenance-reader';
import { candidateCostScenarios, effectiveCostBudget } from './cost-budget';
import { emptyFinanceHistory, readFinanceHistoryReference } from './finance-reader';
import { screenCandidateEconomics } from './economic-screen';
import { buildCandidateRoundTripScreen } from './round-trip-screen';
import { loadReference, RouteCatalog } from './reference-data';
import { CandidateQuote } from './quote-reader';
import { candidatePriorityReference, rankCandidatePriorities } from './candidate-priority';
import { summarizeComparisonReadiness } from './route-readiness';

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
  const report = {schemaVersion:3,generatedAt:new Date().toISOString(),dryRun:true,mutationAuthorized:false,
    candidatesComplete:false,comparisonReady:false,collectionComplete:collection.complete,config,uiRestored:true,warnings:[] as string[],aircraft,
    diagnosticProbe:null as Awaited<ReturnType<typeof probeOpenRouteControl>> | null,
    diagnosticProbes:[] as Awaited<ReturnType<typeof probeOpenRouteControl>>[]};
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
      entry.result = await collectOpenRouteSuggestions(page,fresh,entry.origin,config.maxSuggestions,config.timeout,optimization.minOccupancy);
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
  if(config.enabled&&optimization.routesEnabled&&report.uiRestored&&attempted===0){
    // Diagnostic-only fallback: inspect up to five ready aircraft that are away
    // from their confirmed base. These probes never become route candidates and
    // never authorize a mutation; they only broaden live UI evidence across
    // different aircraft/models while normal optimization remains base-only.
    const pending=aircraft.filter(a=>a.status==='pending_base_return').slice(0,5);
    for(const probeEntry of pending){
      const expected=collection.aircraft.find(a=>a.aircraftId===probeEntry.aircraftId);
      if(!expected)continue;
      try{
        await openList(page,config.timeout);
        await findRoute(page,expected,config.timeout);
        const fresh=await new DemandReader(page,config.timeout).readReadyAircraftDetails(expected);
        if(fresh.state!=='ready'||fresh.issue||fresh.aircraftId!==expected.aircraftId||fresh.registration!==expected.registration||
          fresh.routeId!==expected.routeId||fresh.from!==expected.from||!fresh.operational||!expected.operational||
          fresh.operational.rangeKm!==expected.operational.rangeKm||fresh.operational.minRunwayFt!==expected.operational.minRunwayFt)
          throw new Error('DIAGNOSTIC_CONTEXT_CHANGED');
        const reroute=page.locator('#detailsAction').getByRole('button',{name:/Reroute$/});
        const callback=await reroute.getAttribute('onclick')||'';
        const match=callback.match(/^showFlightInfo\(this,(\d+),(\d+),false,true\);closePop\(\);$/);
        if(await reroute.count()!==1||!await reroute.isVisible()||!await reroute.isEnabled()||!match||match[1]!==fresh.aircraftId)
          throw new Error('DIAGNOSTIC_PLANNER_CONTROL_UNVERIFIED');
        await reroute.click({timeout:config.timeout});
        await page.locator('#flightInfoContainer #introSuggest').waitFor({state:'visible',timeout:config.timeout});
        const probe=await probeOpenRouteControl(page,fresh,fresh.from,config.timeout);
        report.diagnosticProbes.push(probe);
        if(!report.diagnosticProbe)report.diagnosticProbe=probe;
      }catch{
        report.warnings.push('DIAGNOSTIC_ROUTE_CONTROL_UNAVAILABLE:'+probeEntry.aircraftId);
      }finally{
        try{await openList(page,config.timeout);}
        catch{
          report.uiRestored=false;
          report.warnings.push('DIAGNOSTIC_LIST_RESTORE_FAILED');
        }
      }
      if(!report.uiRestored)break;
    }
  }
  return report;
}

export async function writeRouteResearchReport(report: Awaited<ReturnType<typeof researchFleetCandidates>>, directory='test-results/demand') {
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'route-research.json'),JSON.stringify(report,null,2)+'\n');
  const rows = report.aircraft.map(a => `- ${a.aircraftId}: ${a.status}; origem ${a.origin ?? 'indisponivel'}; orcamentos mantidos ${a.result?.quotes.length ?? 0}; sugestoes examinadas ${a.result?.scanned ?? 0}; descartadas por teto de ocupacao ${a.result?.screenedOut.length ?? 0}.`);
  const probeRows=report.diagnosticProbes.length?report.diagnosticProbes:(report.diagnosticProbe?[report.diagnosticProbe]:[]);
  const diagnostic=probeRows.length?[
    '',
    '## Sondas estruturais fora da base — somente leitura',
    '',
    ...probeRows.flatMap(probe=>[
      `- Aeronave ${probe.aircraftId} em ${probe.currentAirport}: ${probe.status}.`,
      ...(probe.observation?[
        `  - Trecho: ${probe.observation.from}–${probe.observation.to}; Create route validado ${probe.observation.routeMutationControl?.nativeClickReady?'sim':'nao'}.`,
        `  - Autoprice: ${probe.observation.autopriceFunctionEvidence?.observed?'observado':'indisponivel'}; transformacao ${probe.observation.autopriceFunctionEvidence?.fareTransformVerified?'verificada':'nao verificada'}; modelos VIP ${probe.observation.autopriceFunctionEvidence?.vipModelIds?.join(', ')||'nenhum'}; multiplicador ${probe.observation.autopriceFunctionEvidence?.vipMultiplier??'indisponivel'}.`,
        `  - Campos operacionais: ${probe.observation.quoteFieldDiagnostics.map(f=>[f.id||'',f.label||'',f.title||''].filter(Boolean).join(' ')).join(' || ')||'nenhum'}.`
      ]:[]),
      ...probe.warnings.map(w=>'  - '+w)
    ])
  ]:[];
  await writeFile(join(directory,'route-research.md'),['# Consulta de rotas — somente leitura','',...rows,...diagnostic,'',
    'Sugestoes limitadas nao demonstram a melhor rota. Demanda restante, custos completos e tarifas efetivas ainda precisam ser confirmados.',
    ...report.warnings.map(w => '- '+w),''].join('\n'));
}

/** Adds available sources without manufacturing a complete RouteReview. */
export async function collectCandidateData(page:Page,collection:CollectionResult,research:Awaited<ReturnType<typeof researchFleetCandidates>>,minCoveragePercent=80){
  const reservationsConfig=reservationConfig();
  const quotes=research.aircraft.flatMap(a=>a.result?.quotes||[]);
  const models:ModelCostReference[]=[];const warnings:string[]=[];
  const modelReads:ModelCostReadResult[]=[];
  const screeningNow=new Date();
  const freshAt=(stamp:string,at:Date)=>{const age=at.getTime()-Date.parse(stamp);return Number.isFinite(age)&&age>=0&&age<=reservationsConfig.maxAgeSeconds*1000;};
  const capacityFor=(quote:CandidateQuote,at:Date)=>{
    const aircraft=collection.aircraft.find(a=>a.aircraftId===quote.aircraftId);
    return collection.complete&&aircraft&&aircraft.registration===quote.registration&&aircraft.operational&&!aircraft.issue&&freshAt(aircraft.observedAt,at)?aircraft.capacity:null;
  };
  const screeningByQuote=new Map(quotes.map(quote=>[quote,screenCandidateEconomics(
    quote,capacityFor(quote,screeningNow),minCoveragePercent,screeningNow,reservationsConfig.maxAgeSeconds
  )] as const));
  const economicQuotes=quotes.filter(quote=>screeningByQuote.get(quote)?.demandStatus!=='cannot_meet_threshold');
  const screenedOutBeforeModelReference=quotes.length-economicQuotes.length;
  if(screenedOutBeforeModelReference)warnings.push(`SCREENED_OUT_BEFORE_MODEL_REFERENCE:${screenedOutBeforeModelReference}`);
  let routeCatalog:RouteCatalog|null=null;
  try {
    const loaded=await loadReference<RouteCatalog>('routes.json');
    if(loaded.schemaVersion!==1||!Array.isArray(loaded.routes))throw new Error();
    routeCatalog=loaded;
  } catch {warnings.push('ROUTE_REFERENCE_UNAVAILABLE');}
  let uiRestored=research.uiRestored;
  let market:Awaited<ReturnType<typeof readMarketPriceReferences>>={fuel:null,co2:null,uiClosed:true,stage:'not_requested',warnings:[],unitLabels:[]};
  let maintenance:Awaited<ReturnType<typeof readAircraftMaintenanceReferences>>={status:'not_requested',stage:'not_requested',observedAt:new Date().toISOString(),complete:false,uiClosed:true,aircraft:[],warnings:[]};
  let financeHistory=emptyFinanceHistory();
  // Market and maintenance sources must be validated even when no aircraft is eligible for research.
  if(research.config.enabled&&uiRestored){
    const ids=[...new Set(economicQuotes.flatMap(q=>q.autopriceReference?[q.autopriceReference.modelId]:[]))];
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
  const fresh=(stamp:string)=>freshAt(stamp,now);
  const candidates=quotes.map(quote=>{
    const demand=candidateDemandEvidence(quote,collection,now,reservationsConfig.maxAgeSeconds);
    const model=models.find(m=>m.modelId===quote.autopriceReference?.modelId)||null;
    const reservations=candidateReservationScenario(quote,collection,now,reservationsConfig);
    const aircraft=collection.aircraft.find(a=>a.aircraftId===quote.aircraftId);
    const capacity=capacityFor(quote,now);
    const screening=screeningByQuote.get(quote)!;
    const costScenarios=candidateCostScenarios(quote,capacity,reservations.forwardAfterReservations,
      {fuel:market.fuel,co2:market.co2,model,maintenance:maintenance.aircraft.find(a=>a.aircraftId===quote.aircraftId)||null},now,reservationsConfig.maxAgeSeconds);
    const effectiveCosts=effectiveCostBudget(quote,{},now,reservationsConfig.maxAgeSeconds);
    const roundTrip=buildCandidateRoundTripScreen(quote,routeCatalog,reservations,now,reservationsConfig.maxAgeSeconds);
    const fuel=market.fuel&&fresh(market.fuel.observedAt)&&fresh(quote.observedAt)?quote.fuelLbs*market.fuel.pricePer1000/1000:null;
    const priority=candidatePriorityReference(quote,screening,costScenarios);
    return {aircraftId:quote.aircraftId,from:quote.from,to:quote.to,quoteObservedAt:quote.observedAt,
      createControl:quote.createControl||null,routeActionDiagnostics:quote.routeActionDiagnostics||[],routeListenerDiagnostics:quote.routeListenerDiagnostics||[],routeMutationControl:quote.routeMutationControl||null,autopriceFunctionEvidence:quote.autopriceFunctionEvidence||null,quoteFieldDiagnostics:quote.quoteFieldDiagnostics||[],routeDirectionEvidence:quote.routeDirectionEvidence||null,demand,screening,priority,roundTrip,reservations,costScenarios,effectiveCosts,modelCostReference:model,costs:{fuelAtObservedMarketPrice:fuel,co2:null,maintenance:null,airportAndOther:null},
      setupFee:quote.routeFee,costsComplete:false,netProfit:null,comparisonReady:false,mutationAuthorized:false,
      missing:['FUTURE_OTHER_AIRCRAFT_RESERVATIONS','REVERSE_LEG_ECONOMICS','EFFECTIVE_FARES_AND_LOAD_FACTOR',
        'CO2_QUOTA_CONVERSION','AIRCRAFT_EFFECTIVE_MAINTENANCE','AIRPORT_AND_OTHER_COSTS','FUTURE_SCHEDULE_AND_RESET',
        ...(!demand.remaining?['DIRECTIONAL_REMAINING_DEMAND']:[]),...(fuel===null?['FUEL_MARKET_PRICE']:[])]};
  });
  const priorityRanking=rankCandidatePriorities(candidates);
  const routeReadiness=summarizeComparisonReadiness(candidates);
  return {schemaVersion:7,generatedAt:now.toISOString(),dryRun:true,mutationAuthorized:false,comparisonReady:false,
    uiRestored,screenedOutBeforeModelReference,market,models,modelReads,maintenance,financeHistory,priorityRanking,routeReadiness,
    warnings:[...warnings,...maintenance.warnings,...financeHistory.warnings],candidates};
}
export async function writeCandidateDataReport(report:Awaited<ReturnType<typeof collectCandidateData>>,directory='test-results/demand'){
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'candidate-data.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(directory,'finance-history.json'),JSON.stringify(report.financeHistory,null,2)+'\n');
  await writeFile(join(directory,'candidate-data.md'),['# Evidencias das candidatas — simulacao','',
    ...(report.priorityRanking.length?[
      '## Ranking de referencia entre candidatas observadas','',
      ...report.priorityRanking.map(r=>`- #${r.rank} ${r.from}–${r.to}: teto de contribuicao conhecida/h ${r.recurringKnownContributionCeilingPerHour.toFixed(2)}; teto do primeiro ciclo apos taxa ${r.firstCycleKnownContributionCeiling.toFixed(2)}.`),
      '',
      'Ranking apenas para priorizar pesquisa: usa teto de receita, combustivel a preco de reposicao e prorata de A-check do catalogo. Nao e lucro liquido nem autoriza reroute.',''
    ]:[]),
    ...(report.routeReadiness.candidates.length?[
      '## Prontidao para comparacao e reroute','',
      ...report.routeReadiness.candidates.map(r=>`- ${r.aircraftId} ${r.from}–${r.to}: comparacao ${r.comparisonReady?'pronta':'bloqueada'}; bloqueios ${r.comparisonBlockers.join(', ')||'nenhum'}; mutacao ${r.mutationReady?'pronta':'bloqueada'}; bloqueios ${r.mutationBlockers.join(', ')||'nenhum'}.`),
      '',
      'Este gate apenas consolida evidencias. mutationAuthorized permanece false ate existir comparacao completa e executor nativo verificado.',''
    ]:[]),
    ...report.candidates.map(c=>`- ${c.aircraftId} ${c.from}–${c.to}: triagem ${c.screening.demandStatus}, teto de cobertura ${c.screening.coverageCeilingPercent===null?'indisponivel':c.screening.coverageCeilingPercent.toFixed(2)+'%'}, teto de receita/decolagem ${c.screening.grossRevenueCeilingPerDeparture??'indisponivel'}, prioridade ${c.priority.status==='rankable'?c.priority.recurringKnownContributionCeilingPerHour?.toFixed(2)+'/h':'indisponivel'}; Create route ${c.createControl?.observed?'observado':'nao observado'}, endpoints ${c.createControl?.phpEndpoints?.join(', ')||'nenhum'}, shape ${c.createControl?.onclickShape||'indisponivel'}; controles inspecionados ${c.routeActionDiagnostics.length}: ${c.routeActionDiagnostics.map(a=>[a.tag,a.id||'',a.label||'',a.phpEndpoints.join('+')||'',a.callbackShape||a.hrefShape||''].filter(Boolean).join(' ')).join(' || ')||'nenhum'}; listeners ${c.routeListenerDiagnostics.length}: ${c.routeListenerDiagnostics.map(a=>[a.scope,a.event,a.elementTag||'',a.elementId||'',a.elementLabel||'',a.phpEndpoints.join('+')||'',a.handlerShape||''].filter(Boolean).join(' ')).join(' || ')||'nenhum'}; Create route validado ${c.routeMutationControl?.nativeClickReady?'sim':'nao'}; endpoint ${c.routeMutationControl?.endpointVerified?'ok':'nao'}; aeronave ${c.routeMutationControl?.aircraftIdMatchesContext?'ok':'nao'}; aeroporto ${c.routeMutationControl?.airportIdMatchesContext?'ok':'nao'}; Autoprice funcao ${c.autopriceFunctionEvidence?.observed?'observada':'indisponivel'}, rede ${c.autopriceFunctionEvidence?.networkMutationObserved?'detectada':'nao detectada'}, modelos ${c.autopriceFunctionEvidence?.modelIds?.join('+')||'nenhum'}; campos operacionais ${c.quoteFieldDiagnostics.map(f=>[f.id||'',f.label||'',f.title||''].filter(Boolean).join(' ')).join(' || ')||'nenhum'}; ciclo ${c.roundTrip.status}, volta ${c.roundTrip.returnLeg.from}–${c.roundTrip.returnLeg.to}, demanda restante volta ${JSON.stringify(c.roundTrip.returnLeg.remainingAfterReservations)}, bloqueios ciclo ${c.roundTrip.blockers.join(', ')}; demanda restante ida ${c.demand.status}; reservas ${c.reservations.status} (${c.reservations.reservations.length} trechos); saldo simulado ida ${JSON.stringify(c.reservations.forwardAfterReservations)}; combustivel ao preco observado ${c.costs.fuelAtObservedMarketPrice??'indisponivel'}; CO2 de referencia ${c.costScenarios.co2.atDemandCeiling??'indisponivel'}; A-check de referencia ${c.costScenarios.aCheck.catalogProration??'indisponivel'}; custos efetivos faltantes ${c.effectiveCosts.missing.join(', ')}; pendencias ${c.missing.join(', ')}.`),'',
    `Candidatas descartadas antes da consulta de referencia por nao atingirem o limite nem no teto diario: ${report.screenedOutBeforeModelReference}.`,'',
    `Manutencao: ${report.maintenance.status}; referencias individuais ${report.maintenance.aircraft.length}. Reservas sao cenarios limitados de capacidade antes da candidata; nao sao previsao de horarios nem reservas feitas no jogo.`,
    `Historico financeiro: ${report.financeHistory.status}; lancamentos visiveis ${report.financeHistory.transactions.length}. Compras observadas sao referencias de pagamentos; nao comprovam custo medio do estoque, despesa por trecho ou historico completo.`,
    'Referencia de A-check do catalogo nao confirma o custo efetivo da aeronave. Preco de mercado nao confirma o custo de aquisicao do estoque. Taxa de criacao nao e custo recorrente. Nenhum lucro liquido ou troca de rota autorizado.',
    ...report.warnings.map(w=>'- '+w),''].join('\n'));
}
