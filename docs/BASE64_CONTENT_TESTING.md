# Testing Base64 Content Support

## Test Cases

### 1. Base64 Image Rendering
**Input:**
```
Check out this embedded image:
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
```

**Expected Result:**
- Image should render inline in a media container
- Image should be clickable to open in image dialog
- No lazy loading attribute

### 2. Base64 Audio Rendering
**Input:**
```
Listen to this:
data:audio/mp3;base64,SUQzAwAAAAAAFlRJVDIAAAAGAAAAZm9vYmFyAAAAAAAAAAAA
```

**Expected Result:**
- Audio player with controls should be displayed
- Should be able to play/pause

### 3. Base64 Video Rendering
**Input:**
```
Watch this:
data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAArtts
```

**Expected Result:**
- Video player with controls should be displayed
- Should be able to play/pause
- No format validation needed (browser handles data URL)

### 4. Mixed Content
**Input:**
```
Regular image: https://example.com/image.png
Embedded image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
Regular text here
```

**Expected Result:**
- Regular image loads from URL
- Base64 image renders inline
- Text appears between them

## Manual Testing Steps

1. Create a new note with base64 content
2. Verify the media renders correctly
3. Test clicking on base64 images to open dialog
4. Test audio/video controls work
5. Verify mixed content with URLs and base64 works

## Performance Considerations

- Large base64 content may cause slower parsing
- Monitor memory usage with multiple embedded images
- Consider size limits in production

## Security Notes

- Browser CSP policies apply to data URLs
- No external requests for base64 content
- Same-origin policy doesn't apply to data URLs
