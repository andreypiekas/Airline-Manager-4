import { researchConfig, researchFleetCandidates, writeRouteResearchReport } from '../optimization/research-reader';
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

export async function runDemandSimulation(page: Page, config: DemandConfig = readDemandConfig(), reviews: Record<string, RouteReview> = {}): Promise<DemandReport> {
  const optimization = optimizationConfig();
  const research = researchConfig();
  const collection = await new DemandReader(page, 10000, true).collect();
  const report = new DemandManager(config).analyze(collection);
  await writeDemandReport(report);
  await writeOccupancyAudit(collection, config);
  await writeFleetObservations(collection, optimization.aircraftOrigins, 'test-results/demand', config.maxAgeSeconds, optimization.airlineBases);
  await writeReferenceReport(collection, optimization);
  await writeOptimizationReport(await analyzeOptimizationWithJournal(collection, optimization, reviews));
  await writeRouteResearchReport(await researchFleetCandidates(page, collection, optimization, research));
  if (!report.collectionComplete) throw new Error('[Demand] Coleta incompleta. Relatorio salvo; nenhuma decolagem autorizada.');
  return report;
}
