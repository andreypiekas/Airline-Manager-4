import { test,expect } from '@playwright/test';
import { readDemandConfig } from '../../demand/config';
import { executionEnvironment,runDemandExecution } from '../../demand/execute-run';
import { loginForReadOnlyCollection } from '../../utils/read-only-login';
import { withRunLock } from '../../utils/run-lock';

test('executor individual — escopo controlado, sem compras ou alteracoes de rota',async({page})=>{
 await withRunLock(async()=>{
  const config=readDemandConfig();executionEnvironment(config); // Reject before entering credentials.
  await loginForReadOnlyCollection(page,process.env,90000);
  const report=await runDemandExecution(page,config);
  expect(report.halted).toBe(false);
  expect(report.summary.departed).toBeLessThanOrEqual(Number(process.env.DEMAND_MAX_DEPARTURES_PER_RUN||'1'));
 });
});
