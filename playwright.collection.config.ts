import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/live',testMatch:'read-only-collection.spec.ts',
  fullyParallel:false,workers:1,retries:0,timeout:600000,
  forbidOnly:!!process.env.CI,reporter:'list',outputDir:'test-results/collection-run',
  use:{trace:'off',screenshot:'off',video:'off',actionTimeout:30000,navigationTimeout:30000},
});
