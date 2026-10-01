import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/unit', fullyParallel: false, workers: 1, retries: 0,
  forbidOnly: !!process.env.CI, reporter: 'list', outputDir: 'test-results/unit',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
