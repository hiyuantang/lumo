// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';

if (!process.env.LUMO_TEST_URL || !process.env.LUMO_TEST_CONTAINER) {
  throw new Error('Run npm run test:docker to create a disposable Ubuntu environment.');
}

export default defineConfig({
  testDir: './tests/docker',
  outputDir: process.env.LUMO_TEST_OUTPUT,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.LUMO_TEST_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'ubuntu-chromium', use: { ...devices['Desktop Chrome'] } }],
});
