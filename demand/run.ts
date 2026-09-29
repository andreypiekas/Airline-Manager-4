import { Page } from '@playwright/test';
import { readDemandConfig } from './config';
import { DemandManager } from './manager';
import { DemandReader } from './reader';
import { writeDemandReport } from './report';
import { DemandConfig, DemandReport } from './types';

export async function runDemandSimulation(page: Page, config: DemandConfig = readDemandConfig()): Promise<DemandReport> {
  const collection = await new DemandReader(page).collect();
  const report = new DemandManager(config).analyze(collection);
  await writeDemandReport(report);
  if (!report.collectionComplete) throw new Error('[Demand] Coleta incompleta. Relatorio salvo; nenhuma decolagem autorizada.');
  return report;
}
