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

# Run single E2E test file
npx playwright test e2e/tests/home.spec.ts

# Run single test by name
npx playwright test -g "should load the home page"
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
  imports: [CommonModule],           // Standalone imports
  templateUrl: './example.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,  // ALWAYS OnPush
})
export class ExampleComponent {
  data = input<DataType>();          // NOT @Input decorator
  selected = output<Item>();         // NOT @Output decorator
  private service = inject(MyService); // NOT constructor injection
  items = signal<Item[]>([]);        // State with signals
  filtered = computed(() => this.items().filter(i => i.active)); // Derived
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
@if (condition()) { <div>Content</div> }

@for (item of items(); track item.id) { <app-item [data]="item" /> }

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
const timestamp = Math.floor(Date.now() / 1000);  // CORRECT
const timestamp = Date.now();                      // WRONG!
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
