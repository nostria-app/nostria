# AGENTS.md - AI Coding Agent Guidelines

> Guidelines for AI coding agents working in the Nostria codebase.

**Tech Stack:** Angular 21+, TypeScript (strict), Angular Material 3, SCSS, Playwright (E2E), Karma/Jasmine (unit)

**App URL:** https://nostria.app | **Protocol:** Nostr (nostr-tools library)

## Build / Lint / Test Commands

```bash
npm run start                 # Dev server at http://localhost:4200
npm run build                 # Production build
npm run lint                  # Run ESLint
npm run lint-fix              # Auto-fix ESLint issues
npm run test                  # Run unit tests (Karma/Jasmine)
npm run test:e2e              # Run all E2E tests (Playwright)
npm run test:e2e:ui           # Playwright UI mode
npm run test:e2e:headed       # Run with visible browser
npm run test:e2e:debug        # Debug mode
npm run test:e2e:auth         # Run only @auth tests
npm run test:e2e:full         # Run all tests with full artifacts
npm run test:e2e:metrics      # Run performance/metrics tests
npm run test:e2e:visual       # Run visual regression tests
npm run test:e2e:visual:update # Update visual baselines
npm run test:e2e:report:full  # Generate comprehensive Markdown report

# Run single E2E test file
npx playwright test e2e/tests/home.spec.ts

# Run single test by name
npx playwright test -g "should load the home page"

# Run tests by tag
npx playwright test --grep @public
npx playwright test --grep @auth
npx playwright test --grep @security
```

## Code Style

**Formatting:** 2-space indent, single quotes, CRLF line endings, trim trailing whitespace

**Naming:** Components `app-` prefix kebab-case, Directives `app` prefix camelCase

**Files:** `name.component.ts`, `name.service.ts`, `name.spec.ts`

## TypeScript

- Strict mode enabled - no implicit any
- Avoid `any`; use `unknown` when type is uncertain
- Prefer type inference when obvious

## Angular Components

```typescript
@Component({
  selector: 'app-example',
  imports: [CommonModule], // Standalone imports
  templateUrl: './example.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, // ALWAYS OnPush
})
export class ExampleComponent {
  data = input<DataType>(); // NOT @Input decorator
  selected = output<Item>(); // NOT @Output decorator
  private service = inject(MyService); // NOT constructor injection
  items = signal<Item[]>([]); // State with signals
  filtered = computed(() => this.items().filter((i) => i.active)); // Derived
}
```

**Key Rules:**

- Standalone components only - NO NgModules
- Do NOT set `standalone: true` - it's default in Angular 21+
- Do NOT use `@HostBinding`/`@HostListener` - use `host: {}` in decorator
- Do NOT use `ngClass`/`ngStyle` - use class/style bindings
- Use `NgOptimizedImage` for static images (not base64)

## Templates - Native Control Flow

```html
@if (condition()) {
<div>Content</div>
} @for (item of items(); track item.id) { <app-item [data]="item" /> }

<!-- WRONG: *ngIf, *ngFor, *ngSwitch -->
```

## Services

```typescript
@Injectable({ providedIn: 'root' })
export class ExampleService {
  private other = inject(OtherService);
  items = signal<Item[]>([]);
  // Use update() or set(), NEVER mutate()
}
```

## HTTP Requests

**Always use `fetch`**, NOT HttpClient:

```typescript
const response = await fetch(url);
const data = await response.json();
```

## Nostr Protocol

**CRITICAL:** Timestamps are in **SECONDS**, not milliseconds:

```typescript
const timestamp = Math.floor(Date.now() / 1000); // CORRECT
const timestamp = Date.now(); // WRONG!
```

## Styling

Use CSS variables (Material 3), never hardcoded colors:

```scss
background: var(--mat-sys-surface);
color: var(--mat-sys-on-surface);
color: var(--mat-sys-primary);
```

Dark mode: `:host-context(.dark) .my-class { ... }`

**Rules:**

- Never set `font-weight` - current font doesn't support it
- Use `field-sizing: content` for auto-growing textareas
- Do NOT use `color="primary"` on buttons (Material 3)
- Use `mat-flat-button` for primary actions

## Dialogs

Use `CustomDialogComponent`, NOT Angular Material dialogs.
Never use native `confirm()` dialogs. Use app dialogs/snackbars for confirmations.

## SSR Safety

Never access browser APIs directly:

```typescript
private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
if (this.isBrowser) { const w = window.innerWidth; }
```

## Project Structure

```
src/app/
├── api/          # Generated (DO NOT EDIT)
├── components/   # Reusable UI
├── pages/        # Route-level pages
├── services/     # Business logic
├── interfaces/   # TypeScript interfaces
└── utils/        # Utilities
```

## Command Palette

Add commands for new features: `src/app/components/command-palette-dialog/`

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture details
- [TESTING.md](./TESTING.md) - E2E testing guide
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - Full guidelines

## E2E Testing for AI Agents

### Running Tests

When asked to run E2E tests, use these commands:

```bash
# Quick smoke test (public pages only)
npx playwright test --grep @smoke

# Full suite
npm run test:e2e:full

# Specific test category
npx playwright test --grep @auth      # Authenticated tests
npx playwright test --grep @metrics   # Performance tests
npx playwright test --grep @security  # Security tests
npx playwright test --grep @network   # Network tests
```

### Interpreting Results

After running tests, check these outputs:

1. **Quick summary**: `test-results/test-summary.json` — total/passed/failed counts
2. **Detailed results**: `test-results/results.json` — per-test status and errors
3. **Console logs**: `test-results/logs/*.json` — categorized browser console output
4. **Performance data**: `test-results/metrics/*.json` — Web Vitals, bundle sizes, memory
5. **Network data**: `test-results/network/*.json` — HTTP requests, WebSocket connections
6. **Full report**: Run `npm run test:e2e:report:full` to generate `test-results/reports/test-report.md`

### Social Preview Regression Check

When changing SSR, routing, `DataResolver`, or metadata generation, always validate social preview tags before merging.

Use bot user agents and verify dynamic pages do not return homepage fallback tags:

```bash
# Validate OG/Twitter meta for a known event URL
curl -A "Twitterbot/1.0" "https://nostria.app/e/nevent1qvzqqqqqqypzq9lz3z0m5qgzr5zg5ylapwss3tf3cwpjv225vrppu6wy8750heg4qqsqqqpsj6e662lsgy26a5g9nvav4z807m08ryhnx7ljs5dnuhpfl0cs642uw" | grep -E "og:title|og:description|twitter:title|twitter:description|og:image|twitter:image"
```

Expected outcome: event/profile/article-specific tags are present and not generic homepage values like `Nostria - Your Social Network`.

### Test Tags

Tests are tagged for filtering. Use `--grep` to select:

| Tag         | Description                    |
| ----------- | ------------------------------ |
| `@public`   | No authentication required     |
| `@auth`     | Requires logged-in account     |
| `@smoke`    | Critical path, fast CI         |
| `@metrics`  | Performance/metrics collection |
| `@network`  | Network/WebSocket monitoring   |
| `@security` | Security validation            |
| `@a11y`     | Accessibility checks           |
| `@visual`   | Visual regression screenshots  |

### Writing E2E Tests

When creating new E2E tests, follow these conventions:

1. **Import from `e2e/fixtures`**, not `@playwright/test` directly
2. **Tag tests** in the `test.describe()` title (e.g., `'Feature @auth @smoke'`)
3. **Use `saveConsoleLogs()`** at the end of every test
4. **Use constants** from `e2e/fixtures/test-data.ts` (profiles, routes, timeouts)
5. **Use `waitForAppReady()`** before making assertions
6. **Use `authenticatedPage`** fixture for tests needing login
7. **No `data-testid`** attributes exist — use Angular Material selectors, CSS classes, or text content
8. **Nostr timestamps** are in SECONDS: `Math.floor(Date.now() / 1000)`
9. **Handle empty states** — test accounts may have no relay history

### Test Infrastructure Files

| File                               | Purpose                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `e2e/fixtures.ts`                  | Extended Playwright fixtures (authenticatedPage, performanceMetrics, etc.) |
| `e2e/helpers/auth.ts`              | Auth injection/cleanup via TestAuthHelper                                  |
| `e2e/helpers/console-analyzer.ts`  | Log categorization and assertions                                          |
| `e2e/helpers/metrics-collector.ts` | Performance data aggregation                                               |
| `e2e/helpers/websocket-monitor.ts` | CDP-based WebSocket inspection                                             |
| `e2e/helpers/report-generator.ts`  | Full report generation (JSON + Markdown)                                   |
| `e2e/fixtures/test-data.ts`        | Centralized constants (profiles, relays, routes, timeouts)                 |
| `e2e/fixtures/mock-events.ts`      | Nostr event factory functions                                              |
| `e2e/fixtures/test-isolation.ts`   | App state reset helpers                                                    |

### Reporting Tools

```bash
# Generate comprehensive report after test run
npm run test:e2e:report:full
# Output: test-results/reports/test-report.md + full-report.json

# View HTML report
npm run test:e2e:report
```

The full report includes: test results table, performance metrics with pass/fail indicators, console error summary, network health, memory trends, and actionable improvement recommendations.

