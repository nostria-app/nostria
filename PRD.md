# Nostria Automated UI Testing — PRD Task List

Ralphy will execute each unchecked task sequentially using your chosen AI engine.

## Overview

Build a comprehensive automated UI testing pipeline for the Nostria Angular web app
using Playwright. The system must support authenticated testing via nsec private key
injection, full console log capture and analysis, performance metrics collection,
cross-browser/device testing, and produce actionable improvement reports.

The app uses Nostr protocol with advanced authentication (nsec, NIP-07 extensions,
NIP-46 bunkers). Private keys are encrypted with a default PIN ("0000") via
PBKDF2+AES-256-GCM and stored in localStorage under `nostria-account` /
`nostria-accounts` keys. All timestamps are in seconds (Nostr convention).

---

## Phase 1 — Environment & Configuration

- [x] Create `.env.example` with documented test variables: `TEST_NSEC` (nsec1... private key for test account), `TEST_PUBKEY` (hex pubkey, auto-derived if omitted), `BASE_URL` (default `http://localhost:4200`), `TEST_LOG_LEVEL` (debug/info/warn/error), `CI` (boolean)
- [x] Create `.env` loading in Playwright config: install `dotenv` as devDependency, add `import 'dotenv/config'` to `playwright.config.ts`, and read `TEST_NSEC` / `TEST_PUBKEY` / `BASE_URL` from `process.env`
- [x] Validate `.env` is already listed in `.gitignore` (confirmed: line 7). Add `test-results/` to `.gitignore` if not already present
- [x] Add a `test:e2e:auth` npm script to `package.json` that runs only authenticated test files: `playwright test --grep @auth`
- [x] Add a `test:e2e:full` npm script that runs all tests (public + authenticated) with full artifact collection: `playwright test --project=chromium`
- [x] Add a `test:e2e:metrics` npm script that runs tests and generates the performance/metrics report: `playwright test --project=ai-debug --grep @metrics`

---

## Phase 2 — Authentication Helper

- [x] Create `e2e/helpers/auth.ts` with a `TestAuthHelper` class that: imports `getPublicKey` and `nip19` from `nostr-tools`, accepts an nsec1 string or hex private key, derives the public key, and builds a valid `NostrUser` object with `source: 'nsec'`, `hasActivated: true`, `lastUsed: Date.now()`, `isEncrypted: false`, and plaintext hex privkey
- [x] Add a `injectAuth(page: Page)` method to `TestAuthHelper` that uses `page.addInitScript()` to set `localStorage['nostria-account']` and `localStorage['nostria-accounts']` with the constructed `NostrUser` before the app loads
- [x] Add a `clearAuth(page: Page)` method to `TestAuthHelper` that removes auth keys from localStorage and reloads the page
- [ ] Add a `getTestKeypair()` static method that generates a fresh random keypair using `nostr-tools/pure` (`generateSecretKey()`, `getPublicKey()`), returning `{ nsec, pubkey, privkeyHex }` for use when no `.env` key is provided
- [ ] Add validation: if `TEST_NSEC` is set in env, use that key; otherwise auto-generate a throwaway keypair and log a warning that authenticated tests will use a random identity with no relay history
- [ ] Replace the placeholder `NostrTestUtils.generateTestKeypair()` in `e2e/fixtures.ts` with a real implementation using nostr-tools that calls `TestAuthHelper.getTestKeypair()`

---

## Phase 3 — Extended Test Fixtures

- [ ] Add an `authenticatedPage` fixture to `e2e/fixtures.ts` that calls `TestAuthHelper.injectAuth(page)` before yielding the page, and calls `clearAuth(page)` after the test completes — this fixture provides a pre-logged-in browser context
- [ ] Add a `performanceMetrics` fixture that collects Web Vitals (LCP, FID, CLS, TTFB, FCP) via `page.evaluate()` using the PerformanceObserver API, storing results in `test-results/metrics/`
- [ ] Add a `networkMonitor` fixture that tracks all WebSocket connections (relay connections), HTTP requests, and failed requests — saving a summary JSON to `test-results/network/`
- [ ] Add a `consoleAnalyzer` fixture that extends the existing `consoleLogs` fixture to categorize logs by severity, count errors/warnings, detect Nostr-specific log patterns (e.g., `[AccountStateService]`, `[SubscriptionCache]`, relay EOSE/NOTICE messages), and produce a structured analysis report
- [ ] Add a `memoryMonitor` fixture that captures `performance.memory` (Chrome only) at test start and end, computing memory delta, and flags potential memory leaks if growth exceeds a threshold (e.g., 50MB)

---

## Phase 4 — Console Log Capture & Analysis

- [ ] Create `e2e/helpers/console-analyzer.ts` with a `ConsoleAnalyzer` class that categorizes captured console logs into: errors, warnings, Nostr relay messages, Angular lifecycle events, network issues, and application debug logs
- [ ] Add pattern matching for known Nostr log prefixes: `[AccountStateService]`, `[Profile Loading]`, `[Cache]`, `[SubscriptionCache]`, `[RelayService]`, `[MediaPlayer]`, and extract structured data (relay URLs, event kinds, subscription IDs)
- [ ] Add error classification: distinguish between expected errors (e.g., relay connection refused, 404 for missing profile images) and unexpected errors (unhandled promise rejections, Angular errors, TypeError/ReferenceError)
- [ ] Add a `generateReport()` method that outputs a JSON summary: total log count by type, top 10 most frequent messages, list of unique errors, relay connection success/failure rates, and warnings about potential issues
- [ ] Save the console analysis report to `test-results/reports/console-analysis-{timestamp}.json` after each test suite run
- [ ] Add console log assertions: helper functions like `expectNoUnexpectedErrors(logs)`, `expectRelayConnections(logs, minCount)`, `expectNoAngularErrors(logs)` that can be used in tests

---

## Phase 5 — Public (Unauthenticated) Test Suites

- [ ] Refactor existing `e2e/tests/home.spec.ts` to use descriptive tags (`@public`, `@smoke`) and ensure all tests save console logs on completion via the `saveConsoleLogs` fixture
- [ ] Refactor existing `e2e/tests/navigation.spec.ts` to tag with `@public @navigation` and add console log saving
- [ ] Refactor existing `e2e/tests/accessibility.spec.ts` to tag with `@public @a11y` and add console log saving
- [ ] Create `e2e/tests/public/discover.spec.ts` — test the Discover page (`/discover`): verify page loads, content cards render, categories/filters are interactive, no JS errors in console
- [ ] Create `e2e/tests/public/articles.spec.ts` — test the Articles page (`/articles`): verify article list renders, article cards have titles, clicking an article navigates to detail view
- [ ] Create `e2e/tests/public/music.spec.ts` — test the Music page (`/music`): verify music list loads, player controls are present, track metadata displays
- [ ] Create `e2e/tests/public/streams.spec.ts` — test the Streams page (`/streams`): verify stream cards render, live indicator works if streams are active
- [ ] Create `e2e/tests/public/search.spec.ts` — test the Search page (`/search`): verify search input is focusable, typing triggers search, results display or empty state shows
- [ ] Create `e2e/tests/public/profile-view.spec.ts` — test viewing a public profile (`/p/{npub}`): verify profile header loads, display name renders, notes tab shows events, about tab shows bio
- [ ] Create `e2e/tests/public/event-view.spec.ts` — test viewing a single event (`/e/{nevent}`): verify event content renders, author info displays, reply thread loads if present
- [ ] Create `e2e/tests/public/deep-links.spec.ts` — test NIP-19 entity deep links: npub, note, nprofile, nevent, naddr URLs all resolve correctly without errors
- [ ] Create `e2e/tests/public/error-handling.spec.ts` — test 404 routes, malformed npub/nevent URLs, and verify the app handles them gracefully (no crash, shows fallback UI)
- [ ] Create `e2e/tests/public/responsive.spec.ts` — test responsive layout at 5 viewport sizes (mobile 375px, tablet 768px, small desktop 1024px, desktop 1440px, ultrawide 1920px): verify navigation adapts, content reflows, no horizontal overflow

---

## Phase 6 — Authenticated Test Suites

- [ ] Create `e2e/tests/auth/login.spec.ts` (@auth @smoke) — test nsec login flow via the LoginDialog UI: open login dialog, enter nsec, verify login succeeds, account appears in sidebar, pubkey matches expected. Also test invalid nsec handling (error message shown, no crash)
- [ ] Create `e2e/tests/auth/account-state.spec.ts` (@auth) — using `authenticatedPage` fixture, verify: profile name displays in sidebar, account menu shows the logged-in account, switching between accounts works if multiple are configured
- [ ] Create `e2e/tests/auth/profile-edit.spec.ts` (@auth) — navigate to own profile, click edit, verify form fields load (display name, about, picture URL, banner URL, NIP-05), make a change and verify it's reflected locally (do NOT publish to avoid polluting relays)
- [ ] Create `e2e/tests/auth/create-note.spec.ts` (@auth) — open the note creation dialog, type content, verify the note preview, test character count display, test cancel closes dialog without posting, verify the publish button is enabled with content
- [ ] Create `e2e/tests/auth/messages.spec.ts` (@auth) — navigate to Messages, verify DM list loads (may be empty for test account), verify new message UI is accessible, test conversation thread rendering
- [ ] Create `e2e/tests/auth/settings.spec.ts` (@auth) — navigate to Settings, verify all setting sections render (appearance, relays, notifications, privacy, backups), toggle theme between light/dark, verify relay list displays connected relays
- [ ] Create `e2e/tests/auth/notifications.spec.ts` (@auth) — navigate to Notifications, verify the page loads, notification list renders or empty state displays, notification filtering tabs are interactive
- [ ] Create `e2e/tests/auth/following-feed.spec.ts` (@auth) — verify the home feed in authenticated mode shows content from followed accounts (if any), test feed refresh, test infinite scroll loading
- [ ] Create `e2e/tests/auth/relay-management.spec.ts` (@auth) — navigate to relay settings, verify relay list shows URLs and connection status, test adding/removing a relay (UI only, verify the list updates), test relay connection indicators
- [ ] Create `e2e/tests/auth/command-palette.spec.ts` (@auth) — open command palette (Ctrl+K), verify authenticated commands are available (Create Note, Settings, Profile, etc.), execute navigation commands, verify search within command palette works
- [ ] Create `e2e/tests/auth/logout.spec.ts` (@auth) — verify logout flow: click account menu, click logout/remove account, verify the app returns to unauthenticated state, localStorage is cleared of account data

---

## Phase 7 — Performance & Metrics Collection

- [ ] Create `e2e/tests/performance/page-load.spec.ts` (@metrics) — measure initial page load time for 5 key routes (/, /discover, /articles, /music, /settings), record Navigation Timing API metrics (domContentLoadedEventEnd, loadEventEnd), save to `test-results/metrics/page-load.json`
- [ ] Create `e2e/tests/performance/web-vitals.spec.ts` (@metrics) — collect Core Web Vitals (LCP, FID/INP, CLS) for the home page using PerformanceObserver, compare against "good" thresholds (LCP < 2.5s, CLS < 0.1), report pass/fail with actual values
- [ ] Create `e2e/tests/performance/bundle-size.spec.ts` (@metrics) — after page load, collect all JS/CSS resource sizes via `performance.getEntriesByType('resource')`, report total bundle size, flag resources over 500KB, save resource breakdown to JSON
- [ ] Create `e2e/tests/performance/memory.spec.ts` (@metrics @auth) — in authenticated mode, navigate through 10 pages sequentially, capture `performance.memory.usedJSHeapSize` at each step, report if memory grows monotonically (potential leak), save the memory timeline to JSON
- [ ] Create `e2e/tests/performance/relay-performance.spec.ts` (@metrics @auth) — in authenticated mode, measure WebSocket connection times to each relay, track message latency (REQ to EOSE), count total events received, report relay responsiveness
- [ ] Create `e2e/helpers/metrics-collector.ts` — a utility class that aggregates all performance data from individual tests into a unified `test-results/reports/performance-report.json` with: page load times, web vitals, bundle sizes, memory usage, relay performance, and historical comparison (if previous report exists)

---

## Phase 8 — Network & WebSocket Monitoring

- [ ] Create `e2e/helpers/websocket-monitor.ts` — a utility that intercepts WebSocket connections via CDP (Chrome DevTools Protocol) using `page.context().newCDPSession(page)`, logs all WebSocket frames (sent/received), and categorizes Nostr protocol messages (REQ, EVENT, EOSE, NOTICE, CLOSE)
- [ ] Add relay connection tracking: record which relays connect successfully, which timeout, which return errors, and the connection duration for each
- [ ] Add subscription tracking: monitor REQ/CLOSE pairs, detect orphaned subscriptions (REQ without CLOSE), and track event delivery counts per subscription
- [ ] Create `e2e/tests/network/relay-connections.spec.ts` (@network @auth) — verify the app connects to relays from the user's relay list, test reconnection behavior by simulating a connection drop, verify EOSE is received for initial subscriptions
- [ ] Create `e2e/tests/network/api-calls.spec.ts` (@network) — monitor HTTP requests to the Nostria API (`api.nostria.app` or `localhost:3000`), verify expected endpoints are called, check for failed requests, log response times

---

## Phase 9 — Visual Regression Testing

- [ ] Install `@playwright/test` visual comparison support (built-in). Create `e2e/tests/visual/` directory for screenshot comparison tests
- [ ] Create `e2e/tests/visual/theme-consistency.spec.ts` — capture screenshots of 5 key pages in both light and dark mode, compare against baseline screenshots, fail if pixel diff exceeds 1% threshold
- [ ] Create `e2e/tests/visual/responsive-layout.spec.ts` — capture screenshots at mobile (375px), tablet (768px), and desktop (1440px) for the home page, profile page, and settings page — compare against baselines
- [ ] Create `e2e/tests/visual/component-gallery.spec.ts` — navigate to pages that showcase key UI components (buttons, cards, dialogs, forms) and capture component-level screenshots for regression detection
- [ ] Add baseline screenshot management: add `e2e/screenshots/` directory for golden screenshots, document the update process (`npx playwright test --update-snapshots`), add to `.gitignore` guidance

---

## Phase 10 — CI/CD Integration

- [ ] Create `.github/workflows/e2e-tests.yml` — GitHub Actions workflow that: checks out code, installs Node 20, runs `npm ci`, installs Playwright browsers (`npx playwright install --with-deps chromium`), starts the dev server, runs `npm run test:e2e:full`, uploads `test-results/` as artifact on failure
- [ ] Add secrets configuration: document adding `TEST_NSEC` as a GitHub Actions secret for authenticated tests, with fallback to auto-generated keypair if secret is not set
- [ ] Add test result commenting: use `actions/github-script` to post a summary comment on PRs with: total tests, passed/failed count, link to full report artifact, any performance regressions detected
- [ ] Add test caching: cache `node_modules` and Playwright browsers between runs for faster CI execution
- [ ] Create `.github/workflows/e2e-nightly.yml` — nightly workflow that runs the full test suite including performance metrics and visual regression, and stores results for trend analysis

---

## Phase 11 — Reporting & Analysis

- [ ] Create `e2e/helpers/report-generator.ts` — a utility that reads all JSON outputs from `test-results/` (test summary, console analysis, performance metrics, network monitoring, memory usage) and generates a unified `test-results/reports/full-report.json`
- [ ] Add a human-readable Markdown report generator: produce `test-results/reports/test-report.md` with sections for: executive summary, test results table, performance metrics with pass/fail indicators, console error summary, network health, memory usage trends, and actionable improvement recommendations
- [ ] Add historical comparison: if a previous `full-report.json` exists (e.g., from last CI run), compare metrics and highlight regressions (page load time increased, new console errors, memory growth)
- [ ] Add improvement suggestions engine: analyze the collected data and generate specific, actionable recommendations such as: "Reduce bundle size by code-splitting the music player module (currently 450KB)", "Fix unhandled promise rejection in AccountStateService", "Add error boundary for relay connection failures", "Optimize LCP by preloading hero content"
- [ ] Add a `test:e2e:report:full` npm script that generates and opens the comprehensive Markdown report after a test run

---

## Phase 12 — Test Data & Fixtures

- [ ] Create `e2e/fixtures/test-data.ts` — centralized test data constants: well-known npubs for profile viewing, known nevent IDs for event viewing, relay URLs for connection testing, sample note content for creation tests
- [ ] Create `e2e/fixtures/mock-events.ts` — sample Nostr events (kind 0 profile, kind 1 note, kind 3 contact list, kind 4 DM, kind 7 reaction) with valid structure for injecting into the app's state when needed
- [ ] Add test isolation helpers: functions to reset app state between tests (clear all localStorage, reset IndexedDB if used, clear service worker caches) to prevent test pollution
- [ ] Document test account setup: add a section to TESTING.md explaining how to create a test account, what the TEST_NSEC env var is for, and security considerations (never use a real account's nsec for testing)

---

## Phase 13 — Nostr-Specific Testing

- [ ] Create `e2e/tests/nostr/event-rendering.spec.ts` — test that various Nostr event kinds render correctly: kind 1 (note), kind 6 (repost), kind 7 (reaction), kind 30023 (article), kind 1063 (media), kind 30311 (live stream)
- [ ] Create `e2e/tests/nostr/nip-rendering.spec.ts` — test NIP-specific features: NIP-27 mention rendering (nostr: links), NIP-36 content warning display, NIP-94 file metadata rendering, NIP-57 zap display
- [ ] Create `e2e/tests/nostr/relay-behavior.spec.ts` (@auth) — test relay connection lifecycle: initial connect, subscription creation, event receipt, subscription cleanup, reconnection after disconnect
- [ ] Create `e2e/tests/nostr/timestamp-handling.spec.ts` — verify timestamps are displayed correctly: relative times ("5m ago"), full dates, timezone handling. Verify no JavaScript Date issues with Nostr's second-based timestamps
- [ ] Create `e2e/tests/nostr/key-handling.spec.ts` — test that npub/nsec/hex/NIP-19 entities are displayed and parsed correctly throughout the UI (profile links, mention rendering, key display in settings)

---

## Phase 14 — Error Resilience Testing

- [ ] Create `e2e/tests/resilience/offline.spec.ts` — test offline behavior: disconnect network via `page.context().setOffline(true)`, verify the app shows an offline indicator, cached content remains visible, reconnection restores functionality
- [ ] Create `e2e/tests/resilience/slow-network.spec.ts` — test with throttled network (slow 3G profile via CDP), verify loading indicators appear, content eventually loads, no timeout crashes
- [ ] Create `e2e/tests/resilience/relay-failures.spec.ts` (@auth) — test behavior when all relays fail to connect: verify the app degrades gracefully, shows appropriate error messaging, doesn't enter infinite retry loops
- [ ] Create `e2e/tests/resilience/large-data.spec.ts` (@auth) — test with profiles that have very long bios, notes with maximum content length, threads with deep nesting — verify no layout breakage or performance degradation
- [ ] Create `e2e/tests/resilience/concurrent-tabs.spec.ts` — open the app in multiple browser contexts simultaneously, verify localStorage synchronization, no race conditions in account state

---

## Phase 15 — Security Testing

- [ ] Create `e2e/tests/security/key-exposure.spec.ts` (@auth @security) — verify that private keys are never exposed in: DOM attributes, console logs, network requests (HTTP bodies/headers), URL parameters, or visible UI elements (except explicitly in settings key export)
- [ ] Create `e2e/tests/security/xss-vectors.spec.ts` — test that user-generated content (note text, profile names, bios) with XSS payloads (`<script>`, `onerror=`, `javascript:` URLs) is properly sanitized and doesn't execute
- [ ] Create `e2e/tests/security/csp-compliance.spec.ts` — verify Content-Security-Policy headers are present and no CSP violations are logged in the console during normal app usage
- [ ] Verify that the test account's nsec is never committed to the repository: add a pre-commit hook check or document the validation in CI

---

## Phase 16 — Documentation Updates

- [ ] Update `TESTING.md` with new sections: Authenticated Testing (how to set up TEST_NSEC, how the auth fixture works), Console Log Analysis (how to read the reports), Performance Testing (what metrics are collected, thresholds), Network Monitoring (WebSocket tracking details)
- [ ] Add a "Running Authenticated Tests Locally" guide: step-by-step for generating a test nsec, adding it to `.env`, running `npm run test:e2e:auth`, interpreting results
- [ ] Add a "CI/CD Testing" guide: how secrets are configured, what the nightly workflow does, how to read PR test comments
- [ ] Add a "Writing New Tests" checklist: tag conventions (`@auth`, `@public`, `@metrics`, `@security`), fixture selection guide, screenshot/log capture requirements, test isolation requirements
- [ ] Update `AGENTS.md` with testing-related instructions: how AI agents should run tests, interpret results, and use the reporting tools

---

## Usage

Run with Ralphy:

```bash
# Execute tasks from this PRD
ralphy --prd PRD.md
```

### Quick Start

```bash
# Install dependencies (includes Playwright)
npm install

# Install browsers
npx playwright install chromium

# Create .env with your test key
echo "TEST_NSEC=nsec1your_test_key_here" > .env

# Run all public (unauthenticated) tests
npm run test:e2e

# Run authenticated tests
npm run test:e2e:auth

# Run full suite with metrics
npm run test:e2e:full

# Run performance/metrics tests
npm run test:e2e:metrics

# View HTML report
npm run test:e2e:report

# View full Markdown report
npm run test:e2e:report:full
```

### Test Tags

| Tag | Description |
|-----|-------------|
| `@public` | Tests that don't require authentication |
| `@auth` | Tests that require a logged-in account |
| `@smoke` | Critical path tests for quick CI validation |
| `@metrics` | Performance and metrics collection tests |
| `@network` | Network and WebSocket monitoring tests |
| `@security` | Security-focused tests |
| `@a11y` | Accessibility tests |
| `@visual` | Visual regression tests |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TEST_NSEC` | No | Auto-generated | nsec1... private key for test account |
| `TEST_PUBKEY` | No | Derived from nsec | Hex public key (auto-derived) |
| `BASE_URL` | No | `http://localhost:4200` | App URL to test against |
| `TEST_LOG_LEVEL` | No | `warn` | Console log capture threshold |
| `CI` | No | `false` | Set in CI environments |

## Notes

- Tasks are marked complete automatically when the AI agent finishes them
- Completed tasks show as `- [x] Task description`
- Tasks are executed in order from top to bottom
- The test account nsec should be a throwaway key — never use a real account
- Console logs are the primary debugging mechanism; the app produces ~679 console.* calls across services
- The app uses Angular 21+ with zoneless change detection and signals — tests must account for signal-based reactivity
- All Nostr timestamps are in SECONDS, not milliseconds — test assertions must use `Math.floor(Date.now() / 1000)`
- The app has SSR support but E2E tests run against the client-side SPA via `ng serve`
- Private keys in localStorage may be encrypted with PIN "0000" via AES-256-GCM — the auth helper bypasses this by setting `isEncrypted: false`
