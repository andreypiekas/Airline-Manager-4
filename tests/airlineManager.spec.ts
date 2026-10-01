import { runSupplies } from '../supplies/run';
import { supplyConfig } from '../supplies/policy';
import { researchConfig } from '../optimization/research-reader';
import { optimizationConfig } from '../optimization/report';
import { readDemandConfig } from '../demand/config';
import { runDemandSimulation } from '../demand/run';
import { executionEnvironment, runDemandExecution } from '../demand/execute-run';
import { withRunLock } from '../utils/run-lock';
import { loginForReadOnlyCollection } from '../utils/read-only-login';
import { test } from '@playwright/test';
import { GeneralUtils } from '../utils/general.utils';
import { FuelUtils } from '../utils/fuel.utils';
import { CampaignUtils } from '../utils/campaign.utils';
import { FleetUtils } from '../utils/fleet.utils';
import { MaintenanceUtils } from '../utils/maintenance.utils';
import * as fs from 'fs';
import * as path from 'path';

require('dotenv').config();

test('All Operations', async ({ page }) => {
  await withRunLock(async () => {
  const demandConfig = readDemandConfig();
  if (demandConfig.enabled) {
    executionEnvironment(demandConfig);
    supplyConfig(); // Validate purchase policy before login.
    optimizationConfig(); // Reject invalid optimization settings before login.
    researchConfig();
    test.setTimeout(demandConfig.dryRun ? 600000 : 900000);
    await loginForReadOnlyCollection(page,process.env,90000);
    await runSupplies(page,demandConfig.dryRun);
    const fleetMenu=page.locator('#mapRoutes');
    if(await fleetMenu.count()!==1||!await fleetMenu.isVisible()||
      (await fleetMenu.getAttribute('onclick')||'').replace(/\s/g,'')!=="hideAllWhenClick();menuFleet('Routes');")
      throw new Error('[Demand] Menu Fleet nao confirmado; nenhuma operacao autorizada.');
    await fleetMenu.click();
    await runDemandSimulation(page, demandConfig);
    if (!demandConfig.dryRun && (process.env.ENABLE_DEPART || 'true').trim().toLowerCase() === 'true') {
      await runDemandExecution(page,demandConfig);
    }
    return; // Supplies use the bounded module above; legacy maintenance/campaign/bulk operations remain bypassed.
  }
  // Timeout 3 menit karena simulasi gerakan kursor dan delay manusia butuh waktu lebih lama
  test.setTimeout(600000);

  // ==============================================================
  // ⏱️ LOGIKA AUTOMATIC KEEPALIVE LOG (.TXT) - HANYA 1X DI TANGGAL 1
  // ==============================================================
  const hariIni = new Date();
  const tanggalUTC = hariIni.getUTCDate();

  if (tanggalUTC === 1) {
    const formatBulanIni = `${hariIni.getUTCFullYear()}-${String(hariIni.getUTCMonth() + 1).padStart(2, '0')}`;
    const logFilePath = path.join(__dirname, '../last-commit.txt'); 

    let sudahCommitBulanIni = false;

    if (fs.existsSync(logFilePath)) {
      const isiLog = fs.readFileSync(logFilePath, 'utf8');
      if (isiLog.includes(formatBulanIni)) {
        sudahCommitBulanIni = true;
      }
    }

    if (!sudahCommitBulanIni) {
      console.log(`[Keepalive] Primeira execucao do dia 1 detectada. Atualizando registro do mes: ${formatBulanIni}`);
      const kontenLogBaru = `Last Successful Keepalive Commit: ${formatBulanIni} (Executed at: ${hariIni.toISOString()} WIB/UTC)\n`;
      fs.writeFileSync(logFilePath, kontenLogBaru, 'utf8');
      console.log("[Keepalive] Arquivo last-commit.txt atualizado. O workflow registrara o commit.");
    } else {
      console.log(`[Keepalive] Bot ja registrou atividade no mes ${formatBulanIni}; nenhuma atualizacao necessaria.`);
    }
  } else {
    console.log(`[Keepalive] Hoje e dia ${tanggalUTC} UTC. Atualizacao mensal dispensada.`);
  }
  // ==============================================================

  // Variable Initialization
  const fuelUtils = new FuelUtils(page);
  const generalUtils = new GeneralUtils(page);
  const campaignUtils = new CampaignUtils(page);
  const fleetUtils = new FleetUtils(page);
  const maintenanceUtils = new MaintenanceUtils(page);
  // End //

  /**
   * FIX KOREKSI 1: Mengubah penutupan menu area kosong atas layar menjadi human-like.
   * Menggunakan fungsi pergerakan mouse melengkung dan mengacak durasi klik (bukan teleportasi kaku).
   */
  const clickBlankSpaceTop = async () => {
    console.log('Clicando fora do painel para fechar o menu...');
    const randomX = Math.floor(Math.random() * (600 - 200 + 1) + 200);
    const randomY = Math.floor(Math.random() * (30 - 15 + 1) + 15);
    
    // Gunakan fungsi mouse melengkung dari GeneralUtils
    await GeneralUtils.humanMouseMove(page, randomX, randomY);
    await GeneralUtils.randomSleep(150, 400); // Jeda sesaat ancang-ancang sebelum ketuk layar
    
    await page.mouse.down();
    await GeneralUtils.randomSleep(80, 180); // Durasi tahan klik bervariasi
    await page.mouse.up();
  };

  // Kumpulan lokator ubin menu utama di peta untuk pancingan anti-freeze
  const menuTiles: Record<string, import('@playwright/test').Locator> = {
    fuel: page.locator('#mapMaint > img').first(),
    maintenance: page.locator('div:nth-child(4) > #mapMaint > img'),
    campaign: page.locator('div:nth-child(5) > #mapMaint > img'),
    depart: page.locator('#mapRoutes').getByRole('img')
  };

  // Fungsi pembantu untuk membuka-tutup menu lain secara acak jika modul utama freeze/lag
  const triggerRandomMenuPoke = async (currentMenuKey: string) => {
    const keys = Object.keys(menuTiles).filter(key => key !== currentMenuKey);
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    
    console.log(`[Recuperacao] Tentando atualizar a interface por meio do menu [${randomKey}]...`);
    await clickBlankSpaceTop();
    await GeneralUtils.randomSleep(1000, 1800);
    
    // FIX KOREKSI 2: Upgrade klik ubin pancingan menjadi moveAndClick yang acak area amannya
    await GeneralUtils.moveAndClick(page, menuTiles[randomKey]);
    await GeneralUtils.randomSleep(2000, 3500);
    
    // Keluar seketika tanpa melakukan operasi apa pun di dalamnya
    await clickBlankSpaceTop();
    await GeneralUtils.randomSleep(1200, 2000);
  };

  // 1. Login (Bypass Stealth & Keystroke Dynamics terpusat)
  await generalUtils.login(page);
  await GeneralUtils.randomSleep(5000, 8000);

  // ==================== DEFINISI FUNGSI MODUL ====================

  const runFuel = async (attempt = 1) => {
    console.log(`[Operacao] Iniciando combustivel e CO2 (tentativa ${attempt})...`);
    const currentBalance = await fuelUtils.getCurrentBalance();
    console.log('[Operacao] Saldo antes de abrir combustivel: ' + currentBalance);

    // FIX KOREKSI 3: Buka ubin menu Fuel dengan pergerakan kursor melengkung acak
    await GeneralUtils.moveAndClick(page, menuTiles.fuel);
    await GeneralUtils.randomSleep(2000, 4000);

    try {
      // Validasi penanda halaman fuel sukses dimuat
      await page.getByPlaceholder('Amount to purchase').waitFor({ state: 'visible', timeout: 8000 });
    } catch (error) {
      console.log('[Operacao] Painel de combustivel nao abriu ou travou.');
      if (attempt < 2) {
        await triggerRandomMenuPoke('fuel');
        await runFuel(attempt + 1);
        return;
      } else {
        throw new Error('Painel de combustivel nao carregou apos nova tentativa.');
      }
    }
    
    await fuelUtils.buyFuel();
    await GeneralUtils.randomSleep(1500, 3000);

    // FIX KOREKSI 4: Klik tab CO2 secara human-like
    const co2TabButton = page.getByRole('button', { name: ' Co2' });
    await GeneralUtils.moveAndClick(page, co2TabButton);
    await GeneralUtils.randomSleep(2000, 4000);
    
    await fuelUtils.buyCo2();
    await GeneralUtils.randomSleep(1500, 3000);

    await clickBlankSpaceTop();
    console.log('[Operacao] Combustivel e CO2 finalizados.');
  };

  const runMaintenance = async (attempt = 1) => {
    console.log(`[Operacao] Iniciando manutencao e reparos (tentativa ${attempt})...`);
    await clickBlankSpaceTop();
    await GeneralUtils.randomSleep(1000, 1800);

    // FIX KOREKSI 5: Buka ubin menu Maintenance secara human-like
    await GeneralUtils.moveAndClick(page, menuTiles.maintenance);

    try {
      await page.getByRole('button', { name: ' Plan' }).waitFor({ state: 'visible', timeout: 15000 });
    } catch (error) {
      console.log('[Operacao] Painel de manutencao nao abriu ou travou.');
      if (attempt < 2) {
        await triggerRandomMenuPoke('maintenance');
        await runMaintenance(attempt + 1);
        return;
      } else {
        throw new Error('Painel de manutencao nao carregou apos nova tentativa.');
      }
    }

    await GeneralUtils.randomSleep(1200, 2200);
    await maintenanceUtils.checkPlanes();
    await GeneralUtils.randomSleep(2000, 4000);
    
    await maintenanceUtils.repairPlanes();
    await GeneralUtils.randomSleep(2000, 4000);

    await clickBlankSpaceTop();
    console.log('[Operacao] Manutencao finalizada.');
  };

  const runCampaign = async (attempt = 1) => {
    console.log(`[Operacao] Iniciando campanhas antes das decolagens (tentativa ${attempt})...`);
    
    // FIX KOREKSI 6: Buka ubin menu Kampanye secara human-like
    await GeneralUtils.moveAndClick(page, menuTiles.campaign);
    await GeneralUtils.randomSleep(2500, 4500);

    try {
      // Pastikan tombol internal marketing siap diakses
      await page.getByRole('button', { name: ' Marketing' }).waitFor({ state: 'visible', timeout: 8000 });
    } catch (error) {
      console.log('[Operacao] Painel de campanhas nao abriu ou travou.');
      if (attempt < 2) {
        await triggerRandomMenuPoke('campaign');
        await runCampaign(attempt + 1);
        return;
      } else {
        throw new Error('Painel de campanhas nao carregou apos nova tentativa.');
      }
    }
    
    await campaignUtils.createCampaign();
    await GeneralUtils.randomSleep(1500, 3000);

    await clickBlankSpaceTop();
    console.log('[Operacao] Campanhas finalizadas.');
  };

  const runDepart = async () => {
    console.log('[Operacao] Iniciando decolagem de todas as aeronaves...');

    await clickBlankSpaceTop();
    await GeneralUtils.randomSleep(1000, 2000);

    try {
      await GeneralUtils.moveAndClick(page, menuTiles.depart, 20000);
      await GeneralUtils.randomSleep(2000, 3000);

      await fleetUtils.departPlanes();
      console.log('[Operacao] Comando de decolagem executado. Confira a frota.');
    } catch (error) {
      console.error('[Operacao] FALHA NAS DECOLAGENS:', error);
      await page.screenshot({
        path: 'test-results/depart-error.png',
        fullPage: true
      });
      throw error;
    }

    await clickBlankSpaceTop();
  };

  // ==================== LOGIKA PENGACAKAN SEMI-STATIS ====================
  const initialTasks = [runFuel, runMaintenance];

  // Acak urutan antara Fuel atau Maintenance duluan
  for (let i = initialTasks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [initialTasks[i], initialTasks[j]] = [initialTasks[j], initialTasks[i]];
  }

  // Modulos podem ser desligados em Settings > Secrets and variables > Actions.
  // Variavel ausente significa ativado, preservando o comportamento existente.
  const enabled = (name: string) =>
    !['false', '0', 'off', 'no'].includes((process.env[name] || '').trim().toLowerCase());

  const flags = {
    fuel: enabled('ENABLE_FUEL'),
    maintenance: enabled('ENABLE_MAINTENANCE'),
    campaign: enabled('ENABLE_CAMPAIGN'),
    depart: enabled('ENABLE_DEPART'),
  };
  console.log('[Configuracao] Modulos ativados:', JSON.stringify(flags));

  // Usar test.step facilita identificar a etapa que falhou nos relatorios.
  console.log('--- Iniciando operacoes da companhia aerea ---');
  const selectedTasks = initialTasks.filter(task =>
    (task === runFuel && flags.fuel) ||
    (task === runMaintenance && flags.maintenance)
  );

  for (const task of selectedTasks) {
    const name = task === runFuel ? 'Combustivel e CO2' : 'Manutencao';
    await test.step(name, async () => await task());
    await GeneralUtils.randomSleep(5000, 9000);
  }

  if (flags.campaign) {
    await test.step('Campanhas', async () => await runCampaign());
    await GeneralUtils.randomSleep(5000, 8000);
  } else {
    console.log('[Configuracao] Campanhas desativadas.');
  }

  if (flags.depart) {
    await test.step('Decolagens', async () => await runDepart());
  } else {
    console.log('[Configuracao] Decolagens desativadas.');
  }

  console.log('--- Rotina de operacoes concluida ---');
  await GeneralUtils.randomSleep(1000, 2000);
  await page.close();
  });
});
