# Video Filter System Documentation

## Overview

This document describes the video filter system implemented for the Nostria video recording dialog. The system provides real-time video effects using WebGL for high-performance GPU-accelerated processing.

## Architecture

The video filter system consists of two main components:

1. **VideoFilterService** - Core service managing filter logic and WebGL rendering
2. **VideoRecordDialogComponent** - UI integration for filter selection and preview

## VideoFilterService

Location: `src/app/services/video-filter.service.ts`

### Features

- 14 different video filters
- WebGL-based GPU acceleration
- Real-time processing at 30fps
- Zero external dependencies
- Browser compatibility: Chrome, Edge, and other Chromium-based browsers

### Available Filters

| Filter ID | Name | Description | Effect Type |
|-----------|------|-------------|-------------|
| `none` | None | No filter applied | - |
| `grayscale` | Grayscale | Black and white effect | Color Transform |
| `sepia` | Sepia | Vintage warm tone | Color Transform |
| `invert` | Invert | Inverted colors | Color Transform |
| `edge` | Edge Detect | Traced/cartoon outline | Convolution |
| `cartoon` | Cartoon | Posterized cartoon style | Posterization |
| `blur` | Blur/Beautify | Soft focus effect | Convolution |
| `sharpen` | Sharpen | Enhanced details | Convolution |
| `brightness` | Brighten | Increased brightness | Adjustment |
| `contrast` | Contrast | Enhanced contrast | Adjustment |
| `vignette` | Vignette | Dark edge fade | Artistic |
| `warmth` | Warmth | Warm color temperature | Color Transform |
| `cool` | Cool | Cool color temperature | Color Transform |
| `pixelate` | Pixelate | Pixel art effect | Artistic |

### Technical Implementation

The service uses WebGL fragment shaders to process video frames in real-time:

```typescript
// Initialize WebGL context
const initialized = filterService.initWebGL(canvasElement);

// Set active filter
filterService.setFilter('grayscale');

// Apply filter to each frame (called in animation loop)
filterService.applyFilter(videoElement, canvasElement);
```

### WebGL Shaders

Each filter is implemented as a case in the fragment shader:

- **Grayscale**: Luminance-based desaturation using industry-standard weights (0.299, 0.587, 0.114)
- **Sepia**: Matrix-based color transformation for vintage effect
- **Edge Detection**: Sobel-like kernel convolution for edge highlighting
- **Cartoon**: Posterization using color level quantization
- **Blur**: Gaussian-like kernel for smooth blur effect
- **Convolution Filters**: 3x3 kernel operations for various effects

## Video Recording Integration

Location: `src/app/pages/media/video-record-dialog/`

### User Interface

The filter system is integrated into the video recording dialog with:

1. **Filter Toggle Button** - Top-right button to show/hide filter selection
2. **Filter Chip Selector** - Horizontal scrolling list of available filters
3. **Real-time Preview** - Live preview of selected filter on camera feed
4. **Filtered Recording** - Records video with filter applied

### UI Components

```html
<!-- Filter button -->
<button mat-icon-button class="filters-button" (click)="toggleFilters()">
  <mat-icon>photo_filter</mat-icon>
</button>

<!-- Filter selection panel -->
<div class="filter-selection">
  <div class="filter-chips">
    @for (filter of filterService.availableFilters; track filter.id) {
      <button class="filter-chip" [class.selected]="selectedFilter() === filter.id">
        <mat-icon>{{ filter.icon }}</mat-icon>
        <span>{{ filter.name }}</span>
      </button>
    }
  </div>
</div>
```

### Recording Process

When a filter is active:

1. Camera stream is rendered to hidden `<video>` element
2. WebGL filter is applied to canvas in real-time animation loop
3. During recording, `canvas.captureStream()` is used to capture filtered output
4. Audio track from original camera stream is added to canvas stream
5. MediaRecorder records the combined stream

When no filter is selected:

- Original camera stream is recorded directly
- No additional processing overhead

### Performance

- **GPU Acceleration**: All filter operations run on GPU via WebGL
- **Frame Rate**: Maintains 30fps during recording
- **Memory**: Minimal overhead, uses single texture buffer
- **CPU Usage**: Low, only for frame synchronization

## Browser Compatibility

### Supported

- ✅ Chrome 56+
- ✅ Edge 79+
- ✅ Opera 43+
- ✅ Other Chromium-based browsers

### Requirements

- WebGL 1.0 support
- MediaRecorder API
- canvas.captureStream() support

### Fallback

If WebGL is not available:
- Filter button is still shown but filters won't apply
- Console warning is logged
- Recording continues with standard video stream

## Usage Examples

### Selecting a Filter

```typescript
// In component
selectFilter(filterId: string): void {
  this.selectedFilter.set(filterId);
  this.filterService.setFilter(filterId);
}
```

### Adding a New Filter

To add a new filter:

1. Add filter metadata to `availableFilters` array in `VideoFilterService`
2. Add filter ID to the `filterIds` array in `getFilterIndex()`
3. Implement shader logic in fragment shader's main function
4. Create helper function for the filter effect

Example:

```glsl
// In fragment shader
vec3 myNewFilter(vec3 color) {
  // Your filter logic here
  return modifiedColor;
}

// In main function
if (u_filter == 14) {
  result = myNewFilter(result);
}
```

## Styling

The filter UI uses Angular Material theming and CSS custom properties:

```scss
.filter-selection {
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  
  .filter-chip {
    background: rgba(255, 255, 255, 0.1);
    
    &.selected {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
  }
}
```

## Testing

Unit tests are provided in `video-filter.service.spec.ts`:

```bash
npm test -- --include='**/video-filter.service.spec.ts'
```

Tests verify:
- Service creation
- Filter availability (14 filters)
- Filter metadata integrity
- Filter index mapping

## Future Enhancements

Potential improvements:

1. **Custom Filter Parameters** - Adjustable intensity, blur radius, etc.
2. **Filter Presets** - Saved combinations of multiple effects
3. **Advanced Filters** - Face beautification, background blur, etc.
4. **Filter Animations** - Smooth transitions between filters
5. **WebGL 2.0** - Enhanced shader capabilities for more complex effects

## Performance Tips

1. **Disable filters during recording** if experiencing frame drops
2. **Use simpler filters** (grayscale, sepia) on lower-end devices
3. **Avoid filter switching** during active recording
4. **Monitor GPU usage** in browser DevTools

## Troubleshooting

### Filter not applying
- Check browser console for WebGL initialization errors
- Verify browser supports WebGL 1.0
- Check canvas element is properly created

### Poor performance
- Try simpler filters (avoid blur and edge detection)
- Reduce video resolution in camera constraints
- Close other GPU-intensive applications

### Recording issues with filters
- Ensure `canvas.captureStream()` is supported
- Verify MediaRecorder supports WebM or VP8/VP9 codecs
- Check audio tracks are properly added to canvas stream

## License

This implementation uses only browser-native APIs and contains no external dependencies, making it fully open-source and free to use within the Nostria project.
