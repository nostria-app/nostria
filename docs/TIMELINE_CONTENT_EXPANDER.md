# Timeline Content Expander Implementation

## Overview
Added "Show more" / "Show less" expander functionality to collapsed thread context in profile timeline views. This reduces scrolling by initially showing only ~4 lines of quoted or replied-to content, allowing users to focus on the current user's comment.

## Changes Made

### 1. TypeScript Component (`event.component.ts`)
Added two new signals to track expansion state:
```typescript
isRootEventExpanded = signal<boolean>(false);
isParentEventExpanded = signal<boolean>(false);
```

### 2. HTML Template (`event.component.html`)
Updated both root event (Original Post) and parent event (Replying to) sections in timeline mode:

- Added `[class.collapsed]="!isRootEventExpanded()"` to root event `mat-card-content`
- Added `[class.collapsed]="!isParentEventExpanded()"` to parent event `mat-card-content`
- Added "Show more" button with expand icon when content is collapsed
- Added "Show less" button with collapse icon when content is expanded
- Buttons toggle the respective expansion signals

### 3. SCSS Styling (`event.component.scss`)
Added collapsed state styling for both `.root-event` and `.parent-event`:

```scss
mat-card-content.collapsed {
  max-height: 6em; // ~4 lines at 1.5em line height
  overflow: hidden;
  position: relative;
  
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2em;
    background: linear-gradient(to bottom, transparent, var(--mat-sys-surface-container-low));
    pointer-events: none;
  }
}
```

Added button styling:
```scss
.show-more-btn,
.show-less-btn {
  width: 100%;
  margin-top: 8px;
  color: var(--mat-sys-primary);
  justify-content: center;
  
  mat-icon {
    margin-right: 4px;
  }
}
```

Added dark mode support:
```scss
:host-context(.dark) {
  .root-event,
  .parent-event {
    mat-card-content.collapsed::after {
      background: linear-gradient(to bottom, transparent, var(--mat-sys-surface-container-low)) !important;
    }
  }
}
```

## User Experience

### Default State (Collapsed)
- Thread context content limited to ~4 lines
- Smooth gradient fade at bottom indicating more content
- "Show more" button with down arrow icon visible

### Expanded State
- Full content visible
- "Show less" button with up arrow icon replaces "Show more"
- User can collapse back to save space

### Scope
- Only applies to timeline mode (`mode() === 'timeline'`)
- Affects both:
  - Root event (Original Post) in threaded replies
  - Parent event (Replying to)
- Does NOT affect thread mode or detail view

## Technical Details

### Content Types Supported
The collapsible feature works with all event types:
- Text notes (kind 1)
- Photos (kind 20)
- Videos (kind 21/22)
- Articles (kind 30023)
- M3U Playlists (kind 32100)
- Starter Packs (kind 39089)
- Profile events (kind 0)

### Accessibility
- Buttons use semantic HTML with proper icons
- Color contrast maintained in both light and dark modes
- Keyboard navigation supported through mat-button

### Performance
- Uses Angular signals for reactive state
- No external dependencies
- CSS-only animation via gradient fade
- Minimal DOM manipulation
