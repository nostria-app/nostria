# Browser Extension Signing Dialog Implementation

## Overview
Implemented a temporary popup dialog that informs users when they need to approve a signing request in their browser extension (Alby, nos2x, etc.). The dialog automatically closes once the signing operation completes.

## Changes Made

### 1. Created Signing Dialog Component
**File:** `src/app/components/signing-dialog/signing-dialog.component.ts`

- Standalone Angular component using Angular Material
- Shows a spinner and instructional text
- Minimal, centered design with clear messaging
- Responsive and works in both light and dark themes
- Uses `ViewEncapsulation.None` to ensure proper z-index styling

### 2. Updated NostrService
**File:** `src/app/services/nostr.service.ts`

**Added imports:**
- `MatDialog` from `@angular/material/dialog`
- `SigningDialogComponent`

**Injected MatDialog service:**
```typescript
private readonly dialog = inject(MatDialog);
```

**Modified `sign()` method:**
- Opens the signing dialog before calling `window.nostr.signEvent()`
- Uses try-finally block to ensure dialog closes even if signing fails
- Dialog configuration:
  - `disableClose: true` - prevents user from accidentally closing
  - `hasBackdrop: true` - creates backdrop behind dialog
  - Custom panel and backdrop classes for styling

### 3. Added Global Styles
**File:** `src/styles.scss`

Added styling for the signing dialog to ensure it appears **above** the backdrop:
- `.signing-dialog-backdrop` - backdrop with blur effect and z-index 1000
- `.signing-dialog` - dialog panel with higher z-index (1001)
- Multiple CSS selectors to ensure proper stacking context
- Safari compatibility with `-webkit-backdrop-filter` prefix
- Dark theme support
- `!important` flags to override Material's default z-index values

**Z-index strategy:**
- Backdrop: z-index 1000
- Dialog: z-index 1001
- Used multiple selectors to target CDK overlay structure
- Added `!important` to ensure precedence

## Behavior

1. **When signing starts:** Dialog appears immediately with spinner and instruction text
2. **During signing:** User sees the dialog while approving in their extension
3. **When signing completes:** Dialog automatically closes (whether successful or not)
4. **Multiple requests:** Each signing request will show the dialog independently, so multiple requests in sequence work correctly

## User Experience

- Clear visual feedback that a signing action is pending
- Instructions guide user to look for extension popup
- Non-intrusive design that doesn't block other UI elements
- Automatic cleanup ensures no orphaned dialogs
- Works with all NIP-07 compatible browser extensions
- **Dialog appears above backdrop** with proper z-index layering

## Technical Notes

- Dialog uses Material Design components for consistency
- Z-index values ensure proper stacking above backdrop and other UI elements
- Try-finally pattern ensures dialog is always closed, preventing memory leaks
- Only appears for browser extension accounts (not nsec, remote, or preview accounts)
- `ViewEncapsulation.None` used to allow global style overrides
- Multiple CSS selector strategies ensure compatibility with CDK overlay structure

## Troubleshooting

If the dialog appears behind the backdrop:
1. Check that `ViewEncapsulation.None` is set on the component
2. Verify the z-index values in global styles (backdrop: 1000, dialog: 1001)
3. Ensure `!important` flags are present on z-index declarations
4. Clear browser cache and rebuild the application
