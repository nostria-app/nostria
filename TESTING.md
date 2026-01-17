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
├── fixtures.ts              # Extended Playwright fixtures
├── global-setup.ts          # Runs before all tests
├── global-teardown.ts       # Runs after all tests
├── helpers/
│   └── ai-automation.ts     # AI-specific utilities
├── pages/
│   └── index.ts             # Page Object Models
└── tests/
    ├── home.spec.ts         # Home page tests
    ├── navigation.spec.ts   # Navigation tests
    └── accessibility.spec.ts # A11y tests
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

*This document should be kept up to date as the testing infrastructure evolves.*
