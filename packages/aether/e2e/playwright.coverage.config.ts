import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3456',
    trace: 'on-first-retry',

    // Enable coverage collection
    viewport: { width: 1280, height: 720 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npx http-server /Users/taaliman/projects/omnitron-dev/omni/packages/aether/e2e/pages -p 3456 --cors',
    port: 3456,
    reuseExistingServer: !process.env.CI,
  },
});
