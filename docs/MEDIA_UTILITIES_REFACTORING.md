# Media Utilities Refactoring - NIP-92/NIP-94 Support

## Summary

This implementation adds comprehensive NIP-92 (inline metadata) and NIP-94 (file metadata) support to Nostria, with a focus on code reusability and maintainability.

## Key Changes

### 1. Centralized UtilitiesService Extensions

Added media-related utility methods to `utilities.service.ts`:

| Method | Purpose | Returns |
|--------|---------|---------|
| `extractThumbnailFromVideo()` | Extract frame from video | blob, dimensions, objectUrl |
| `generateBlurhash()` | Generate blurhash from image | blurhash, dimensions |
| `getImageDimensions()` | Get image width/height | dimensions |
| `extractMediaMetadata()` | Complete metadata for files | url, mimeType, blurhash, dimensions |
| `buildImetaTag()` | Format NIP-92/94 imeta tag | string[] tag array |

### 2. Note Editor Dialog - NIP-92 Support

**File**: `note-editor-dialog.component.ts`

- Added `MediaMetadata` interface for tracking uploaded media
- Added `mediaMetadata` signal to store metadata for all uploads
- Modified `uploadFiles()` to extract metadata automatically
- Updated `buildTags()` to include imeta tags when publishing
- Simplified code by using centralized utilities

**Result**: Kind 1 notes now include rich metadata for inline images

### 3. Media Publish Dialog - Refactoring

**File**: `media-publish-dialog.component.ts`

- Replaced inline thumbnail extraction with `utilities.extractThumbnailFromVideo()`
- Replaced inline blurhash generation with `utilities.generateBlurhash()`
- Reduced code duplication
- Improved maintainability

**Result**: Cleaner, more maintainable code with consistent behavior

## Technical Implementation

### Blurhash Generation

All blurhash generation uses consistent parameters:
- **Resolution**: 64px width (aspect-ratio preserved)
- **Components**: 6x4 (horizontal x vertical)
- **Quality**: Good balance between visual fidelity and hash length

### Thumbnail Extraction

Video thumbnail extraction:
- Default seek time: 1 second or 10% of duration
- Support for offset-based sequential extraction
- Output format: JPEG at 90% quality
- Automatic cleanup of temporary resources

### IMETA Tag Format (NIP-92)

```
["imeta", "url <url>", "m <mime-type>", "blurhash <hash>", "dim <widthxheight>", ...]
```

Supported fields:
- `url` - Media URL (required)
- `m` - MIME type
- `blurhash` - Blurhash string
- `dim` - Dimensions (widthxheight)
- `alt` - Alt text for accessibility
- `x` - SHA-256 hash
- `size` - File size in bytes
- `duration` - Duration for videos
- `thumb` - Thumbnail URL

## Usage Examples

### Note Editor (Kind 1 Events)

When a user uploads an image while composing a note:

1. File is uploaded to media server
2. Metadata is automatically extracted (blurhash, dimensions, MIME type)
3. URL is inserted into note content
4. Metadata is stored in component state
5. On publish, imeta tag is added to event tags

### Media Publish (Kind 20/21/22 Events)

When publishing a video with thumbnail:

1. User selects video
2. Thumbnail is auto-extracted at 1 second
3. Blurhash is generated from thumbnail
4. All metadata is included in kind 21/22 event

## Benefits

### For Users
- **Rich Previews**: Beautiful blurhash placeholders while media loads
- **Better Performance**: Proper space allocation with dimensions
- **Accessibility**: Metadata supports screen readers

### For Developers
- **Code Reusability**: Single source of truth for media utilities
- **Maintainability**: Changes in one place affect all components
- **Consistency**: Same algorithms across the application
- **Standards Compliance**: Follows NIP-92 and NIP-94 specifications

## Files Modified

1. `src/app/services/utilities.service.ts` - Added media utilities
2. `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` - NIP-92 support
3. `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.ts` - Refactored to use utilities
4. `docs/NOTE_EDITOR_IMETA_SUPPORT.md` - Updated documentation

## Testing Recommendations

### Manual Testing

1. **Note Editor**:
   - Upload various image types (JPEG, PNG, WebP, GIF)
   - Verify blurhash generation
   - Check imeta tags in published events
   - Test with multiple images in one note

2. **Media Publish Dialog**:
   - Test video thumbnail extraction
   - Try manual thumbnail upload
   - Verify blurhash for custom thumbnails
   - Test with different video formats

### Automated Testing (Future)

Consider adding tests for:
- Blurhash generation consistency
- Thumbnail extraction accuracy
- IMETA tag formatting
- Error handling for corrupt media

## Future Enhancements

### Short Term
- Add user-editable alt text fields
- Generate SHA-256 hashes for files
- Support fallback URLs

### Long Term
- Audio file metadata support
- Video dimension extraction
- Multiple thumbnail generation
- IPFS integration for fallback URLs
- Automatic image optimization

## Related NIPs

- **NIP-92**: Media Attachments (inline metadata for kind 1)
- **NIP-94**: File Metadata (dedicated file metadata events)
- **NIP-96**: HTTP File Storage Integration

## References

- [NIP-92 Specification](https://github.com/nostr-protocol/nips/blob/master/92.md)
- [NIP-94 Specification](https://github.com/nostr-protocol/nips/blob/master/94.md)
- [Blurhash Algorithm](https://github.com/woltapp/blurhash)
