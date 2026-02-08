# Codebase Improvement Task

You are performing autonomous codebase maintenance and improvement. Pick ONE area from the categories below, make focused improvements, then commit your changes. Do not try to do everything at once -- focus on one meaningful improvement per run.

**Important:** Read `AGENTS.md` before making any changes. Follow all project conventions.

## Categories (pick one per run)

### 1. Duplicate Code Detection & Elimination

- Look for duplicate or near-duplicate functions across services and components
- Extract shared logic into utility functions in `src/app/utils/`
- Consolidate similar component patterns into reusable components in `src/app/components/`
- Look for copy-pasted event handling, data transformation, or formatting logic

### 2. Dead Code Removal

- Find unused imports, variables, functions, and components
- Remove commented-out code blocks that are no longer relevant
- Identify components or services that are never referenced in routes or templates
- Clean up unused CSS/SCSS rules

### 3. Type Safety Improvements

- Replace `any` types with proper interfaces or `unknown`
- Add missing return types to functions
- Strengthen interface definitions where fields are too loosely typed
- Add missing null/undefined checks where TypeScript strict mode would benefit

### 4. Performance Improvements

- Identify components missing `ChangeDetectionStrategy.OnPush`
- Find subscriptions that should use signals instead
- Look for unnecessary re-renders caused by mutable state patterns
- Check for missing `track` expressions in `@for` loops
- Identify large bundle imports that could be lazy-loaded
- Look for N+1 patterns in data fetching

### 5. Code Consistency & Style

- Ensure all components use `input()` / `output()` instead of `@Input()` / `@Output()` decorators
- Ensure all DI uses `inject()` instead of constructor injection
- Ensure native control flow (`@if`, `@for`) is used instead of structural directives
- Make sure `host: {}` is used instead of `@HostBinding` / `@HostListener`
- Verify CSS uses Material 3 variables instead of hardcoded colors

### 6. Error Handling

- Find places where errors are silently swallowed (empty catch blocks)
- Add proper error handling to fetch calls that lack it
- Ensure async operations have appropriate error boundaries
- Add user-facing error messages where operations can fail

### 7. SSR Safety

- Find direct browser API usage (`window`, `document`, `localStorage`) that is not guarded
- Wrap browser-only code with `isPlatformBrowser` checks
- Ensure no component directly accesses DOM without platform guards

### 8. Template Improvements

- Simplify overly complex template expressions by moving logic into computed signals
- Look for repeated template patterns that should be extracted into components
- Ensure accessibility attributes (aria-labels, roles) are present on interactive elements

## Guidelines

- **Make small, focused changes** -- one category, a few files at most
- **Run lint after changes** (`npm run lint`) and fix any issues
- **Run the build** (`npm run build`) to make sure nothing is broken
- **Commit with a clear message** describing what was improved and why
- **Do not modify** files in `src/app/api/` (generated code)
- **Do not modify** `package-lock.json` or lock files
- **Do not create new documentation files** unless the improvement specifically warrants it
- **Prefer editing existing files** over creating new ones
