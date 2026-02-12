# Nostria Testing Documentation

> Comprehensive guide to testing Nostria, with a focus on AI/LLM-driven automation.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Test Architecture](#test-architecture)
4. [Running Tests](#running-tests)
5. [AI/LLM Automation Guide](#aillm-automation-guide)
6. [Writing Tests](#writing-tests)
7. [Page Object Models](#page-object-models)
8. [Test Fixtures](#test-fixtures)
9. [Configuration](#configuration)
10. [Test Artifacts](#test-artifacts)
11. [Debugging](#debugging)
12. [CI/CD Integration](#cicd-integration)
13. [Best Practices](#best-practices)

---

## Overview

Nostria's testing strategy combines:

- **Unit Tests**: Karma/Jasmine for component and service testing
- **E2E Tests**: Playwright for end-to-end user flow testing
- **AI-Optimized Automation**: Special utilities for LLM-driven test execution

The E2E testing setup is specifically designed to enable AI assistants (like GitHub Copilot) to:
- Execute tests and analyze results
- Capture and interpret screenshots and videos
- Collect console logs for debugging
- Understand page state through structured data
- Iterate on test failures automatically

---

## Quick Start

### Prerequisites

```bash
# Ensure dependencies are installed
npm install

# Install Playwright browsers (if not already installed)
npx playwright install chromium
```

### Run Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with visual UI (great for debugging)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run AI-optimized tests (full artifact collection)
npm run test:e2e:ai
```

### View Results

```bash
# Open HTML test report
npm run test:e2e:report

# Results are also in test-results/results.json (JSON format for AI parsing)
```

---

## Test Architecture

### Directory Structure

```
e2e/
├── fixtures.ts              # Extended Playwright fixtures (auth, perf, network, console, memory)
├── global-setup.ts          # Runs before all tests
├── global-teardown.ts       # Runs after all tests
├── fixtures/
│   ├── test-data.ts         # Centralized test constants (profiles, relays, routes, viewports)
│   ├── mock-events.ts       # Nostr event factory functions
│   └── test-isolation.ts    # App state reset/cleanup helpers
├── helpers/
│   ├── auth.ts              # TestAuthHelper — auth injection/cleanup
│   ├── console-analyzer.ts  # ConsoleAnalyzer — log categorization/reporting
│   ├── metrics-collector.ts # MetricsCollector — performance aggregation
│   ├── websocket-monitor.ts # WebSocketMonitor — CDP-based WS tracking
│   └── report-generator.ts  # Full report generator (JSON + Markdown)
├── pages/
│   └── index.ts             # Page Object Models
├── screenshots/             # Visual regression baselines
└── tests/
    ├── home.spec.ts         # Home page tests
    ├── navigation.spec.ts   # Navigation tests
    ├── accessibility.spec.ts # A11y tests
    ├── public/              # Unauthenticated test specs
    ├── auth/                # Authenticated test specs
    ├── performance/         # Performance & metrics specs
    ├── network/             # Network & WebSocket specs
    ├── visual/              # Visual regression specs
    ├── nostr/               # Nostr-specific protocol specs
    ├── resilience/          # Error resilience specs
    └── security/            # Security testing specs
```

### Output Directory

```
test-results/
├── results.json             # JSON results for AI parsing
├── test-summary.json        # Simplified summary
├── test-run-metadata.json   # Test run info
├── html-report/             # HTML report for humans
├── screenshots/             # Named screenshots
├── videos/                  # Video recordings
├── traces/                  # Playwright traces
├── logs/                    # Console logs (JSON)
├── ai-states/              # Page state snapshots
└── artifacts/              # Other test artifacts
```

---

## Running Tests

### NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run all E2E tests in headless mode |
| `npm run test:e2e:ui` | Open Playwright UI for interactive testing |
| `npm run test:e2e:headed` | Run tests with visible browser |
| `npm run test:e2e:debug` | Debug mode with step-through |
| `npm run test:e2e:ai` | AI-optimized run (full artifacts) |
| `npm run test:e2e:report` | View HTML test report |
| `npm run test:e2e:codegen` | Record tests via browser |

### Direct Playwright Commands

```bash
# Run specific test file
npx playwright test e2e/tests/home.spec.ts

# Run specific test by name
npx playwright test -g "should load the home page"

# Run with specific browser
npx playwright test --project=chromium

# Run with multiple workers
npx playwright test --workers=4

# Run in specific browser project
npx playwright test --project=mobile-chrome
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:4200` | App URL to test |
| `CI` | - | Set in CI environments (affects retries) |

---

## AI/LLM Automation Guide

### For GitHub Copilot and AI Assistants

The testing setup is optimized for AI-driven automation. Here's how to use it:

#### 1. Running Tests

```bash
# Run tests and get JSON output
npm run test:e2e

# For maximum debugging information:
npm run test:e2e:ai
```

#### 2. Analyzing Results

After tests run, check these files:

```bash
# Quick summary (AI-friendly)
cat test-results/test-summary.json

# Detailed results
cat test-results/results.json

# Console logs from tests
ls test-results/logs/
```

#### 3. Understanding Test Output

The `test-summary.json` provides:
```json
{
  "endTime": "2024-01-15T10:30:00.000Z",
  "totalTests": 15,
  "passed": 14,
  "failed": 1,
  "skipped": 0,
  "duration": 45000,
  "failedTests": ["should handle empty feed gracefully"]
}
```

#### 4. Viewing Screenshots

Screenshots are saved with descriptive names:
```
test-results/screenshots/
├── home-page-loaded-2024-01-15T10-30-00.png
├── navigation-menu-open-2024-01-15T10-30-05.png
└── feed-loading-state-2024-01-15T10-30-10.png
```

#### 5. Debugging Failures

For failed tests:
1. Check `test-results/results.json` for error messages
2. View screenshots in `test-results/screenshots/`
3. Watch video recordings in `test-results/videos/`
4. Analyze traces using `npx playwright show-trace test-results/artifacts/<trace-file>`

#### 6. Using AI Automation Helpers

The `AIPageAnalyzer` class captures structured page state:

```typescript
import { AIPageAnalyzer } from '../helpers/ai-automation';

test('analyze page', async ({ page }) => {
  const analyzer = new AIPageAnalyzer(page);
  
  // Capture complete page state
  const state = await analyzer.capturePageState();
  console.log(JSON.stringify(state, null, 2));
  
  // Get action recommendations
  const recommendations = await analyzer.getActionRecommendations();
  console.log('Recommended actions:', recommendations);
  
  // Save state to file
  await analyzer.saveStateToFile('my-test');
});
```

#### 7. Semantic Actions

Use natural language-like commands:

```typescript
import { SemanticActions } from '../helpers/ai-automation';

test('user flow', async ({ page }) => {
  const actions = new SemanticActions(page);
  
  await actions.clickButton('Create Note');
  await actions.fillInput('Content', 'Hello, Nostr!');
  await actions.clickButton('Publish');
  await actions.waitForText('Note published');
});
```

### Iterative Testing Workflow

For AI-driven iteration:

1. **Run tests**: `npm run test:e2e:ai`
2. **Analyze failures**: Read `test-results/test-summary.json`
3. **View artifacts**: Check screenshots and console logs
4. **Make fixes**: Modify code based on findings
5. **Re-run**: Execute tests again
6. **Repeat**: Until all tests pass

---

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from '../fixtures';
import { HomePage } from '../pages';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should do something', async ({ page, waitForNostrReady, captureScreenshot }) => {
    // Wait for app to be ready
    await waitForNostrReady();
    
    // Perform actions
    const homePage = new HomePage(page);
    await homePage.clickCreateNote();
    
    // Assert
    await expect(page.locator('.note-dialog')).toBeVisible();
    
    // Capture screenshot for AI analysis
    await captureScreenshot('after-clicking-create');
  });
});
```

### Using Custom Fixtures

```typescript
test('with console logs', async ({ 
  page, 
  waitForNostrReady, 
  captureScreenshot,
  saveConsoleLogs,
  getConsoleLogs 
}) => {
  await page.goto('/');
  await waitForNostrReady();
  
  // Get current console logs
  const logs = getConsoleLogs();
  console.log('Console output:', logs);
  
  // Save logs to file
  await saveConsoleLogs('my-test-name');
});
```

### Testing Nostr-Specific Features

```typescript
import { NostrTestUtils } from '../fixtures';

test('nostr events', async ({ page }) => {
  const nostrUtils = new NostrTestUtils(page);
  
  // Wait for specific event kind
  await nostrUtils.waitForEventKind(1); // Kind 1 = notes
  
  // Get visible notes
  const notes = await nostrUtils.getVisibleNotes();
  expect(notes.length).toBeGreaterThan(0);
});
```

---

## Page Object Models

### Available Page Objects

| Class | Description | Key Methods |
|-------|-------------|-------------|
| `HomePage` | Main feed/home | `goto()`, `getNoteCount()`, `clickCreateNote()` |
| `ProfilePage` | User profile | `goto(pubkey)`, `getDisplayName()`, `clickFollow()` |
| `MessagesPage` | Direct messages | `goto()`, `selectConversation()`, `sendMessage()` |
| `SettingsPage` | User settings | `goto()`, `toggleTheme()`, `save()` |
| `LoginPage` | Account login | `goto()`, `loginWithNsec()`, `clickExtensionLogin()` |
| `MusicPage` | Music player | `goto()`, `playFirstTrack()`, `isPlaying()` |
| `CommandPalette` | Command palette | `open()`, `search()`, `executeCommand()` |

### Example Usage

```typescript
import { HomePage, ProfilePage, CommandPalette } from '../pages';

test('navigate via command palette', async ({ page }) => {
  await page.goto('/');
  
  const commandPalette = new CommandPalette(page);
  await commandPalette.open();
  await commandPalette.executeCommand('Settings');
  
  // Now on settings page
  await expect(page).toHaveURL(/settings/);
});
```

### Creating New Page Objects

```typescript
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../fixtures';

export class MyNewPage extends BasePage {
  readonly myElement: Locator;
  readonly anotherElement: Locator;

  constructor(page: Page) {
    super(page);
    this.myElement = page.locator('[data-testid="my-element"]');
    this.anotherElement = page.locator('.another-element');
  }

  async goto(): Promise<void> {
    await this.page.goto('/my-route');
    await this.waitForReady();
  }

  async doSomething(): Promise<void> {
    await this.myElement.click();
  }
}
```

---

## Test Fixtures

### Available Fixtures

| Fixture | Type | Description |
|---------|------|-------------|
| `page` | Page | Standard Playwright page with console logging |
| `consoleLogs` | ConsoleLogEntry[] | Collected console logs |
| `captureScreenshot` | Function | Save named screenshot |
| `waitForNostrReady` | Function | Wait for app to initialize |
| `clearConsoleLogs` | Function | Clear collected logs |
| `getConsoleLogs` | Function | Get current logs |
| `saveConsoleLogs` | Function | Save logs to JSON file |

### Custom Fixture Example

```typescript
import { test, expect } from '../fixtures';

test('using fixtures', async ({ 
  page,
  captureScreenshot,
  waitForNostrReady,
  saveConsoleLogs,
}) => {
  await page.goto('/');
  await waitForNostrReady();
  
  await captureScreenshot('initial-state');
  
  // ... test actions ...
  
  await saveConsoleLogs('test-console-output');
});
```

---

## Configuration

### Playwright Config (`playwright.config.ts`)

Key configuration options:

```typescript
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,                    // Test timeout
  expect: { timeout: 10_000 },        // Assertion timeout
  
  use: {
    baseURL: 'http://localhost:4200',
    screenshot: 'on',                 // Always capture screenshots
    video: 'retain-on-failure',       // Videos only on failure
    trace: 'retain-on-failure',       // Traces only on failure
  },
  
  webServer: {
    command: 'npm run start',         // Auto-start app
    url: 'http://localhost:4200',
    reuseExistingServer: true,        // Reuse if running
  },
});
```

### Projects

| Project | Use Case |
|---------|----------|
| `chromium` | Primary desktop testing |
| `firefox` | Firefox browser testing |
| `webkit` | Safari/WebKit testing |
| `mobile-chrome` | Mobile responsive testing |
| `mobile-safari` | iOS responsive testing |
| `ai-debug` | Maximum artifact collection |

### Running Specific Projects

```bash
# Desktop Chrome only
npx playwright test --project=chromium

# Mobile testing
npx playwright test --project=mobile-chrome

# AI debugging (full artifacts)
npx playwright test --project=ai-debug
```

---

## Test Artifacts

### Screenshots

```typescript
// Named screenshots are saved to test-results/screenshots/
await captureScreenshot('descriptive-name');

// Or use page method directly
await page.screenshot({ 
  path: 'test-results/screenshots/my-screenshot.png',
  fullPage: true 
});
```

### Videos

Videos are recorded automatically based on config:
- `'on'`: Always record
- `'retain-on-failure'`: Keep only for failed tests
- `'off'`: Never record

### Traces

Traces provide step-by-step debugging:

```bash
# View a trace
npx playwright show-trace test-results/artifacts/trace.zip
```

### Console Logs

```typescript
// Logs are automatically collected
// Save them for analysis:
await saveConsoleLogs('my-test-name');

// Read from file:
// test-results/logs/my-test-name-2024-01-15T10-30-00.json
```

---

## Debugging

### Interactive Debug Mode

```bash
npm run test:e2e:debug
```

This opens the Playwright Inspector where you can:
- Step through tests
- View selectors
- Time-travel through test steps

### Playwright UI Mode

```bash
npm run test:e2e:ui
```

Features:
- Watch mode (re-run on changes)
- Visual test timeline
- DOM snapshot inspection
- Network request viewing

### Using Console Logs

```typescript
test('debug with logs', async ({ page, getConsoleLogs }) => {
  await page.goto('/');
  
  // Print all console messages
  const logs = getConsoleLogs();
  console.log('Page console output:');
  logs.forEach(log => console.log(`[${log.type}] ${log.text}`));
});
```

### Screenshot on Failure

Screenshots are automatically captured on test failure. For manual capture:

```typescript
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === 'failed') {
    await page.screenshot({ 
      path: `test-results/failures/${testInfo.title}.png` 
    });
  }
});
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          
      - name: Install dependencies
        run: npm ci
        
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
        
      - name: Run E2E tests
        run: npm run test:e2e
        
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: test-results/
```

### Environment Configuration

```bash
# CI environment
CI=true npm run test:e2e

# Custom base URL
BASE_URL=https://staging.nostria.app npm run test:e2e
```

---

## Best Practices

### Do's

1. **Use Page Objects**: Encapsulate selectors and actions
2. **Wait properly**: Use `waitForNostrReady()` before assertions
3. **Capture screenshots**: For debugging and AI analysis
4. **Save console logs**: For failed test investigation
5. **Use descriptive names**: Test names should explain what's being tested
6. **Test one thing**: Each test should verify a single behavior
7. **Handle async properly**: Always await async operations

### Don'ts

1. **Don't use hardcoded waits**: Use proper waiting mechanisms
2. **Don't test implementation**: Test behavior, not internals
3. **Don't share state**: Tests should be independent
4. **Don't ignore flaky tests**: Fix them or mark as known issues
5. **Don't skip cleanup**: Use proper beforeEach/afterEach

### Selector Strategy

Priority order for selectors:
1. `data-testid` attributes (most stable)
2. Semantic roles (`getByRole`)
3. Text content (`getByText`)
4. CSS classes (less stable)
5. XPath (avoid if possible)

```typescript
// Best - uses test ID
page.locator('[data-testid="submit-button"]')

// Good - uses semantic role
page.getByRole('button', { name: 'Submit' })

// Okay - uses visible text
page.getByText('Submit')

// Avoid - fragile
page.locator('.btn-primary.large')
```

### Adding Test IDs

When developing new features, add `data-testid` attributes:

```html
<!-- In Angular template -->
<button data-testid="create-note-button" (click)="createNote()">
  Create Note
</button>
```

---

## Visual Regression Testing

Visual regression tests capture screenshots of key pages and components, then compare them against baseline ("golden") images on subsequent runs. A test fails if the pixel difference exceeds the configured threshold (1%).

### How It Works

Playwright's built-in `toHaveScreenshot()` assertion handles screenshot comparison:

1. **First run**: Baseline screenshots are generated and saved to `e2e/screenshots/`
2. **Subsequent runs**: New screenshots are compared pixel-by-pixel against baselines
3. **Failures**: If the diff exceeds the threshold, the test fails and a diff image is saved

### Running Visual Tests

```bash
# Run all visual regression tests
npm run test:e2e:visual

# Update baseline screenshots (after intentional UI changes)
npm run test:e2e:visual:update
```

### Test Specs

| Spec | Description |
|------|-------------|
| `theme-consistency.spec.ts` | 5 pages in light & dark mode, contrast validation |
| `responsive-layout.spec.ts` | 3 pages at mobile/tablet/desktop, layout transitions |
| `component-gallery.spec.ts` | Individual component screenshots (sidenav, cards, buttons, dialogs) |

### Baseline Screenshot Management

- **Location**: `e2e/screenshots/` — committed to the repository
- **Updating**: Run `npm run test:e2e:visual:update` after intentional UI changes
- **Review**: Always review updated screenshots before committing
- **CI**: Baselines must match the CI environment's rendering (use consistent browser versions)

### Configuration

Visual regression thresholds are configured in `playwright.config.ts`:

```typescript
expect: {
  toHaveScreenshot: {
    maxDiffPixelRatio: 0.01,  // 1% pixel difference allowed
    threshold: 0.2,            // Per-pixel color threshold
  },
},
snapshotPathTemplate: 'e2e/screenshots/{testFilePath}/{arg}{ext}',
```

### Tips

- **Dynamic content masking**: Tests use `mask` to hide timestamps, avatars, and other dynamic elements that change between runs
- **Stable rendering**: Tests wait for `networkidle` and Angular bootstrap before capturing
- **Theme toggle**: Dark mode is set via `localStorage.setItem('nostria-theme', 'dark')` before page load
- **Component isolation**: Component-level screenshots target specific Angular Material selectors (`mat-card`, `mat-sidenav`, etc.)

---

## Test Account Setup

### What is TEST_NSEC?

The `TEST_NSEC` environment variable provides a Nostr private key (in `nsec1...` format) for authenticated E2E tests. This key is used to inject a logged-in session into the browser, allowing tests to exercise features that require authentication (DMs, note creation, settings, etc.).

### Security Considerations

- **NEVER use a real account's nsec for testing.** The test key may be exposed in CI logs, local files, or test artifacts.
- **Generate a throwaway key** specifically for testing purposes.
- **The `.env` file is gitignored** and will not be committed to the repository.
- **In CI**, the key is stored as a GitHub Actions secret (`TEST_NSEC`).

### Creating a Test Account

1. **Generate a new keypair** using any Nostr key generator:
   ```bash
   # Using nostr-tools (the same library used by the test suite)
   node -e "
     const { generateSecretKey, getPublicKey } = require('nostr-tools/pure');
     const { nsecEncode } = require('nostr-tools/nip19');
     const sk = generateSecretKey();
     console.log('nsec:', nsecEncode(sk));
     console.log('pubkey:', getPublicKey(sk));
   "
   ```

2. **Add to `.env`**:
   ```bash
   echo "TEST_NSEC=nsec1your_generated_key_here" > .env
   ```

3. **(Optional) Set up the test profile** by logging into Nostria with the test key and setting a display name, avatar, etc. This makes authenticated test assertions more meaningful.

### How Authentication Works in Tests

The `TestAuthHelper` class (`e2e/helpers/auth.ts`) handles authentication:

1. **Key derivation**: Takes the nsec, decodes it to a hex private key, derives the public key
2. **localStorage injection**: Uses `page.addInitScript()` to set `nostria-account` and `nostria-accounts` in localStorage before the app loads
3. **Bypass encryption**: Sets `isEncrypted: false` so the app reads the key directly without requiring PIN entry
4. **Cleanup**: After each test, clears auth keys from localStorage

### Using the `authenticatedPage` Fixture

```typescript
import { test, expect } from '../../fixtures';

test('authenticated feature', async ({ authenticatedPage }) => {
  // authenticatedPage is already logged in
  await authenticatedPage.goto('/notifications');
  // ... test authenticated features
});
```

### Running Without TEST_NSEC

If `TEST_NSEC` is not set, the test suite automatically generates a throwaway keypair for each run. This means:
- The test account has no relay history, no profile, no follows
- Tests that depend on existing data (like "following feed shows content") will see empty states
- This is still useful for testing UI rendering, navigation, and error handling

---

## Test Data & Fixtures

### Centralized Test Data (`e2e/fixtures/test-data.ts`)

Contains constants for:
- **Well-known profiles**: npubs for Jack Dorsey, fiatjaf, hodlbod (read-only profile viewing tests)
- **Relay URLs**: Primary, secondary, and invalid relay URLs for connection testing
- **Sample content**: Pre-defined note content for creation tests (short, long, with mentions, XSS payloads, etc.)
- **App routes**: All public and authenticated routes
- **NIP-19 entities**: Valid and malformed npub/nprofile/nevent for deep link testing
- **Viewport sizes**: Standard responsive breakpoints
- **Timeouts**: Consistent timeout values across tests
- **Storage keys**: Known localStorage key names

### Mock Events (`e2e/fixtures/mock-events.ts`)

Factory functions for creating Nostr events with valid structure:
- `createMockProfileEvent()` — Kind 0 profile metadata
- `createMockNoteEvent()` — Kind 1 text note
- `createMockReplyEvent()` — Kind 1 reply
- `createMockContactListEvent()` — Kind 3 contact list
- `createMockDMEvent()` — Kind 4 encrypted DM
- `createMockReactionEvent()` — Kind 7 reaction
- `createMockRepostEvent()` — Kind 6 repost
- `createMockArticleEvent()` — Kind 30023 long-form article
- `createMockFileMetadataEvent()` — Kind 1063 file metadata
- `createMockLiveStreamEvent()` — Kind 30311 live stream

### Test Isolation (`e2e/fixtures/test-isolation.ts`)

Functions to prevent test pollution:
- `resetAppState(page)` — Full reset: localStorage, sessionStorage, IndexedDB, service workers
- `clearNostriaStorage(page)` — Clear only Nostria-specific keys
- `setupCleanEnvironment(page, options)` — Set up clean state with optional theme/storage config
- `verifyCleanState(page)` — Assert no residual auth or data remains

---

## Troubleshooting

### Common Issues

#### Tests timeout waiting for app

**Solution**: Ensure the dev server is running or increase timeout:
```typescript
test.setTimeout(120_000); // 2 minutes
```

#### Element not found

**Solution**: 
1. Check if element exists in DOM
2. Verify selector is correct
3. Wait for element: `await element.waitFor()`

#### Flaky tests

**Solution**:
1. Add proper waiting
2. Use `waitForNostrReady()`
3. Consider network conditions
4. Add retries in config

#### Screenshots are blank

**Solution**: Ensure page is fully loaded before capture:
```typescript
await page.waitForLoadState('networkidle');
await captureScreenshot('name');
```

### Getting Help

1. Check the [Playwright documentation](https://playwright.dev/docs/intro)
2. Review test artifacts in `test-results/`
3. Run in debug mode: `npm run test:e2e:debug`
4. Use UI mode for visual debugging: `npm run test:e2e:ui`

---

## References

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Angular Testing Guide](https://angular.dev/guide/testing)
- [Nostria Architecture](./ARCHITECTURE.md)

---

## Authenticated Testing

### Overview

Authenticated tests exercise features that require a logged-in Nostr identity: direct messages, note creation, notifications, relay management, settings, and more. The test infrastructure handles authentication by injecting a pre-built `NostrUser` object into `localStorage` before the app loads.

### How the Auth Fixture Works

1. **`TestAuthHelper`** (`e2e/helpers/auth.ts`) accepts an nsec1 private key, decodes it to hex, derives the public key, and constructs a `NostrUser` object.
2. **`injectAuth(page)`** calls `page.addInitScript()` to set `nostria-account` and `nostria-accounts` in `localStorage` before Angular bootstraps. The `isEncrypted: false` flag bypasses the PIN entry flow.
3. **`clearAuth(page)`** removes auth keys and reloads the page, restoring unauthenticated state.
4. **`authenticatedPage` fixture** (in `e2e/fixtures.ts`) orchestrates the full lifecycle: inject before test, clear after test.

### Key Behavior

- If `TEST_NSEC` is set in `.env`, that identity is used for all authenticated tests.
- If `TEST_NSEC` is not set, a throwaway keypair is generated per run (no relay history, empty profile).
- The `authenticatedPage` fixture is used by tagging tests with `@auth` and requesting the fixture parameter.

### Example

```typescript
import { test, expect } from '../../fixtures';

test('should show notifications page @auth', async ({ authenticatedPage: page }) => {
  await page.goto('/notifications');
  // page is already logged in — no need to inject auth manually
  await expect(page.locator('app-root')).toBeVisible();
});
```

---

## Running Authenticated Tests Locally

### Step-by-Step

1. **Generate a test keypair** (do NOT use your real account):
   ```bash
   node -e "
     const { generateSecretKey, getPublicKey } = require('nostr-tools/pure');
     const { nip19 } = require('nostr-tools');
     const { bytesToHex } = require('@noble/hashes/utils');
     const sk = generateSecretKey();
     console.log('nsec:', nip19.nsecEncode(sk));
     console.log('pubkey:', getPublicKey(sk));
   "
   ```

2. **Create `.env`** in the project root:
   ```
   TEST_NSEC=nsec1your_generated_key_here
   ```

3. **Start the dev server** (if not already running):
   ```bash
   npm run start
   ```

4. **Run authenticated tests**:
   ```bash
   # Run only tests tagged @auth
   npm run test:e2e:auth

   # Or run the full suite (public + auth)
   npm run test:e2e:full
   ```

5. **Interpret results**:
   - HTML report: `npm run test:e2e:report`
   - JSON summary: `test-results/test-summary.json`
   - Console logs: `test-results/logs/`
   - Screenshots: `test-results/screenshots/`

### Without TEST_NSEC

If you skip the `.env` setup, authenticated tests still run with an auto-generated throwaway identity. You'll see a console warning:

```
⚠ TEST_NSEC not set. Using auto-generated throwaway keypair.
```

Tests that check for profile data, following feeds, or DM history will see empty states — but UI rendering and navigation tests still work.

---

## Console Log Analysis

### How It Works

Every test automatically captures all browser console output (logs, warnings, errors, page errors, failed requests) via the `page` fixture in `e2e/fixtures.ts`.

### Saving Logs

```typescript
await saveConsoleLogs('my-test-name');
// Output: test-results/logs/my-test-name-2026-02-12T10-30-00.json
```

### Console Analyzer Fixture

The `consoleAnalyzer` fixture categorizes logs into:

| Category | What It Captures |
|----------|-----------------|
| `errors` | `console.error`, `pageerror`, unhandled exceptions |
| `warnings` | `console.warn` messages |
| `nostrLogs` | Logs containing Nostr prefixes: `[AccountStateService]`, `[RelayService]`, `[SubscriptionCache]`, etc. |
| `angularLogs` | Angular-specific messages (`NG0`, `ExpressionChanged`) |
| `networkLogs` | Network failures (`net::`, `ERR_`) |
| `debugLogs` | General `console.log`/`console.debug` |

### ConsoleAnalyzer Class (`e2e/helpers/console-analyzer.ts`)

For standalone analysis outside fixtures:

```typescript
import { ConsoleAnalyzer } from '../../helpers/console-analyzer';

const analyzer = new ConsoleAnalyzer(collectedLogs);
const report = analyzer.generateReport();
// report.uniqueErrors, report.relayStats, report.topMessages, etc.
```

### Assertion Helpers

```typescript
import { ConsoleAnalyzer } from '../../helpers/console-analyzer';

const analyzer = new ConsoleAnalyzer(logs);
analyzer.expectNoUnexpectedErrors();   // Fails on unexpected errors
analyzer.expectNoAngularErrors();      // Fails on Angular errors
analyzer.expectRelayConnections(2);    // Expects at least 2 relay connections
```

### Reading Reports

Console analysis reports are JSON files in `test-results/reports/`:

```json
{
  "totalLogs": 142,
  "categorySummary": {
    "errors": 2,
    "warnings": 15,
    "nostr": 48,
    "angular": 0,
    "network": 3,
    "debug": 74
  },
  "errors": [ ... ],
  "warnings": [ ... ]
}
```

---

## Performance Testing

### Metrics Collected

The performance testing suite (`e2e/tests/performance/`) collects these metrics:

| Metric | Source | Good Threshold |
|--------|--------|---------------|
| **LCP** (Largest Contentful Paint) | PerformanceObserver | < 2.5s |
| **FID** (First Input Delay) | PerformanceObserver | < 100ms |
| **CLS** (Cumulative Layout Shift) | PerformanceObserver | < 0.1 |
| **TTFB** (Time to First Byte) | Navigation Timing API | < 800ms |
| **FCP** (First Contentful Paint) | PerformanceObserver | < 1.8s |
| **DOM Content Loaded** | Navigation Timing API | — |
| **Load Complete** | Navigation Timing API | — |
| **JS Bundle Size** | Resource Timing API | < 500KB per file |
| **Total Bundle Size** | Resource Timing API | — |
| **Memory Usage** | `performance.memory` (Chrome) | < 50MB growth |

### Running Performance Tests

```bash
# Run performance/metrics tests only
npm run test:e2e:metrics

# Generate the full report (includes performance data)
npm run test:e2e:report:full
```

### Output Files

| File | Location | Content |
|------|----------|---------|
| Page load times | `test-results/metrics/page-load-*.json` | Navigation timing per route |
| Web Vitals | `test-results/metrics/web-vitals-*.json` | LCP, FID, CLS, FCP, TTFB |
| Bundle sizes | `test-results/metrics/bundle-size-*.json` | Per-resource sizes, total |
| Memory timeline | `test-results/metrics/memory-*.json` | Heap snapshots over time |
| Relay performance | `test-results/metrics/relay-perf-*.json` | Connection/latency times |

### Using the `performanceMetrics` Fixture

```typescript
test('measure page load @metrics', async ({ page, performanceMetrics }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Save metrics to disk
  await performanceMetrics.save('home-page-load');

  // Access raw data
  console.log('LCP:', performanceMetrics.webVitals.lcp);
  console.log('CLS:', performanceMetrics.webVitals.cls);
});
```

### Using the `memoryMonitor` Fixture

```typescript
test('check for memory leaks @metrics', async ({ page, memoryMonitor }) => {
  await page.goto('/');
  await memoryMonitor.capture(); // Initial snapshot

  // Navigate through pages
  for (const route of routes) {
    await page.goto(route);
    await memoryMonitor.capture();
  }

  const delta = memoryMonitor.getDelta();
  if (delta) {
    expect(delta.potentialLeak).toBeFalsy();
  }

  await memoryMonitor.save('memory-navigation');
});
```

### Historical Comparison

The report generator (`e2e/helpers/report-generator.ts`) compares current results against `full-report-previous.json` (if present) and highlights regressions:

```
Performance Regression Detected:
  Home page load: 2.1s → 3.4s (+62%)
  Bundle size increased: 1.2MB → 1.5MB (+25%)
```

---

## Network Monitoring

### WebSocket Tracking

The app connects to Nostr relays via WebSocket. The test infrastructure monitors these connections at two levels:

#### 1. `networkMonitor` Fixture

Tracks HTTP requests and WebSocket connections via Playwright's event API:

```typescript
test('monitor network @network', async ({ page, networkMonitor }) => {
  await page.goto('/');
  await page.waitForTimeout(5000);

  console.log('Total requests:', networkMonitor.requests.length);
  console.log('WebSocket connections:', networkMonitor.webSockets.length);
  console.log('Failed requests:', networkMonitor.failedRequests.length);

  await networkMonitor.save('network-home');
});
```

#### 2. `WebSocketMonitor` Class (`e2e/helpers/websocket-monitor.ts`)

Uses Chrome DevTools Protocol (CDP) for deep WebSocket frame inspection:

```typescript
import { WebSocketMonitor } from '../../helpers/websocket-monitor';

const monitor = new WebSocketMonitor(page);
await monitor.start();

// Navigate and wait for relay connections
await page.goto('/');
await page.waitForTimeout(5000);

const summary = monitor.getSummary();
// summary.connections — relay URLs, connection times, status
// summary.subscriptions — REQ/CLOSE pairs, orphaned subscriptions
// summary.messages — total sent/received, by relay
```

### Nostr Protocol Messages

The WebSocket monitor categorizes Nostr protocol messages:

| Message | Direction | Description |
|---------|-----------|-------------|
| `REQ` | Client → Relay | Subscription request with filters |
| `EVENT` | Relay → Client | Event delivery |
| `EOSE` | Relay → Client | End of stored events |
| `NOTICE` | Relay → Client | Relay notice/error |
| `CLOSE` | Client → Relay | Close subscription |

### Network Test Output

Network reports are saved to `test-results/network/`:

```json
{
  "summary": {
    "totalRequests": 45,
    "failedRequests": 2,
    "webSocketConnections": 5
  },
  "requests": [ ... ],
  "failedRequests": [ ... ],
  "webSockets": [
    {
      "url": "wss://relay.damus.io",
      "connectedAt": 1707744000000,
      "messagesSent": 12,
      "messagesReceived": 156
    }
  ]
}
```

---

## CI/CD Testing Guide

### GitHub Actions Workflows

Two workflows handle E2E testing in CI:

#### PR/Push Workflow (`.github/workflows/e2e-tests.yml`)

- **Triggers**: Pull requests and pushes to main
- **Steps**: Install Node 20, `npm ci`, install Chromium, start dev server, run tests
- **Caching**: `node_modules` and Playwright browsers are cached between runs
- **Secrets**: `TEST_NSEC` is read from GitHub Actions secrets (optional)
- **PR Comments**: Test results are posted as a comment on the PR

#### Nightly Workflow (`.github/workflows/e2e-nightly.yml`)

- **Triggers**: Nightly cron schedule
- **Scope**: Full suite including performance metrics, visual regression, and all test tags
- **Artifacts**: 90-day retention for performance trend data
- **Reports**: Full Markdown report generated after tests complete

### Configuring Secrets

1. Go to your repository's **Settings > Secrets and variables > Actions**
2. Add `TEST_NSEC` with a test-only nsec1 key
3. The workflow reads it via `${{ secrets.TEST_NSEC }}`

If the secret is not configured, tests fall back to auto-generated keypairs.

### Reading PR Test Comments

When a PR triggers the E2E workflow, a comment is posted with:
- Total tests, passed/failed counts
- Link to the full report artifact
- Performance regression warnings (if any)
- List of failed test names

### Artifacts

All test results are uploaded as GitHub Actions artifacts:
- `playwright-report` — HTML report
- `test-results` — JSON data, screenshots, console logs, metrics

---

## Writing New Tests — Checklist

### Tag Conventions

Every test should be tagged for filtering:

| Tag | When to Use |
|-----|-------------|
| `@public` | Test doesn't require authentication |
| `@auth` | Test requires a logged-in account (use `authenticatedPage` fixture) |
| `@smoke` | Critical path — include in fast CI checks |
| `@metrics` | Collects performance/metrics data |
| `@network` | Monitors network/WebSocket behavior |
| `@security` | Security-focused validation |
| `@a11y` | Accessibility checks |
| `@visual` | Visual regression screenshots |

Tags go in the `test.describe()` title:

```typescript
test.describe('My Feature @auth @smoke', () => { ... });
```

### Fixture Selection Guide

| Need | Fixture |
|------|---------|
| Logged-in page | `authenticatedPage` |
| Console log capture | `saveConsoleLogs` (auto-available via `page`) |
| Performance data | `performanceMetrics` |
| Network tracking | `networkMonitor` |
| Log analysis | `consoleAnalyzer` |
| Memory monitoring | `memoryMonitor` |
| Screenshots | `captureScreenshot` |
| App ready wait | `waitForNostrReady` |

### Test Structure Template

```typescript
import { test, expect } from '../../fixtures';
import { TIMEOUTS } from '../../fixtures/test-data';

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const appRoot = document.querySelector('app-root');
    if (!appRoot) return false;
    return !!document.querySelector('mat-sidenav-content, .main-content, main');
  }, { timeout: TIMEOUTS.appReady });
  await page.waitForTimeout(TIMEOUTS.stabilize);
}

test.describe('Feature Name @public', () => {
  test('should do something', async ({ page, saveConsoleLogs }) => {
    await page.goto('/route');
    await waitForAppReady(page);

    // Test logic here

    await saveConsoleLogs('feature-test-name');
  });
});
```

### Checklist Before Submitting

- [ ] Test has appropriate tags (`@public`, `@auth`, `@metrics`, etc.)
- [ ] Test calls `saveConsoleLogs()` at the end for debugging
- [ ] Test uses `waitForAppReady()` or `waitForNostrReady()` before assertions
- [ ] Test uses constants from `e2e/fixtures/test-data.ts` (not hardcoded values)
- [ ] Test is independent — doesn't depend on state from other tests
- [ ] Test handles empty/loading states gracefully (uses `.catch(() => false)` for optional elements)
- [ ] Authenticated tests use the `authenticatedPage` fixture
- [ ] Performance tests save metrics via `performanceMetrics.save()` or `memoryMonitor.save()`
- [ ] No real nsec keys or sensitive data in test files

### Selector Strategy (No data-testid)

The app currently has no `data-testid` attributes. Use these selectors in priority order:

1. Angular Material selectors: `mat-card`, `mat-button`, `mat-sidenav`
2. Angular component selectors: `app-event`, `app-note`
3. CSS classes: `.sidenav`, `.content-textarea`
4. Text content: `page.getByText('Create')`, `page.locator('button:has-text("Login")')`
5. Semantic roles: `page.getByRole('button', { name: 'Submit' })`

---

## Error Resilience Testing

Test specs in `e2e/tests/resilience/` verify the app handles adverse conditions:

| Spec | What It Tests |
|------|---------------|
| `offline.spec.ts` | Network disconnect/reconnect, cached content persistence |
| `slow-network.spec.ts` | Throttled 3G via CDP, loading states, timeout handling |
| `relay-failures.spec.ts` | All relays blocked, graceful degradation, no infinite retries |
| `large-data.spec.ts` | Long text, deep scroll, virtual scroll stress, emoji content |
| `concurrent-tabs.spec.ts` | Multiple tabs, localStorage sync, race conditions |

---

## Security Testing

Test specs in `e2e/tests/security/` validate security properties:

| Spec | What It Tests |
|------|---------------|
| `key-exposure.spec.ts` | Private key not in DOM, console, network, URLs, visible text, cookies |
| `xss-vectors.spec.ts` | XSS payloads in inputs, sanitization of rendered content, Angular injection |
| `csp-compliance.spec.ts` | Security headers, CSP violations, inline scripts/handlers, eval usage |

### Pre-commit Hook

A pre-commit hook script (`scripts/check-nsec.sh`) scans staged files for nsec1 private keys and blocks commits if found. Install it:

```bash
cp scripts/check-nsec.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

---

*This document should be kept up to date as the testing infrastructure evolves.*
