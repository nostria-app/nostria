# Article Editor Image Upload Implementation

## Summary
Added file upload functionality to the article editor's "Image URL" field, providing the same user experience as the profile edit page. Users can now either paste an image URL or upload an image file directly to their configured media servers.

## Implementation Details

### Component Changes (`editor.component.ts`)

1. **Imports Added**:
   - `MediaService` - Handles file uploads to Blossom media servers
   - `MatSlideToggleModule` - Provides the File/URL toggle switch

2. **Interface Updates**:
   - Added `selectedImageFile?: File` to `ArticleDraft` interface to store selected file
   - Added `imageUrl?: string` to store URL input separately from the main image field

3. **New Signals**:
   - `useImageUrl = signal(true)` - Tracks whether user is in URL or file upload mode (defaults to URL)
   - `previewImage = signal<string | null>(null)` - Stores preview of selected image
   - `hasMediaServers = computed()` - Checks if media servers are configured

4. **New Methods**:
   - `onFileSelected(event: Event)` - Handles file selection from input
     - Validates file type (must be image)
     - Creates base64 preview using FileReader
     - Stores file in article signal for later upload
   - `onImageUrlChange()` - Handles URL input changes
     - Updates preview and main image field
   - `toggleImageInputMethod()` - Switches between file and URL modes
     - Preserves existing values when switching
     - Clears file selection appropriately
   - `navigateToMediaSettings()` - Navigates to media server configuration

5. **Upload Integration**:
   - Modified `publishArticle()` method to handle file uploads before publishing
   - Uploads file to media servers using `media.uploadFile()`
   - Updates article image field with the uploaded URL
   - Shows error message if upload fails and aborts publish

### Template Changes (`editor.component.html`)

Replaced the simple Image URL field with a comprehensive upload section:

```html
<div class="file-upload-section">
  <div class="section-header">
    <h3>Article Image</h3>
    <div class="toggle-container">
      <span>File</span>
      <mat-slide-toggle [checked]="useImageUrl()" (change)="toggleImageInputMethod()">
      </mat-slide-toggle>
      <span>URL</span>
    </div>
  </div>

  <!-- Warning when no media servers configured (file mode only) -->
  @if (!useImageUrl() && !hasMediaServers()) {
    <div class="media-server-warning">
      <mat-icon color="warn">warning</mat-icon>
      <span>You need to configure a media server to upload image files</span>
      <button mat-flat-button (click)="navigateToMediaSettings()">
        Configure Media Server
      </button>
    </div>
  }

  <!-- File upload mode -->
  @if (!useImageUrl()) {
    <div class="file-upload">
      <button mat-stroked-button (click)="articleImageInput.click()" [disabled]="!hasMediaServers()">
        <mat-icon>upload</mat-icon>
        Choose article image
      </button>
      <input #articleImageInput type="file" hidden (change)="onFileSelected($event)" accept="image/*" />
      @if (previewImage()) {
        <span>File selected</span>
      }
    </div>
  }
  
  <!-- URL mode -->
  @else {
    <mat-form-field appearance="outline">
      <mat-icon matPrefix>image</mat-icon>
      <mat-label>Image URL</mat-label>
      <input matInput [value]="article().imageUrl || article().image"
             (input)="updateImage($any($event.target).value)"
             (blur)="onImageUrlChange()" />
      <mat-icon matSuffix>link</mat-icon>
    </mat-form-field>
  }
</div>
```

### Style Changes (`editor.component.scss`)

Added styles for the new file upload section:

```scss
.file-upload-section {
  margin-bottom: 16px;

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;

    h3 {
      margin: 0;
      font-size: 1rem;
    }

    .toggle-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  .file-upload {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 20px;
    margin-bottom: 20px;
  }
}

.media-server-warning {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  margin-bottom: 16px;
  border-radius: 4px;
  border-left: 4px solid var(--mat-warn-500);
}
```

## User Experience

### URL Mode (Default)
- User sees familiar text input field with icons
- Can paste image URLs directly
- Preview updates on blur

### File Mode
- User sees "Choose article image" button
- Clicking opens native file picker
- Only image files accepted
- Shows "File selected" confirmation
- File uploaded to media servers when article is published

### Media Server Check
- If no media servers configured, file upload is disabled
- Warning message displayed with link to settings
- "Configure Media Server" button navigates to media settings

### Publish Flow
1. User selects file and fills out article
2. Clicks "Publish Article"
3. File uploads to media servers first
4. Upload URL stored in article event
5. Article published with uploaded image URL
6. If upload fails, publish aborts and error shown

## Technical Notes

- File upload uses `MediaService.uploadFile()` method
- Upload parameters: `uploadOriginal: false`, uses configured media servers
- Upload happens during publish, not on file selection
- Follows Blossom protocol (BUD-02, BUD-06)
- File validation: checks MIME type starts with "image/"
- Preview generated using FileReader base64 encoding
- Pattern matches profile-edit component exactly for consistency

## Files Modified

- `src/app/pages/article/editor/editor.component.ts` - Component logic
- `src/app/pages/article/editor/editor.component.html` - Template structure
- `src/app/pages/article/editor/editor.component.scss` - Styling
