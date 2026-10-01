import { readDemandConfig } from '../demand/config';
import { runDemandSimulation } from '../demand/run';
import { runDemandExecution } from '../demand/execute-run';
import { Page } from '@playwright/test';

export class FleetUtils {
  constructor(private readonly page: Page) {}

  public async departPlanes(): Promise<void> {
    const config = readDemandConfig();
    if (config.enabled) {
      await runDemandSimulation(this.page, config);
      if (!config.dryRun && (process.env.ENABLE_DEPART || 'true').trim().toLowerCase() === 'true') await runDemandExecution(this.page,config);
      return; // No fallback to departAll, including on unavailable demand.
    }
    console.log('[Depart] Aguardando botao de decolagem...');

    const button = this.page.locator('#departAll');

    try {
      await button.waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      await this.page.screenshot({
        path: 'test-results/depart-button-missing.png',
        fullPage: true
      });
      throw new Error(
        '[Depart] Botao #departAll nao encontrado. ' +
        'Verifique se o painel Routes abriu e se existem aeronaves prontas.'
      );
    }

    let clicks = 0;
    for (let attempt = 1; attempt <= 8; attempt++) {
      if (!(await button.isVisible())) {
        console.log('[Depart] Botao nao esta mais visivel.');
        break;
      }
      if (!(await button.isEnabled())) {
        console.log('[Depart] Botao desabilitado.');
        break;
      }

      console.log(`[Depart] Tentativa ${attempt}/8`);
      await button.click({ timeout: 10000 });
      clicks++;
      await this.page.waitForTimeout(2500);

      const error = this.page.getByText(/Unable to depart|Some A\/C was/i);
      if (await error.first().isVisible()) {
        console.warn('[Depart] Jogo informou que alguns avioes nao podem decolar.');
        break;
      }
    }

    await this.page.screenshot({
      path: 'test-results/depart-result.png',
      fullPage: true
    });
    console.log(`[Depart] Total de cliques: ${clicks}`);
    console.log('[Depart] Verifique a frota para confirmar as decolagens.');
  }
}
