import { RouteReview } from '../optimization/route-optimizer';
import { analyzeOptimizationWithJournal, optimizationConfig, writeOptimizationReport } from '../optimization/report';
import { Page } from '@playwright/test';
import { readDemandConfig } from './config';
import { DemandManager } from './manager';
import { DemandReader } from './reader';
import { writeDemandReport } from './report';
import { DemandConfig, DemandReport } from './types';

export async function runDemandSimulation(page: Page, config: DemandConfig = readDemandConfig(), reviews: Record<string, RouteReview> = {}): Promise<DemandReport> {
  const optimization = optimizationConfig();
  const collection = await new DemandReader(page).collect();
  const report = new DemandManager(config).analyze(collection);
  await writeDemandReport(report);
  await writeOptimizationReport(await analyzeOptimizationWithJournal(collection, optimization, reviews));
  if (!report.collectionComplete) throw new Error('[Demand] Coleta incompleta. Relatorio salvo; nenhuma decolagem autorizada.');
  return report;
}
