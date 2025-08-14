This is an Angular 20 project, make sure to always use signals and effects. Also always use most modern TypeScript, with async/await.

This project is an Nostr project, that uses nostr-tools library. Make sure you follow the Nostr NIPs protocol definitions. Nostr uses
timestamp for dates that is in seconds, not milliseconds.

Make sure to use new flow syntax of latest Angular, which is @if instead of *ngIf, @for instead of *ngFor, and @let instead of \*ngLet.

Always use separate file for component (TypeScript), markup (HTML) and styles (SCSS).

The application uses Angular Material, so make sure to use Angular Material components when possible.

Make sure to put most styles in the global styles.scss file, and only use component styles for component-specific styles.

Always use "fetch" for http request instead of HttpClient.

Don't use constructor for dependency injection, use inject instead.

For "box-shadow" CSS, make sure to always use the built-in for Angular Material:

box-shadow: var(--mat-sys-level0)
box-shadow: var(--mat-sys-level1)
box-shadow: var(--mat-sys-level2)
box-shadow: var(--mat-sys-level3)
box-shadow: var(--mat-sys-level4)
box-shadow: var(--mat-sys-level5)

Never set the font-weight in CSS. The current font for headlines does not support different font weights.

Make sure you don't use outdated variables for Angular Material, such as "--mat-sys-color-surface-container-high" and "--mat-sys-color-primary-container" and "--mat-sys-color-on-primary-container".

I'm using a Windows computer, so make sure that paths and commands are compatible with Windows.

Do not make any changes, until have you 95% confidence that you know what to build ask me follow up questions until you have that confidence
