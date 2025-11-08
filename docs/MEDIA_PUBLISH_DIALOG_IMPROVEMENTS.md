# Media Publish Dialog Improvements

## Changes Made

### 1. Fixed Blurhash Consistency Issue

**Problem**: Blurhash generated after video thumbnail extraction was different from manually clicking "Generate blurhash" button, even though thumbnails looked the same.

**Root Cause**: 
- `extractThumbnailFromVideo()` was calling `generateBlurhashFromCanvas()` which generated blurhash from the raw canvas (uncompressed pixel data)
- Manual regeneration called `loadImageAndGenerateBlurhash()` which loaded the JPEG blob via object URL (compressed data)
- JPEG compression caused slight color differences, resulting in different blurhash values

**Solution**: 
- Removed `generateBlurhashFromCanvas()` method
- Updated `extractThumbnailFromVideo()` to call `loadImageAndGenerateBlurhash()` with the object URL
- Now both automatic and manual generation use the same path: load image → resize to 32px → generate blurhash
- Ensures consistent blurhash values

### 2. Added Image Dimensions Display

**Implementation**:
- Added dimension badges to media preview (top-level image/video)
- Added dimension badges to thumbnail preview
- Dimensions shown as "WIDTH × HEIGHT" format
- Styled as semi-transparent black overlay in bottom-right corner
- Uses monospace font for clear number display

**CSS**:
```scss
.dimensions-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-family: monospace;
}
```

**Display Locations**:
1. **Main Media Preview**: Shows dimensions for images and videos (when available)
2. **Thumbnail Preview**: Shows thumbnail dimensions for video thumbnails

### 3. Removed Thumbnail Extraction from Upload Dialog

**Rationale**: 
- Publish dialog now has complete thumbnail management (extract, upload, URL)
- Upload dialog thumbnail extraction was redundant
- Simplifies upload flow
- Reduces unnecessary processing during upload

**Removed Features**:
- Automatic video thumbnail extraction on file selection
- Thumbnail preview in upload dialog
- Thumbnail upload/change/remove buttons
- `videoThumbnailUrl` and `videoThumbnailFile` signals
- `extractingThumbnail` signal
- `extractVideoThumbnail()` method
- `onThumbnailFileSelected()` method
- `clearThumbnail()` method

**Removed from media.component.ts**:
- `videoThumbnails` Map storage
- Thumbnail upload before main file upload
- Thumbnail URL passing to publish dialog

**Updated Upload Flow**:
1. User selects file
2. Preview shown for images only
3. Videos show generic file icon (no thumbnail)
4. Upload file to Blossom servers
5. Publish dialog handles all thumbnail operations

**Updated Publish Flow**:
1. Open publish dialog (no pre-populated thumbnail)
2. User can extract thumbnail from video in publish dialog
3. Thumbnail blob stored locally (not uploaded yet)
4. User fills metadata
5. On publish: thumbnail blob uploaded → URL added to imeta tag

## Benefits

### Consistency
- ✅ Blurhash values are now identical regardless of generation method
- ✅ Single code path for blurhash generation reduces bugs
- ✅ Predictable behavior for users

### User Experience
- ✅ Dimension information visible at a glance
- ✅ Simpler upload dialog (less clutter)
- ✅ All thumbnail management centralized in publish dialog
- ✅ Faster upload process (no thumbnail extraction delay)

### Code Quality
- ✅ Removed duplicate thumbnail extraction code
- ✅ Eliminated redundant Map storage
- ✅ Cleaner separation of concerns
- ✅ Reduced component complexity

## Technical Details

### Blurhash Generation Path
```
Image/Thumbnail → Object URL → Image.onload → Canvas (32px) → ImageData → encode() → Blurhash
```

### Dimension Detection
- Uses `Image.width` and `Image.height` for loaded images
- Uses `video.videoWidth` and `video.videoHeight` for video frames
- Stored as `{ width: number, height: number }` object
- Displayed in format: `{width} × {height}`

### Upload Dialog Changes
**Before**:
- File selected → Extract thumbnail (if video) → Show thumbnail preview → Upload thumbnail → Upload file

**After**:
- File selected → Show preview (images only) → Upload file

### Publish Dialog Flow
**Before**:
- Receive thumbnail URL from upload → Display → Allow regeneration

**After**:
- Start with no thumbnail → User extracts/uploads/enters URL → Auto-generate blurhash → Upload on publish

## Files Modified

1. **media-publish-dialog.component.ts**
   - Removed `generateBlurhashFromCanvas()` method
   - Updated `extractThumbnailFromVideo()` to use `loadImageAndGenerateBlurhash()`

2. **media-publish-dialog.component.html**
   - Added dimensions badge to media preview
   - Added dimensions display to thumbnail preview

3. **media-publish-dialog.component.scss**
   - Added `.dimensions-badge` styling
   - Added `.thumbnail-dimensions` styling
   - Updated `.thumbnail-preview` for image wrapper

4. **media-upload-dialog.component.ts**
   - Removed thumbnail-related signals
   - Removed thumbnail extraction methods
   - Simplified `onFileSelected()`
   - Simplified `clearFile()`
   - Updated `onSubmit()` to not include thumbnailFile

5. **media-upload-dialog.component.html**
   - Removed thumbnail preview UI
   - Removed thumbnail action buttons
   - Removed extracting thumbnail loading state

6. **media.component.ts**
   - Removed `videoThumbnails` Map
   - Removed thumbnail upload logic from upload flow
   - Removed thumbnailUrl from publish dialog data
   - Simplified `publishSingleItem()` and `publishSingleItemWithoutNavigation()`
