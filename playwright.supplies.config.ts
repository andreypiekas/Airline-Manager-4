import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/live',testMatch:'supplies-probe.spec.ts',workers:1,retries:0,timeout:180000,reporter:'list',use:{trace:'off',video:'off',screenshot:'off'}});
