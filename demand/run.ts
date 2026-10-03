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

export async function runDemandSimulationDetailed(page: Page, config: DemandConfig = readDemandConfig(), reviews: Record<string, RouteReview> = {}) {
  const optimization = optimizationConfig();
  const research = researchConfig();
  const collection = await new DemandReader(page, 10000, true).collect();
  const adaptive=optimization.returnJournal?await loadAdaptiveDemandThresholds(optimization.returnJournal.directory,optimization.returnJournal.scope,config.minPercentage):new Map();
  const report = new DemandManager({...config,dryRun:true},adaptive).analyze(collection);
  await writeDemandReport(report);
  await writeOccupancyAudit(collection, config);
  await writeFleetObservations(collection, optimization.aircraftOrigins, 'test-results/demand', config.maxAgeSeconds, optimization.airlineBases);
  await writeReferenceReport(collection, optimization);
  await writeOptimizationReport(await analyzeOptimizationWithJournal(collection, optimization, reviews));
  const researchReport=await researchFleetCandidates(page, collection, optimization, research);
  await writeRouteResearchReport(researchReport);
  const candidateData=await collectCandidateData(page,collection,researchReport,optimization.minOccupancy);
  await writeCandidateDataReport(candidateData);
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
