# Video Filter UI Layout

## Video Recording Dialog with Filters

```
┌─────────────────────────────────────────────────────────┐
│  Record Video                                     [X]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌───────────────────────────────────────────────┐     │
│  │                                         [🔄] [◈]│     │
│  │                                                 │     │
│  │                                                 │     │
│  │           CAMERA/FILTER PREVIEW                 │     │
│  │            (Video/Canvas Element)               │     │
│  │                                                 │     │
│  │                                                 │     │
│  │                                                 │     │
│  │  ┌─────────────────────────────────────────┐   │     │
│  │  │ ┌──┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐│   │     │
│  │  │ │◯ │ │▓▓▓ │ │🎨  │ │🌅  │ │✨  │ │🔲  ││   │     │
│  │  │ │No│ │B&W │ │Sepia│Edge │Blur │Pixel││   │     │
│  │  │ └──┘ └────┘ └────┘ └────┘ └────┘ └────┘│   │     │
│  │  │ < scroll for more filters >             │   │     │
│  │  └─────────────────────────────────────────┘   │     │
│  └───────────────────────────────────────────────┘     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [📱] [📺]  [Short Form 6.3s] [Upload Original]        │
│                                                         │
│                         [Cancel] [▶ Start Recording]   │
└─────────────────────────────────────────────────────────┘
```

## UI Elements

### Top Right Buttons
- **[🔄]** - Camera Flip Button (switches front/back camera)
- **[◈]** - Filters Button (toggles filter selection panel)
  - Active state: highlighted in primary color
  - Inactive state: semi-transparent overlay

### Filter Selection Panel
When filter button is clicked, a horizontal scrolling panel appears at the bottom of the video preview:

```
┌──────────────────────────────────────────────────────────┐
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ │
│ │ ✓  │ │B&W │ │Sepia│ │Edge│ │Blur│ │Sharp│ │Warm│ │Cool│ │
│ │None│ │Gray│ │Tone│ │Detct│ │Soft│ │Enh │ │Temp│ │Temp│ │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ │
│          < swipe left/right for more filters >           │
└──────────────────────────────────────────────────────────┘
```

Each filter chip shows:
- Icon (Material Design icon)
- Name (short label)
- Tooltip on hover (full description)
- Selected state (highlighted background)

### Filter Chips Layout

```
Individual Filter Chip:
┌──────────┐
│   Icon   │  ← Material icon (24px)
│   ----   │
│   Name   │  ← Filter name (11px)
└──────────┘
  80px min width
  
Selected State:
┌──────────┐
│▓▓Icon▓▓▓ │  ← Primary color background
│▓▓----▓▓▓ │
│▓▓Name▓▓▓ │
└──────────┘
```

## Color Scheme

### Light Theme (not fully tested)
- Filter panel background: rgba(0, 0, 0, 0.8)
- Filter chip default: rgba(255, 255, 255, 0.1)
- Filter chip hover: rgba(255, 255, 255, 0.2)
- Filter chip selected: var(--mat-sys-primary)
- Text color: white

### Dark Theme
- Filter panel background: rgba(0, 0, 0, 0.8) with blur(10px)
- Filter chip default: rgba(255, 255, 255, 0.1)
- Filter chip hover: rgba(255, 255, 255, 0.2)
- Filter chip selected: var(--mat-sys-primary)
- Text color: white

## Interaction Flow

### Opening Filters
1. User clicks filter button [◈]
2. Button highlights (active state)
3. Filter panel slides up from bottom
4. Default filter "None" is selected

### Selecting Filter
1. User clicks a filter chip
2. Chip highlights immediately
3. Filter applies in real-time to preview
4. Previous selection un-highlights

### Scrolling Filters
- Touch: Swipe left/right
- Mouse: Scroll wheel over panel
- Keyboard: Arrow keys when focused
- Thin scrollbar appears at bottom

### Recording with Filter
1. Filter is already selected and previewing
2. User clicks "Start Recording"
3. Recording uses filtered canvas stream
4. Filter panel hides during recording
5. Recording indicator shows at top-left

### Closing Filters
1. User clicks filter button [◈] again
2. Filter panel slides down
3. Button returns to inactive state
4. Selected filter remains active in preview

## Responsive Behavior

### Portrait Mode (Vertical)
- Filter panel: full width
- Chips: scroll horizontally
- Video preview: 9:16 aspect ratio

### Landscape Mode (Horizontal)
- Filter panel: full width
- Chips: more visible at once
- Video preview: 16:9 aspect ratio

## Accessibility

- All buttons have tooltips
- Filter chips have descriptive tooltips
- Keyboard navigation supported
- High contrast selected states
- Material icons with semantic meaning

## Technical Details

### CSS Classes

```css
.filters-button - Filter toggle button
  .active - When filter panel is open

.filter-selection - Main filter panel container
  .filter-chips - Horizontal scroll container
    .filter-chip - Individual filter button
      .selected - Active filter state
```

### Key Dimensions

- Filter panel height: auto (based on chip height)
- Filter chip min-width: 80px
- Filter chip padding: 8px 12px
- Filter chip gap: 8px
- Icon size: 24px
- Font size: 11px
- Border radius: 8px

## Animation

All transitions use Material Design easing:

- Filter panel slide: 200ms ease
- Chip highlight: 200ms ease
- Button state: 200ms ease
- Hover effects: 200ms ease

## States

### Filter Button States
1. **Inactive**: Semi-transparent overlay, white icon
2. **Hover**: Darker overlay
3. **Active**: Primary color background, on-primary color icon

### Filter Chip States
1. **Default**: Semi-transparent white background
2. **Hover**: More opaque white background
3. **Selected**: Primary color background with border
4. **Disabled**: Grayed out (not currently used)

## Example Filter Icons

- None: filter_none
- Grayscale: filter_b_and_w
- Sepia: filter_vintage
- Invert: invert_colors
- Edge: auto_fix_high
- Cartoon: brush
- Blur: blur_on
- Sharpen: tune
- Brightness: brightness_high
- Contrast: contrast
- Vignette: vignette
- Warmth: wb_sunny
- Cool: ac_unit
- Pixelate: grid_on
