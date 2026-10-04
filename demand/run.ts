import { collectCandidateData, writeCandidateDataReport, researchConfig, researchFleetCandidates, writeRouteResearchReport } from '../optimization/research-reader';
import { writeOccupancyAudit } from './occupancy-audit';
import { writeReferenceReport } from '../optimization/reference-report';
import { RouteReview } from '../optimization/route-optimizer';
import { writeFleetObservations } from '../optimization/fleet-observations';
import { analyzeOptimizationWithJournal, optimizationConfig, writeOptimizationReport } from '../optimization/report';
import { Page } from '@playwright/test';
import { readDemandConfig } from './config';
import { DemandManager } from './manager';
import { DemandReader } from './reader';
import { writeDemandReport } from './report';
import { DemandConfig, DemandReport } from './types';
import { loadAdaptiveDemandThresholds } from './adaptive-threshold';
import { appendFlightHistoryAnchors, appendObservedArrivals, readFlightHistoryContinuityDiagnostics, readFlightHistoryStitchDiagnostics, readLiveAnchoredFlightHistoryStitchDiagnostics } from '../optimization/return-journal';
import { writeFile } from 'node:fs/promises';

export async function runDemandSimulationDetailed(page: Page, config: DemandConfig = readDemandConfig(), reviews: Record<string, RouteReview> = {}) {
  const optimization = optimizationConfig();
  const research = researchConfig();
  const collection = await new DemandReader(page, 10000, true).collect();
  if(optimization.returnJournal){
    const arrivals=await appendObservedArrivals(optimization.returnJournal.directory,optimization.returnJournal.scope,collection);
    if(arrivals)console.log('[History] Chegadas observadas acrescentadas: '+arrivals+'.');
  }
  const adaptive=optimization.returnJournal?await loadAdaptiveDemandThresholds(optimization.returnJournal.directory,optimization.returnJournal.scope,config.minPercentage):new Map();
  const report = new DemandManager({...config,dryRun:true},adaptive).analyze(collection);
  await writeDemandReport(report);
  await writeOccupancyAudit(collection, config);
  await writeFleetObservations(collection, optimization.aircraftOrigins, 'test-results/demand', config.maxAgeSeconds, optimization.airlineBases);
  await writeReferenceReport(collection, optimization);
  await writeOptimizationReport(await analyzeOptimizationWithJournal(collection, optimization, reviews));
  const researchReport=await researchFleetCandidates(page, collection, optimization, research);
  await writeRouteResearchReport(researchReport);
  const liveStitches=optimization.returnJournal
    ? await readLiveAnchoredFlightHistoryStitchDiagnostics(optimization.returnJournal.directory,optimization.returnJournal.scope,collection.aircraft)
    : [];
  const candidateData=await collectCandidateData(page,collection,researchReport,optimization.minOccupancy,liveStitches);
  await writeCandidateDataReport(candidateData);
  if(optimization.returnJournal&&/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID||'')){
    const anchors=await appendFlightHistoryAnchors(optimization.returnJournal.directory,optimization.returnJournal.scope,process.env.GITHUB_RUN_ID!,collection,candidateData.flightHistoryCoverage);
    console.log('[History] Ancoras compactas de Flight History acrescentadas: '+anchors+'.');
    const continuity=await readFlightHistoryContinuityDiagnostics(optimization.returnJournal.directory,optimization.returnJournal.scope);
    await writeFile('test-results/demand/flight-history-continuity.json',JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),diagnostics:continuity},null,2)+'\n');
    await writeFile('test-results/demand/flight-history-continuity.md',['# Continuidade persistente do Flight History','',...(continuity.length?continuity.map(x=>`- ${x.aircraftId}: ${x.status}; sobreposicao ${x.overlapRows}; delta de ciclos ${x.cycleDelta??'n/d'}; motivo ${x.reason}.`):['Nenhum par de snapshots persistidos disponivel neste run.']),'','_Somente evidencia de continuidade. comparisonReady e mutationAuthorized permanecem false._',''].join('\n'));
    const stitches=await readFlightHistoryStitchDiagnostics(optimization.returnJournal.directory,optimization.returnJournal.scope);
    await writeFile('test-results/demand/flight-history-stitch.json',JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),diagnostics:stitches},null,2)+'\n');
    await writeFile('test-results/demand/flight-history-stitch.md',['# Stitched Flight History persistente — diagnostico','',...(stitches.length?stitches.map(x=>`- ${x.aircraftId}: ${x.status}; anchors usados ${x.anchorsUsed}/${x.anchorsAvailable}; links verificados ${x.linksVerified}; linhas compostas ${x.rowsStitched}; idade inferior da linha mais antiga ${x.oldestAgeLowerMinutes??'n/d'} min; motivo ${x.reason}${x.stoppedReason?'; limite '+x.stoppedReason:''}.`):['Nenhuma cadeia persistida disponivel neste run.']),'','_Diagnostico somente leitura. Ainda nao altera remaining demand; comparisonReady e mutationAuthorized permanecem false._',''].join('\n'));
    await writeFile('test-results/demand/flight-history-live-stitch.json',JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),diagnostics:liveStitches},null,2)+'\n');
    await writeFile('test-results/demand/flight-history-live-stitch.md',['# Stitched Flight History ancorado no snapshot live — diagnostico','',...(liveStitches.length?liveStitches.map(x=>`- ${x.aircraftId}: ${x.status}; live ${x.liveAnchorVerified?'verificado':'indisponivel'}; anchors persistidos ${x.persistedAnchorsAvailable}; usados ${x.anchorsUsed}; links ${x.linksVerified}; linhas ${x.rowsStitched}; idade inferior mais antiga ${x.oldestAgeLowerMinutes??'n/d'} min; motivo ${x.reason}${x.stoppedReason?'; limite '+x.stoppedReason:''}.`):['Nenhuma aeronave disponivel neste run.']),'','_Snapshot live obrigatorio. Cadeias verificadas podem complementar somente a cobertura historica do ledger de demanda; o stitch continua com comparisonReady=false e mutationAuthorized=false e nunca autoriza reroute isoladamente._',''].join('\n'));
  }
  if(!candidateData.uiRestored)throw new Error('[Demand] Painel nao restaurado apos consulta; nenhuma operacao autorizada.');
  if (!report.collectionComplete) throw new Error('[Demand] Coleta incompleta. Relatorio salvo; nenhuma decolagem autorizada.');
  return {report,collection,researchReport,candidateData};
}

export type DemandSimulationContext=Awaited<ReturnType<typeof runDemandSimulationDetailed>>;

export async function runDemandSimulation(
  page: Page,
  config: DemandConfig = readDemandConfig(),
  reviews: Record<string, RouteReview> = {}
): Promise<DemandReport> {
  return (await runDemandSimulationDetailed(page,config,reviews)).report;
}
