# Note Editor Error Handling & Upload Original Option

## Overview

Enhanced the note editor dialog to provide better error visibility and upload control options when users drag and drop media files.

## Changes Made

### 1. Error Display in Note Editor Dialog

**Problem**: When uploading media files via drag-and-drop in the note editor, errors were not visible to users. Errors only appeared in the Media Library, not in the "Create Note" dialog.

**Solution**: Added an error display section at the top of the note editor dialog content that shows any errors from the `MediaService`.

#### Implementation Details

- Made `mediaService` public in `NoteEditorDialogComponent` to allow template access
- Added `dismissError()` method to clear media service errors
- Added error container in the HTML template that:
  - Shows when `mediaService.error()` has a value
  - Displays the error message with a warning icon
  - Provides a "Dismiss" button to clear the error
  - Uses proper error styling with red background and border

#### Template Changes

```html
<!-- Error display -->
@if (mediaService.error()) {
  <div class="error-container">
    <mat-icon color="warn">error</mat-icon>
    <p>{{ mediaService.error() }}</p>
    <button mat-button (click)="dismissError()">Dismiss</button>
  </div>
}
```

#### Styles Added

```scss
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  margin-bottom: 16px;
  text-align: center;
  border-radius: 8px;
  background-color: rgba(255, 0, 0, 0.05);
  border: 1px solid var(--mat-sys-error);
  
  // Supports multi-line error messages
  p {
    white-space: pre-line;
    word-break: break-word;
  }
}
```

### 2. Upload Original Option in Advanced Options

**Problem**: Users could not choose to upload original video files without transcoding when using the note editor. The transcoding might fail, causing upload errors.

**Solution**: Added an "Upload Original" checkbox in the Advanced Options section that allows users to skip transcoding and optimization.

#### Implementation Details

- Added `uploadOriginal` signal to component state
- Included `uploadOriginal` in auto-draft save/restore functionality
- Updated `uploadFiles()` method to use the `uploadOriginal()` value when calling `mediaService.uploadFile()`
- Added checkbox in the Advanced Options section before the Expiration option

#### Template Changes

```html
<!-- Upload Original Option -->
<div class="option-row">
  <div class="option-header">
    <mat-slide-toggle
      [checked]="uploadOriginal()"
      (change)="uploadOriginal.set($event.checked)"
      color="primary"
    >
      Upload Original
    </mat-slide-toggle>
    <span class="option-description">
      Skip transcoding and optimization when uploading media files
    </span>
  </div>
</div>
```

### 3. Enhanced Error Messages

**Problem**: Upload error messages were generic and didn't provide details about what went wrong.

**Solution**: Enhanced the error display in `uploadFiles()` to show detailed error messages for each failed file.

#### Implementation Details

```typescript
if (failed.length > 0) {
  // Show detailed error message for each failed file
  const errorMessages = failed
    .map(f => `${f.fileName}: ${f.error}`)
    .join('\n');
  
  this.snackBar.open(
    `Failed to upload ${failed.length} file(s):\n${errorMessages}`,
    'Close',
    {
      duration: 8000,
      panelClass: 'error-snackbar',
    }
  );
}
```

### 4. Auto-Save Integration

The `uploadOriginal` setting is now included in the auto-draft functionality:

- Saved when auto-saving drafts
- Restored when loading auto-saved drafts
- Part of the `NoteAutoDraft` interface

### 5. Code Quality Improvements

- Fixed lint error: Changed traditional `for` loop to `for-of` loop in `handlePaste()` method
- Changed `<label>` to `<span>` for mentions section to fix accessibility warning

## User Experience Flow

1. **User opens Create Note dialog**
2. **User drags and drops a video file**
3. **If transcoding fails:**
   - Error message appears at the top of the dialog
   - User can dismiss the error
   - User can enable "Upload Original" in Advanced Options
   - User drags and drops the video again
   - Video uploads successfully without transcoding

## Benefits

- **Better visibility**: Users immediately see what went wrong with their uploads
- **More control**: Users can choose to skip transcoding when needed
- **Better UX**: Clear error messages help users understand and fix issues
- **Consistent experience**: Error handling matches the pattern used in Media Library
- **Persistent settings**: Upload Original preference is saved in drafts

## Files Modified

1. `note-editor-dialog.component.ts`
   - Made `mediaService` public
   - Added `uploadOriginal` signal
   - Added `dismissError()` method
   - Updated `uploadFiles()` to use `uploadOriginal()` setting
   - Enhanced error message display
   - Updated auto-save/restore logic
   - Fixed lint issues

2. `note-editor-dialog.component.html`
   - Added error display section
   - Added "Upload Original" option in Advanced Options
   - Fixed accessibility issue with mentions label

3. `note-editor-dialog.component.scss`
   - Added styles for error container

## Testing Recommendations

1. Test drag-and-drop with various file types (images, videos)
2. Test with transcoding-problematic video files
3. Test error display and dismiss functionality
4. Test "Upload Original" option with different file types
5. Test auto-save/restore with Upload Original enabled
6. Test error messages with multiple failed uploads
7. Verify responsive behavior on mobile devices
