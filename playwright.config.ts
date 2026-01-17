import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for Nostria
 *
 * This configuration is optimized for AI/LLM-driven test automation:
 * - Automatic screenshots on failure
 * - Video recording for debugging
 * - Console log capture
 * - Trace collection for detailed debugging
 * - Structured test artifacts for easy AI analysis
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Test directory
  testDir: './e2e',

  // Test file pattern
  testMatch: '**/*.spec.ts',

  // Maximum time one test can run
  timeout: 60_000,

  // Expect timeout for assertions
  expect: {
    timeout: 10_000,
  },

  // Run tests in parallel for speed
  fullyParallel: true,

  // Fail the build on test.only in CI
  forbidOnly: !!process.env['CI'],

  // Retry failed tests (useful for flaky network tests in Nostr)
  retries: process.env['CI'] ? 2 : 1,

  // Limit parallel workers
  workers: process.env['CI'] ? 1 : undefined,

  // Reporter configuration - JSON for AI parsing, HTML for human review
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { outputFolder: 'test-results/html-report', open: 'never' }],
  ],

  // Global setup and teardown
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // Shared settings for all projects
  use: {
    // Base URL for the application
    baseURL: process.env['BASE_URL'] || 'http://localhost:4200',

    // Capture screenshot on failure
    screenshot: 'on',

    // Record video for all tests (retain on failure for debugging)
    video: 'retain-on-failure',

    // Collect trace on failure for detailed debugging
    trace: 'retain-on-failure',

    // Viewport size
    viewport: { width: 1440, height: 900 },

    // Ignore HTTPS errors (useful for local development)
    ignoreHTTPSErrors: true,

    // Action timeout
    actionTimeout: 15_000,

    // Navigation timeout
    navigationTimeout: 30_000,
  },

  // Output directory for test artifacts
  outputDir: 'test-results/artifacts',

  // Configure projects for different browsers/scenarios
  projects: [
    // Desktop Chrome - Primary testing browser
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Enable console log collection
        launchOptions: {
          args: ['--enable-logging'],
        },
      },
    },

    // Desktop Firefox - Secondary browser
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    // Desktop Safari/WebKit
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile Chrome - Responsive testing
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 851 },
      },
    },

    // Mobile Safari - iOS testing
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 13'],
      },
    },

    // AI-optimized project with maximum artifact collection
    {
      name: 'ai-debug',
      use: {
        ...devices['Desktop Chrome'],
        screenshot: 'on',
        video: 'on',
        trace: 'on',
        launchOptions: {
          args: ['--enable-logging'],
          slowMo: 100, // Slow down for better video capture
        },
      },
    },
  ],

  // Web server configuration - starts the app automatically
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
