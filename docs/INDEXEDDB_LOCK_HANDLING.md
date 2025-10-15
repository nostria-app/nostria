# IndexedDB Lock Detection and Error Handling

## Problem

When the browser's IndexedDB database becomes corrupted or locked, Nostria would hang indefinitely on the "Starting Nostria..." screen. The fallback code would attempt to delete and recreate the database, but if the database was permanently locked (e.g., by another tab or browser process), the fallback would timeout without informing the user, leaving the app in an unusable state.

## Solution

Implemented comprehensive error handling for IndexedDB initialization with the following improvements:

### 1. Timeout on Fallback Initialization

Added an 8-second timeout to the fallback initialization process. Previously, the fallback could hang indefinitely when trying to delete or recreate a locked database.

```typescript
const fallbackInitPromise = this.performFallbackInit();
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => {
    reject(new Error('Fallback initialization timeout after 8 seconds'));
  }, 8000);
});

await Promise.race([fallbackInitPromise, timeoutPromise]);
```

### 2. Permanent Failure Detection

Implemented logic to detect permanent database failures (locks, blocks, version errors) and distinguish them from temporary issues:

```typescript
const isPermanentFailure =
  errorMessage.includes('timeout') ||
  errorMessage.includes('blocked') ||
  errorMessage.includes('lock') ||
  errorMessage.includes('VersionError');
```

When a permanent failure is detected:
- The `isPermanentFailure` flag is set in the storage info signal
- The error is propagated to the app initialization layer
- The app stops the loading spinner and displays an error dialog

### 3. User-Facing Error Dialog

Created a new `DatabaseErrorDialogComponent` that provides clear instructions to users when the database is permanently locked:

**Dialog Content:**
- Explains that Nostria cannot access the IndexedDB database
- Lists common causes (other tabs, corrupted storage, browser extensions)
- Provides step-by-step resolution instructions:
  1. Close all Nostria tabs/windows
  2. Completely restart the browser
  3. If issue persists, clear site data

The dialog is shown as a modal (non-dismissible) to ensure the user sees the instructions.

### 4. Proper Error Propagation

Fixed the error handling flow to properly propagate errors from fallback initialization:

**Before:**
```typescript
private handleInitializationError(error: any): void {
  // ...
  this.attemptFallbackInitialization(); // Fire and forget
}
```

**After:**
```typescript
private async handleInitializationError(error: any): Promise<void> {
  // ...
  await this.attemptFallbackInitialization(); // Await and propagate errors
}
```

This ensures that when the fallback fails with a permanent error, the error is thrown up to the app initialization layer.

### 5. Loading State Management

Updated the app initialization to properly handle permanent failures:

```typescript
const storageInfo = this.storage.storageInfo();
if (storageInfo.isPermanentFailure) {
  this.appState.isLoading.set(false);
  this.appState.loadingMessage.set('Database Error');
  return; // Don't continue initialization
}
```

This prevents the app from hanging on "Starting Nostria..." and instead shows the error dialog with the loading spinner removed.

## Technical Details

### Modified Files

1. **`src/app/services/storage.service.ts`**
   - Added `isPermanentFailure` flag to `storageInfo` signal
   - Added timeout to fallback initialization
   - Implemented permanent failure detection
   - Made error handling methods async to properly propagate errors
   - Split fallback logic into `performFallbackInit()` for better timeout handling

2. **`src/app/app.ts`**
   - Imported `DatabaseErrorDialogComponent`
   - Updated `showStorageError()` to check for permanent failures
   - Added logic to stop app initialization on permanent failures
   - Shows modal error dialog for permanent failures
   - Shows snackbar for temporary failures

3. **`src/app/components/database-error-dialog/database-error-dialog.component.ts`** (new)
   - Standalone component using Angular Material
   - Clear, user-friendly error message
   - Step-by-step resolution instructions
   - Non-dismissible modal dialog

## Testing

To test the fix:

1. **Simulate a locked database:**
   - Open Nostria in multiple tabs
   - Open browser DevTools > Application > Storage > IndexedDB
   - While the app is loading, try to manually delete the database
   - This can sometimes trigger a lock condition

2. **Force a timeout:**
   - Add a breakpoint in the fallback initialization code
   - Let it sit for more than 8 seconds
   - Verify the timeout error is properly handled

3. **Verify the dialog:**
   - Ensure the dialog appears when a permanent failure occurs
   - Check that the loading spinner disappears
   - Verify the dialog content is clear and helpful

## Benefits

1. **No more hanging:** Users no longer experience an indefinite "Starting Nostria..." state
2. **Clear guidance:** Users receive actionable instructions to resolve the issue
3. **Better UX:** Distinguishes between temporary failures (snackbar) and permanent failures (modal dialog)
4. **Proper error handling:** Errors are properly propagated and handled throughout the initialization chain
5. **Debugging:** Better logging and error detection for troubleshooting database issues

## Future Improvements

- Add a "Clear Site Data" button directly in the error dialog
- Implement automatic retry logic with exponential backoff
- Add telemetry to track how often database locks occur
- Consider implementing a fallback to localStorage for critical data when IndexedDB is unavailable
