import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for Prism Design System
 *
 * This config supports both:
 * - Component Testing: Testing individual MUI components in isolation
 * - E2E Testing: Testing full integration scenarios
 *
 * @see https://playwright.dev/docs/test-configuration
 * @see https://playwright.dev/docs/test-components
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter configuration */
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['html', { open: 'on-failure' }]],

  /* Global timeout for each test */
  timeout: 30 * 1000,

  /* Expect timeout - MUI components may need extra time for animations */
  expect: {
    timeout: 10000,
    // Snapshot comparison tolerance for visual tests
    toHaveScreenshot: {
      maxDiffPixels: 100,
    },
  },

  /* Shared settings for all projects */
  use: {
    /* Base URL for E2E tests */
    baseURL: 'http://localhost:5173',

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',

    /* Action timeout */
    actionTimeout: 10 * 1000,

    /* Navigation timeout */
    navigationTimeout: 30 * 1000,

    /* Enable accessibility testing */
    testIdAttribute: 'data-testid',
  },

  /* Configure projects for major browsers */
  projects: [
    // Component Testing projects
    {
      name: 'component-chromium',
      testDir: './tests/components',
      testMatch: '**/*.spec.tsx',
      use: {
        ...devices['Desktop Chrome'],
      },
    },

    // E2E Testing projects
    {
      name: 'e2e-chromium',
      testDir: './tests/e2e',
      testMatch: '**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'e2e-firefox',
      testDir: './tests/e2e',
      testMatch: '**/*.spec.ts',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'e2e-webkit',
      testDir: './tests/e2e',
      testMatch: '**/*.spec.ts',
      use: {
        ...devices['Desktop Safari'],
      },
    },

    // Mobile viewport tests
    {
      name: 'mobile-chrome',
      testDir: './tests/e2e',
      testMatch: '**/mobile.spec.ts',
      use: {
        ...devices['Pixel 5'],
      },
    },

    // Accessibility tests (run on all components)
    {
      name: 'accessibility',
      testDir: './tests/accessibility',
      testMatch: '**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],

  /* Run dev server before starting the tests */
  webServer: {
    command: 'pnpm run test:serve',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
