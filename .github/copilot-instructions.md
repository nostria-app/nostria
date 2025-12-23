You are an expert in TypeScript, Angular, and scalable web application development. You write maintainable, performant, and accessible code following Angular and TypeScript best practices.

This project is an Nostr project, that uses nostr-tools library. Make sure you follow the Nostr NIPs protocol definitions. Nostr uses
timestamp for dates that is in seconds, not milliseconds.

The application uses Angular Material, so make sure to use Angular Material components when possible.

Always use "fetch" for http request instead of HttpClient.

Never set the font-weight in CSS. The current font for headlines does not support different font weights.

For dialogs, don't use Angular Material dialogs, but the custom "CustomDialogComponent" component instead.

URL for this app is: https://nostria.app

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `computed()` for derived state
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in `@Component` decorator
- Prefer inline templates for small components
- Prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- DO NOT use `ngStyle`, use `style` bindings instead
- DO NOT put color="primary" on buttons, this is not supported in Material 3. Also for primary actions, use "mat-flat-button", not "flat-raised-button".

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Use the `inject()` function instead of constructor injection


## Styling

Always use "field-sizing: content" for textareas that grow with content. This is compatible with all modern browsers.

- The app supports dark and light mode, so make sure your styles work well in both modes.
- Don't add hardcoded colors. Use CSS variables defined in styles.scss and theme.scss

Due to Angular component styles are encapsulated by default, so use this way to ensure dark mode is applied correctly:

```css
:host-context(.dark) .your-class {
    background-color: var(--mat-sys-surface-container);
    color: var(--mat-sys-on-surface);
}
```

Don't make documentation for every change, only important and hard to understand fixes.

When you generate markdown documentation of what you have done, place those documents into the "docs" folder.

These are the CSS variables for Angular Material 3, don't use old variables.

    --mat-success-color: #66bb6a;
    --mat-success-lighter: #a5d6a7;
    --mat-success-darker: #388e3c;
    --scrollbar-track: #424242;
    --scrollbar-thumb: #686868;
    --scrollbar-thumb-hover: #7e7e7e;
    --mat-sys-background: #18111b;
    --mat-sys-error: #ffb4ab;
    --mat-sys-error-container: #93000a;
    --mat-sys-inverse-on-surface: #362e39;
    --mat-sys-inverse-primary: #5953a9;
    --mat-sys-inverse-surface: #ecdeed;
    --mat-sys-on-background: #ecdeed;
    --mat-sys-on-error: #690005;
    --mat-sys-on-error-container: #ffdad6;
    --mat-sys-on-primary: #2a2278;
    --mat-sys-on-primary-container: #e3dfff;
    --mat-sys-on-primary-fixed: #140364;
    --mat-sys-on-primary-fixed-variant: #413b8f;
    --mat-sys-on-secondary: #4a0e72;
    --mat-sys-on-secondary-container: #f3daff;
    --mat-sys-on-secondary-fixed: #2f004d;
    --mat-sys-on-secondary-fixed-variant: #632b8a;
    --mat-sys-on-surface: #ecdeed;
    --mat-sys-on-surface-variant: #f0dbff;
    --mat-sys-on-tertiary: #2a2278;
    --mat-sys-on-tertiary-container: #e3dfff;
    --mat-sys-on-tertiary-fixed: #140364;
    --mat-sys-on-tertiary-fixed-variant: #413b8f;
    --mat-sys-outline: #a186b7;
    --mat-sys-outline-variant: #543d69;
    --mat-sys-primary: #c5c0ff;
    --mat-sys-primary-container: #413b8f;
    --mat-sys-primary-fixed: #e3dfff;
    --mat-sys-primary-fixed-dim: #c5c0ff;
    --mat-sys-scrim: #000000;
    --mat-sys-secondary: #e2b5ff;
    --mat-sys-secondary-container: #632b8a;
    --mat-sys-secondary-fixed: #f3daff;
    --mat-sys-secondary-fixed-dim: #e2b5ff;
    --mat-sys-shadow: #000000;
    --mat-sys-surface: #18111b;
    --mat-sys-surface-bright: #3f3642;
    --mat-sys-surface-container: #241d27;
    --mat-sys-surface-container-high: #2f2732;
    --mat-sys-surface-container-highest: #3a323d;
    --mat-sys-surface-container-low: #201923;
    --mat-sys-surface-container-lowest: #120c15;
    --mat-sys-surface-dim: #18111b;
    --mat-sys-surface-tint: #c5c0ff;
    --mat-sys-surface-variant: #543d69;
    --mat-sys-tertiary: #c5c0ff;
    --mat-sys-tertiary-container: #413b8f;
    --mat-sys-tertiary-fixed: #e3dfff;
    --mat-sys-tertiary-fixed-dim: #c5c0ff;
    --mat-sys-neutral-variant20: #3c2751;
    --mat-sys-neutral10: #201923;
    --mat-sys-level0: 0px 0px 0px 0px rgba(0, 0, 0, 0.2), 0px 0px 0px 0px rgba(0, 0, 0, 0.14), 0px 0px 0px 0px rgba(0, 0, 0, 0.12);
    --mat-sys-level1: 0px 2px 1px -1px rgba(0, 0, 0, 0.2), 0px 1px 1px 0px rgba(0, 0, 0, 0.14), 0px 1px 3px 0px rgba(0, 0, 0, 0.12);
    --mat-sys-level2: 0px 3px 3px -2px rgba(0, 0, 0, 0.2), 0px 3px 4px 0px rgba(0, 0, 0, 0.14), 0px 1px 8px 0px rgba(0, 0, 0, 0.12);
    --mat-sys-level3: 0px 3px 5px -1px rgba(0, 0, 0, 0.2), 0px 6px 10px 0px rgba(0, 0, 0, 0.14), 0px 1px 18px 0px rgba(0, 0, 0, 0.12);
    --mat-sys-level4: 0px 5px 5px -3px rgba(0, 0, 0, 0.2), 0px 8px 10px 1px rgba(0, 0, 0, 0.14), 0px 3px 14px 2px rgba(0, 0, 0, 0.12);
    --mat-sys-level5: 0px 7px 8px -4px rgba(0, 0, 0, 0.2), 0px 12px 17px 2px rgba(0, 0, 0, 0.14), 0px 5px 22px 4px rgba(0, 0, 0, 0.12);
    --mat-sys-corner-extra-large: 28px;
    --mat-sys-corner-extra-large-top: 28px 28px 0 0;
    --mat-sys-corner-extra-small: 4px;
    --mat-sys-corner-extra-small-top: 4px 4px 0 0;
    --mat-sys-corner-full: 9999px;
    --mat-sys-corner-large: 16px;
    --mat-sys-corner-large-end: 0 16px 16px 0;
    --mat-sys-corner-large-start: 16px 0 0 16px;
    --mat-sys-corner-large-top: 16px 16px 0 0;
    --mat-sys-corner-medium: 12px;
    --mat-sys-corner-none: 0;
    --mat-sys-corner-small: 8px;
    --mat-sys-dragged-state-layer-opacity: 0.16;
    --mat-sys-focus-state-layer-opacity: 0.12;
    --mat-sys-hover-state-layer-opacity: 0.08;
    --mat-sys-pressed-state-layer-opacity: 0.12;