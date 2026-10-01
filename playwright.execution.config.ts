import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/live',testMatch:'individual-departure.spec.ts',fullyParallel:false,
 workers:1,retries:0,timeout:900000,forbidOnly:!!process.env.CI,reporter:'list',outputDir:'test-results/execution-run',
 use:{trace:'off',screenshot:'off',video:'off',actionTimeout:30000,navigationTimeout:30000},
});
