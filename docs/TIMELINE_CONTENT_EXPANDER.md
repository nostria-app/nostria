# Timeline Content Expander Implementation

## Overview
Added "Show more" / "Show less" expander functionality to collapsed thread context in profile timeline views. This reduces scrolling by initially showing only ~4 lines of quoted or replied-to content, allowing users to focus on the current user's comment. **The expander only appears when content actually overflows** - short posts display fully without truncation.

## Changes Made

### 1. TypeScript Component (`event.component.ts`)
Added signals to track expansion state and overflow detection:
```typescript
isRootEventExpanded = signal<boolean>(false);
isParentEventExpanded = signal<boolean>(false);
rootContentNeedsTruncation = signal<boolean>(false);
parentContentNeedsTruncation = signal<boolean>(false);
```

Added ViewChild references to measure content:
```typescript
@ViewChild('rootContent') rootContentRef?: ElementRef<HTMLElement>;
@ViewChild('parentContent') parentContentRef?: ElementRef<HTMLElement>;
```

Implemented `AfterViewChecked` to detect when content overflows:
```typescript
ngAfterViewChecked(): void {
  // Check if root content needs truncation
  if (this.rootContentRef?.nativeElement) {
    const element = this.rootContentRef.nativeElement;
    const needsTruncation = element.scrollHeight > element.clientHeight + 1;
    if (this.rootContentNeedsTruncation() !== needsTruncation) {
      this.rootContentNeedsTruncation.set(needsTruncation);
    }
  }
  // Similar check for parent content...
}
```

### 2. HTML Template (`event.component.html`)
Updated both root event (Original Post) and parent event (Replying to) sections in timeline mode:

- Added template references `#rootContent` and `#parentContent` to mat-card-content elements
- Added `[class.collapsed]="!isRootEventExpanded()"` to root event `mat-card-content`
- Added `[class.collapsed]="!isParentEventExpanded()"` to parent event `mat-card-content`
- Added "Show more" button with expand icon **only when content needs truncation**: `@if (!isRootEventExpanded() && rootContentNeedsTruncation())`
- Added "Show less" button with collapse icon **only when expanded**: `@else if (isRootEventExpanded())`
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
- **Short content**: Posts shorter than 4 lines display fully with no button
- **Long content**: Thread context content limited to ~4 lines
- Smooth gradient fade at bottom indicating more content
- "Show more" button with down arrow icon visible

### Expanded State
- Full content visible
- "Show less" button with up arrow icon replaces "Show more"
- User can collapse back to save space

### Intelligent Truncation
The component automatically detects if content overflows the 4-line limit using `scrollHeight` vs `clientHeight` comparison:
- Content fits within 4 lines → No button shown, full content visible
- Content exceeds 4 lines → Button shown, content truncated with gradient fade

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
- Efficient overflow detection: only updates signals when state actually changes
- `ngAfterViewChecked` compares previous state before updating to avoid unnecessary signal changes
