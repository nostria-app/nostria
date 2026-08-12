# AGENTS.md - AI Coding Agent Guidelines

> High-signal instructions for AI coding agents working in the Nostria codebase. Treat the user as an expert engineer, not a novice. Prioritize correctness, maintainability, speed, and thoughtful innovation.

---

## 1. Operating principles

- Act like a senior peer, not a tutor. Do not over-explain, hand-hold, or restate obvious things. Assume Angular, TypeScript, and Nostr fluency.
- Prefer the smallest change that fully solves the problem. Avoid churn, speculative rewrites, unnecessary abstractions, and hypothetical extension points.
- Optimize for quality over verbosity: robust implementation, clear naming, minimal diff, and thoughtful edge cases.
- When multiple valid approaches exist, choose the one that best fits the existing architecture and avoids future maintenance pain.
- If a materially better approach is obvious, state the tradeoff briefly and implement it. Otherwise stay conservative and surgical.
- Be direct when a request has a flawed premise. A verified result is better than a plausible-sounding one.

## 2. What good output looks like

- Solve the actual problem, not a nearby one.
- Make changes that are easy to review and reason about. Do not reformat, reorder, rename, or clean up adjacent code without a task-driven reason.
- Preserve or improve performance, accessibility, SSR safety, and Nostr correctness.
- Keep the codebase consistent with existing patterns before introducing new ones.
- Surface consequential tradeoffs and assumptions briefly. Lead with the result; avoid generic commentary and recaps.
- Fix real defects exposed in tightly coupled code; mention unrelated pre-existing defects rather than widening the task.

## 3. Working style

- Inspect existing patterns first. Reuse existing services, components, utilities, and conventions whenever they already cover the need.
- Be decisive about reversible choices. Do the work rather than asking minor clarifying questions; stop only for irreversible or material scope changes.
- Validate changed behavior with the smallest relevant test or build step that provides confidence. A few real assertions beat generated boilerplate.
- Keep comments sparse and meaningful. Explain non-obvious intent, and update comments when behavior changes.
- Update [ARCHITECTURE.md](./ARCHITECTURE.md) for non-trivial architectural changes. Do not add documentation by default.
- Do not add dependencies unless they are clearly justified by the problem and fit the existing stack.
- Destructive operations need an explicit ask: no `git reset --hard`, force-push, mass deletion, hand-editing generated locale files, or dependency installation without explaining why.

---

## 4. Ground truth (verify before assuming)

| Fact       | Value                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| Framework  | Angular **22.1** (standalone-only, **zoneless**, SSR + hydration)                            |
| Language   | TypeScript **6.0**, `strict` + `noPropertyAccessFromIndexSignature` + `strictTemplates`      |
| UI         | Angular Material **3** (M3 tokens only), SCSS                                                |
| Protocol   | Nostr via `nostr-tools`                                                                      |
| Unit tests | **Vitest** in browser mode (chromium) via `@angular/build:unit-test` — **not** Karma/Jasmine |
| E2E        | Playwright (`e2e/`)                                                                          |
| Storage    | IndexedDB (`idb`)                                                                            |
| Shells     | Web/PWA + **Tauri** desktop (Win/macOS/Linux) + **Tauri** mobile (Android/iOS)               |
| i18n       | 20 locales, `$localize` / `i18n` attributes, source `src/locale/messages.json`               |
| App URL    | https://nostria.app                                                                          |

**Zoneless is the single most load-bearing fact.** `provideZonelessChangeDetection()` is active. Nothing re-renders because a `setTimeout`/promise resolved — only signal writes, `markForCheck`, and template events drive change detection. Mutating a plain class field and expecting the view to update is a silent bug.

---

## 3. Commands

### Works

```bash
npm start                     # dev server, http://localhost:4200
npm run build                 # prod build (SSR) — the real type/template check
npm test                      # unit tests: Vitest + chromium, all 190+ specs
npm run test:e2e              # Playwright, all projects
npm run schemas               # Nostr event schema validation (@nostrability/schemata)
npm run gen:i18n              # extract i18n -> src/locale/messages.json
npm run i18n:sync             # propagate new keys to the other 19 locales
npm run check:frame-protection
npm run check:social-preview:prod
```

Targeted runs (prefer these — full suites are slow):

```bash
ng test --include src/app/services/relay-batch.service.spec.ts --watch=false
ng test --filter "publishes to write relays" --watch=false     # regex on suite/test names
npx playwright test e2e/tests/home.spec.ts
npx playwright test --grep @smoke
```

First run on a fresh checkout: `npx playwright install chromium` — unit tests execute **in a real browser**, and without it every spec fails with a launch error that has nothing to do with your change.

### Broken — do not run, do not "fix" as a side quest

- `npm run lint` → fails: `@angular-eslint/builder` is not installed.
- `npm run lint-fix` / `npm run lint:check` → `eslint.config.js` requires `@eslint/js` + `angular-eslint`, neither is a dependency. (Also: `lint:check` passes `--fix`, so it isn't a check.)
- Prettier is configured in `package.json` (`printWidth: 100`, `singleQuote`) but **not installed**, and `DEVELOPMENT.md` references `format` / `format:check` scripts that don't exist.

Consequence: **there is no automated style gate.** Match the formatting of the file you're editing: 2-space indent, single quotes, semicolons, ~100 col, CRLF, trailing newline. Do not introduce a formatter unless asked.

### The unit suite is red — know the baseline before you panic

As of v4.1.67: **~407 failing / 1434 tests, 64 failing spec files.** Almost all are stale hand-rolled mocks (`Object.create(Svc.prototype)` + `Object.assign({...})`) that drifted from the implementations they fake — `X is not a function` — plus a handful of specs written for a Node/jsdom environment (`// @vitest-environment jsdom`, `node:fs`) that can't run because `angular.json` pins `browsers: ["chromium"]`.

So:

- **A red suite is not evidence you broke something.** Compare before/after on the specs you touched; a new failure in an unrelated file is signal, an old one isn't.
- Don't open a repo-wide test-repair project unless asked. Fix the specs adjacent to your change.
- One exception is worth escalating immediately: a **TypeScript error in any spec file blocks the entire suite**, because `tsconfig.spec.json` type-checks all of `src/**/*.spec.ts` as one program. `--include` / `--exclude` do not narrow the type-check. One bad cast in one spec = zero tests run anywhere. If `ng test` reports compile errors, fix those first, whatever file they're in.

### Verification loop (definition of done)

1. `ng test --include <the specs you touched> --watch=false` — catches logic + DI regressions. Read it against the baseline above.
2. `npm run build` — the authoritative type + template check (`strictTemplates` catches template errors nothing else will). Run it before claiming a non-trivial change works.
3. Touched routing / SSR / `DataResolver` / meta tags → run the social-preview check (§12).
4. Touched auth, relays, or publishing → run the relevant `e2e/tests/**` file.

Never report success on unrun code. If you couldn't run something, say which step you skipped and why.

---

## 4. Angular

```typescript
@Component({
  selector: 'app-example',
  imports: [MatButtonModule, DatePipe], // import what you use, NOT CommonModule
  templateUrl: './example.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, // always
})
export class ExampleComponent {
  private readonly relays = inject(RelayService); // inject(), never constructor params
  readonly event = input.required<NostrEvent>(); // input()/input.required(), not @Input
  readonly selected = output<NostrEvent>(); // output(), not @Output
  private readonly items = signal<Item[]>([]);
  readonly visible = computed(() => this.items().filter((i) => i.active));
}
```

Hard rules:

- Standalone only. Never write `standalone: true` — it's the default. No NgModules.
- `ChangeDetectionStrategy.OnPush` on every component — 433/433 currently comply.
- No `@HostBinding` / `@HostListener` — use `host: {}` in the decorator.
- No `ngClass` / `ngStyle` — use `[class.x]` / `[style.x]` bindings.
- `NgOptimizedImage` for static images (not base64, not blob/object URLs).
- Don't import `CommonModule` in new code. Import the specific pipe/directive. (82 legacy files still do; don't mass-migrate.)
- Lazy-load routes with `loadComponent` / `loadChildren` — `app.routes.ts` has 160 lazy entries; a new eagerly-imported page is a regression.

**Signals:**

- `signal()` for state, `computed()` for anything derived. Never store a derived value in a second signal that you sync manually.
- `set()` / `update()` only. `mutate()` does not exist.
- Expose state as `readonly x = this._x.asReadonly()` from services.
- **`effect()` is a last resort.** There are already 236 of them; most should have been `computed()`. Legitimate uses: DOM/browser API sync, logging, persistence. Writing signals inside an effect to derive state is a bug waiting to happen — reach for `computed()` first, and `untracked()` when you deliberately need to read without subscribing.
- Zoneless: async callbacks (`setTimeout`, `fetch.then`, WebSocket handlers) must land in a signal write, or the UI won't update.

**Services:** `@Injectable({ providedIn: 'root' })`, `inject()`, one responsibility. `src/app/services/` already has ~190 services — check whether one exists before adding another.

**HTTP:** use `fetch`, not `HttpClient` (the exception is the generated `src/app/api/` client and the NIP-98 interceptor).

---

## 5. Templates

```html
@if (event(); as e) {
<app-note [event]="e" />
} @else {
<app-empty-state />
} @for (item of visible(); track item.id) {
<app-item [data]="item" />
}
```

- Native control flow only. `*ngIf` / `*ngFor` / `*ngSwitch` are forbidden.
- Always a real `track` expression — `track $index` on identity-bearing lists causes DOM churn.
- No logic in templates. If it needs a ternary chain, it's a `computed()`.
- `async` pipe for the RxJS that remains; prefer signals for new code.

---

## 6. Styling (Material 3)

```scss
background: var(--mat-sys-surface-container);
color: var(--mat-sys-on-surface);
border: 1px solid var(--mat-sys-outline-variant);
```

- **Only `--mat-sys-*` tokens** (plus the app vars in `styles.scss` / `theme.scss`). Zero hardcoded colors — the color scheme is changing, so the variable is the contract, not the value it currently resolves to.
- Dark mode via `:host-context(.dark) .my-class { … }` (styles are encapsulated).
- **Never set `font-weight`** — the headline font has no weight variants.
- `field-sizing: content` on auto-growing textareas.
- No `color="primary"` on buttons (not an M3 thing). Primary action = `mat-flat-button`.
- Shrinking a `mat-icon-button`: `padding: 0 !important; display: flex !important; align-items: center; justify-content: center;` — **never** `line-height`.
- Every new surface must be checked in light _and_ dark.

---

## 7. Dialogs

- New dialogs: `CustomDialogService` → `CustomDialogComponent` (`src/app/services/custom-dialog.service.ts`). It handles the native back button/gesture, which matters on Tauri mobile.
- `MatDialog` is still used in ~109 legacy files. That is history, not a pattern to copy — don't mass-migrate it either.
- **Never** native `confirm()` / `alert()` / `prompt()`. Use an app dialog or a snackbar.

---

## 8. i18n (mandatory for user-facing text)

Every user-visible string ships translated into 20 locales.

- Templates: `<span i18n="@@home.tagline">Welcome to Nostria.</span>`, plus `i18n-placeholder`, `i18n-aria-label`, `i18n-title` for attributes.
- TypeScript: ``$localize`:@@androidUpdater.noUpdates:Nostria is already up to date.` `` — the `:@@id:` prefix is mandatory, and interpolations need named placeholders: ``$localize`:@@create.list.success:List "${title}:name: " created` ``.
- **Always set an explicit `@@id`** in dot-namespaced form (`area.subarea.thing`). Auto-generated hashes churn the translation files on every text tweak.
- After adding strings: `npm run gen:i18n` (writes `src/locale/messages.json`), then `npm run i18n:sync`.
- **Never hand-edit `src/locale/messages.*.json`** — they're generated.
- Untranslated UI text is an incomplete feature, not a follow-up.

---

## 9. SSR, PWA & platform safety

The app server-renders and hydrates, and also runs inside Tauri. Guard every browser/native API:

```typescript
private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
if (this.isBrowser) { /* window, document, localStorage, IndexedDB, WebSocket, navigator */ }
```

- Module-scope access to `window`/`document`/`localStorage` crashes the SSR build. Same for `IntersectionObserver`, `matchMedia`, `crypto.subtle`.
- Tauri-only code paths must be gated (see `isTauri()` usage in `app.config.ts`) — the same bundle serves web.
- Hydration is on (`provideClientHydration` with event replay). DOM manipulation during initial render causes hydration mismatches.
- Touching SSR/routing/meta generation → §12 is mandatory.

---

## 10. Nostr

- **Timestamps are SECONDS.** `Math.floor(Date.now() / 1000)`. `Date.now()` is a bug.
- Follow the NIPs. When implementing a kind or tag, cite the NIP number in a comment.
- Never log, persist outside the encrypted store, or transmit private keys / nsec / seed phrases. `scripts/check-nsec.sh` exists because this has been a real risk.
- Relays are unreliable by design: assume timeouts, duplicates, out-of-order and missing events. No `await` on a single relay as a success condition.
- Validate/sanitize all relay-sourced content before rendering (`dompurify` is already wired up).
- `npm run schemas` validates event shapes against `@nostrability/schemata`.

---

## 11. TypeScript

- No implicit `any`. Prefer `unknown` + narrowing. (~77 files still have `: any` — don't add to the pile.)
- Prefer inference; annotate boundaries (public APIs, return types of exported functions), not locals.
- Discriminated unions over optional-field soup. `satisfies` over casts. Type predicates over `as`.
- No one-line wrappers that only cast or rename.
- `noPropertyAccessFromIndexSignature` is on — index signatures need bracket access.
- If it reads like Python with type hints bolted on, rewrite it. Aim for code Matt Pocock wouldn't sigh at.

---

## 12. Social preview regression check

Required after changes to SSR, routing, `DataResolver`, or metadata generation:

```bash
curl -A "Twitterbot/1.0" "https://nostria.app/e/<nevent>" | grep -E "og:title|og:description|og:image|twitter:title|twitter:description|twitter:image"
```

Pass = event/profile/article-specific tags. Fail = homepage fallback (`Nostria - Your Social Network`). Also available: `npm run check:social-preview:prod`.

---

## 13. Testing

### Unit (Vitest, browser mode)

Globals come from `vitest/globals` (`describe`/`it`/`expect`/`vi`) — do not import from `jasmine`, and mocks are `vi.fn()`. Specs run in real chromium, so `// @vitest-environment jsdom` and `node:*` imports do not work.

```typescript
TestBed.configureTestingModule({
  imports: [MyComponent],
  providers: [
    provideZonelessChangeDetection(), // required — the app is zoneless
    { provide: RelayService, useValue: mock },
  ],
});
```

- **Prefer `TestBed` + provider overrides.** The `Object.create(Svc.prototype)` + `Object.assign({ dep: {…} })` pattern used across this repo bypasses DI and is exactly why 64 spec files rot silently — the fake drifts, TypeScript never notices.
- If you must fake a dependency, type the fake (`satisfies Pick<RelayService, 'publish'>`) so a signature change breaks the build instead of the test run.
- Never access a `private` member off a service instance to assert on it (`service['dep']` / `service.dep`) — capture the mock in a local `const` and assert on that.
- Test behavior and edge cases. Skip `should create` filler.

### E2E (Playwright)

Full guide: [TESTING.md](./TESTING.md). Agent-relevant rules:

1. Import from `../fixtures`, never `@playwright/test` directly.
2. Tag in the `describe` title: `'Feature @auth @smoke'`. Tags: `@public` `@auth` `@smoke` `@metrics` `@network` `@security` `@a11y` `@visual`.
3. Use page objects from `e2e/pages`, constants from `e2e/fixtures/test-data.ts`, `authenticatedPage` for logged-in flows.
4. `waitForAppReady()` before asserting; `saveConsoleLogs()` at the end.
5. **No `data-testid` exists** — select via Material selectors, CSS classes, roles, or text.
6. Handle empty states; test accounts may have no relay history.
7. Nostr timestamps in seconds here too.

Results land in `test-results/` (`test-summary.json`, `results.json`, `logs/`, `metrics/`, `network/`); `npm run test:e2e:report:full` builds the Markdown report.

---

## 14. Project structure

```
src/app/
├── api/          # ng-openapi-gen output — DO NOT EDIT (npm run gen:api)
├── components/   # reusable UI
├── directives/
├── interfaces/   # shared types
├── models/
├── pages/        # lazy-loaded route components
├── pipes/
├── services/     # ~190 singletons — search before adding
├── utils/
└── workers/      # web workers
e2e/              # Playwright specs, fixtures, page objects, helpers
scripts/          # build/i18n/SSR/Tauri/perf tooling
src-tauri/        # Rust desktop+mobile shell
docs/             # long-form notes (see §16)
```

---

## 15. Command Palette

Ctrl+K is a primary navigation surface. **Any new route or top-level feature must register a command** in `src/app/components/command-palette-dialog/`, including its i18n'd label. A feature that isn't reachable from the palette is unfinished.

---

## 16. Docs & commits

- **Default: write no Markdown file.** Explain in the response instead. `docs/` has 46 files, most of them agent-generated implementation reports nobody reads — don't add to that.
- Write a doc only when explicitly asked, or when a fix is genuinely non-obvious and durable (protocol quirks, SSR/hydration traps, platform workarounds). Put it in `docs/`.
- Update [ARCHITECTURE.md](./ARCHITECTURE.md) for non-trivial architectural changes — that one is load-bearing.
- Keep this file honest: if you discover a documented command or rule that no longer matches reality, fix it here in the same change.
- Commits: `type: imperative summary` (`feat:`, `fix:`, `chore:`, `refactor:`) matching existing history. One logical change per commit. Never commit secrets, `.env`, keys, or `test-results/`.

---

## 17. References

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, relay strategy, state, SSR
- [TESTING.md](./TESTING.md) — full E2E guide
- [DEVELOPMENT.md](./DEVELOPMENT.md) — setup, line endings (note: its formatting scripts are stale)
- [.github/copilot-instructions.md](.github/copilot-instructions.md) — mirrors §4–§7 for Copilot; keep in sync
