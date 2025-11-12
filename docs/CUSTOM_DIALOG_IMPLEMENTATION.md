# Custom Dialog Implementation

## Overview

Implemented a custom dialog component to replace Angular Material Dialog, providing better mobile support, easier styling, and dynamic keyboard handling.

## Implementation Details

### Components Created

#### 1. **CustomDialogComponent** (`custom-dialog-v2.component.ts`)
A reusable dialog component with the following features:

**Features:**
- ✅ Responsive design: floating centered dialog on desktop, full-screen bottom sheet on mobile
- ✅ Dynamic viewport handling: adjusts to mobile keyboard using Visual Viewport API
- ✅ Enter key support: automatically triggers primary action button
- ✅ Escape key support: closes dialog (when not disabled)
- ✅ Backdrop click to close (optional via `disableClose`)
- ✅ Back button support for multi-step flows
- ✅ Smooth animations
- ✅ Accessible with ARIA labels and keyboard navigation
- ✅ Customizable width and max-width

**Usage:**
```html
<app-custom-dialog
  [title]="'Dialog Title'"
  [headerIcon]="'icons/icon.png'"
  [showBackButton]="false"
  [showCloseButton]="true"
  [disableClose]="false"
  [width]="'600px'"
  [maxWidth]="'95vw'"
  (closed)="handleClose()"
  (backClicked)="handleBack()">
  
  <div dialog-content>
    <!-- Your content here -->
  </div>
  
  <div dialog-actions>
    <button mat-button (click)="cancel()">Cancel</button>
    <button mat-raised-button color="primary" (click)="save()">Save</button>
  </div>
</app-custom-dialog>
```

**Inputs:**
- `title`: Dialog title (string)
- `headerIcon`: Icon URL to display in header (string)
- `showBackButton`: Show back button instead of close (boolean)
- `showCloseButton`: Show close button (boolean)
- `disableClose`: Prevent closing on backdrop/escape (boolean)
- `width`: Dialog width (string, default: '600px')
- `maxWidth`: Dialog max width (string, default: '95vw')

**Outputs:**
- `closed`: Emitted when dialog closes
- `backdropClicked`: Emitted when backdrop is clicked
- `backClicked`: Emitted when back button is clicked

#### 2. **StandaloneLoginDialogComponent** (`standalone-login-dialog.component.ts`)
A wrapper component that uses CustomDialogComponent to display the LoginDialogComponent.

**Features:**
- ✅ Integrates LoginDialogComponent with CustomDialogComponent
- ✅ Manages dialog title based on login step
- ✅ Handles back button navigation through login steps
- ✅ Supports opening at specific step (e.g., 'new-user', 'login')
- ✅ Emits closed event for parent components

**Usage:**
```html
@if (layout.showStandaloneLogin()) {
  <app-standalone-login-dialog (closed)="layout.handleLoginDialogClose()" />
}
```

**Opening at Specific Step:**
```typescript
// Open at initial step (welcome screen)
await layout.showLoginDialog();

// Open at 'new-user' step (account creation flow)
await layout.showLoginDialogWithStep('new-user');

// Open at 'login' step (login options)
await layout.showLoginDialogWithStep('login');
```

### Services Modified

#### **LayoutService** (`layout.service.ts`)
Updated to support standalone dialog pattern:

```typescript
// Signal to control dialog visibility
showStandaloneLogin = signal(false);

// Signal to store the initial step for the login dialog
loginDialogInitialStep = signal<string | undefined>(undefined);

// Open dialog at initial step
async showLoginDialog(): Promise<void> {
  this.showStandaloneLogin.set(true);
}

// Open dialog at specific step
async showLoginDialogWithStep(step?: string): Promise<void> {
  this.loginDialogInitialStep.set(step);
  this.showStandaloneLogin.set(true);
  
  // Return promise that resolves when dialog closes
  return new Promise<void>((resolve) => {
    const cleanup = effect(() => {
      if (!this.showStandaloneLogin()) {
        this.loginDialogInitialStep.set(undefined);
        resolve();
        cleanup.destroy();
      }
    });
  });
}

// Handle close
handleLoginDialogClose(): void {
  this.showStandaloneLogin.set(false);
  this.loginDialogInitialStep.set(undefined);
}
```

### Components Modified

#### **LoginDialogComponent** (`login-dialog.component.ts`)
Made compatible with both MatDialog and standalone usage:

```typescript
// Optional MatDialogRef for backwards compatibility
private dialogRef = inject(MatDialogRef<LoginDialogComponent>, { optional: true });

// Output event for standalone mode
dialogClosed = output<void>();

closeDialog(): void {
  // Works with both MatDialog and standalone
  if (this.dialogRef) {
    this.dialogRef.close();
  }
  this.dialogClosed.emit();
}
```

### Styling

#### **custom-dialog.component.scss**
Comprehensive responsive styling:

**Desktop (>600px):**
- Centered floating dialog
- 600px default width
- 90vh max height
- Rounded corners (16px)
- Backdrop blur effect

**Mobile (≤600px or ≤700px height):**
- Full-width bottom sheet
- Slides up from bottom
- Rounded top corners only
- 95dvh max height (uses dynamic viewport height)

**Mobile Keyboard Handling:**
- Uses Visual Viewport API to detect keyboard
- Dynamically adjusts dialog height when keyboard appears
- Ensures dialog content remains visible above keyboard
- Uses CSS custom property `--viewport-height` for dynamic adjustment

**Responsive Breakpoints:**
- `max-width: 600px`: Mobile phone width
- `max-height: 700px`: Landscape mobile or short screens
- `max-height: 600px`: Very short screens (further reduced padding)
- `max-width: 400px`: Very small screens (single column buttons)

## Mobile Keyboard Support

The dialog uses the Visual Viewport API to handle mobile keyboards intelligently:

```typescript
const visualViewport = window.visualViewport;
visualViewport.addEventListener('resize', () => {
  const viewportHeight = visualViewport.height;
  container.style.setProperty('--viewport-height', `${viewportHeight}px`);
});
```

When the keyboard appears:
1. Visual viewport height decreases
2. Dialog height adjusts via CSS custom property
3. Content remains scrollable and visible
4. Dialog doesn't hide behind keyboard

## Enter Key Support

The dialog automatically detects the primary action button and triggers it on Enter:

```typescript
// Finds buttons with color="primary" or class="primary-action"
const primaryButton = container.querySelector(
  '[dialog-actions] button[color="primary"], [dialog-actions] .primary-action'
);

// Triggered on Enter key (excluding textareas and existing buttons)
if (event.key === 'Enter' && !event.shiftKey) {
  primaryButton?.click();
}
```

## Browser Compatibility

### CSS Features Used:
- ✅ CSS Custom Properties (all modern browsers)
- ✅ CSS Grid & Flexbox (all modern browsers)
- ✅ `backdrop-filter` with `-webkit-` prefix (Safari support)
- ✅ Dynamic Viewport Units (`dvh`) with fallback
- ✅ `@supports` queries for progressive enhancement

### JavaScript Features Used:
- ✅ Visual Viewport API (Chrome 61+, Safari 13+, Firefox 91+)
- ✅ Graceful fallback when API unavailable

## Migration Guide

### Replacing MatDialog with CustomDialog

**Before (MatDialog):**
```typescript
const dialogRef = this.dialog.open(MyComponent, {
  width: '500px',
  disableClose: true
});

dialogRef.afterClosed().subscribe(result => {
  console.log('Closed:', result);
});
```

**After (CustomDialog):**
```html
@if (showMyDialog()) {
  <app-custom-dialog
    [title]="'My Dialog'"
    [width]="'500px'"
    [disableClose]="true"
    (closed)="handleClose()">
    <div dialog-content>
      <my-component />
    </div>
  </app-custom-dialog>
}
```

```typescript
showMyDialog = signal(false);

openDialog() {
  this.showMyDialog.set(true);
}

handleClose() {
  this.showMyDialog.set(false);
  console.log('Closed');
}
```

## Testing Checklist

- [ ] Desktop: Dialog centers properly
- [ ] Desktop: Backdrop click closes dialog (when enabled)
- [ ] Desktop: Escape key closes dialog (when enabled)
- [ ] Desktop: Enter key triggers primary action
- [ ] Mobile: Dialog slides from bottom
- [ ] Mobile: Full-width on small screens
- [ ] Mobile: Keyboard doesn't hide dialog content
- [ ] Mobile: Dialog adjusts height when keyboard appears
- [ ] Tablet: Responsive at various sizes
- [ ] Landscape: Works in landscape orientation
- [ ] Accessibility: Keyboard navigation works
- [ ] Accessibility: ARIA labels present
- [ ] Animation: Smooth transitions
- [ ] Back button: Navigates through steps
- [ ] Header icon: Displays correctly

## Files Created

1. `src/app/components/custom-dialog/custom-dialog-v2.component.ts`
2. `src/app/components/custom-dialog/custom-dialog.component.scss` (reused)
3. `src/app/components/standalone-login-dialog/standalone-login-dialog.component.ts`

## Files Modified

1. `src/app/services/layout.service.ts`
2. `src/app/components/login-dialog/login-dialog.component.ts`
3. `src/app/app.ts`
4. `src/app/app.html`

## Next Steps

To fully migrate from MatDialog:

1. **Test on real devices:**
   - iOS Safari (iPhone, iPad)
   - Android Chrome
   - Various screen sizes

2. **Update other dialogs:**
   - Create wrapper components for other dialogs
   - Migrate one dialog at a time
   - Test each migration thoroughly

3. **Remove MatDialog dependency** (optional):
   - Once all dialogs migrated
   - Remove from package.json
   - Reduce bundle size

## Benefits

### Compared to Material Dialog:

✅ **Easier Styling:** No need to fight Angular Material's deep CSS
✅ **Better Mobile UX:** Native bottom sheet behavior on mobile
✅ **Keyboard Handling:** Built-in support for mobile keyboards
✅ **Smaller Bundle:** Can eventually remove Material Dialog
✅ **More Control:** Full control over dialog behavior
✅ **Modern CSS:** Uses latest CSS features with fallbacks
✅ **Performance:** Simpler implementation, faster rendering
✅ **Accessibility:** Better keyboard and screen reader support
