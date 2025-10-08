/**
 * Playwright Configuration for Aether Netron E2E Tests
 *
 * Tests real-world scenarios of browser Netron client connecting to Titan backend.
 * Validates HTTP and WebSocket transports, streams, and advanced features.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }]
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL for the test server
    baseURL: 'http://localhost:3456',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Timeout for each action
    actionTimeout: 10000,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Run Titan test server before tests
  webServer: [
    {
      command: 'tsx e2e/fixtures/titan-app/index.ts',
      url: 'http://localhost:3335/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npx http-server e2e/pages -p 3456 --cors',
      url: 'http://localhost:3456',
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
  ],

  // Test timeout
  timeout: 60000,

  // Global timeout
  globalTimeout: 600000,
});
