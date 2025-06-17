# Layout Service Scroll Signals

The `LayoutService` now provides reactive scroll signals that make it easy for components to respond to scroll events in the main content area.

## Available Signals

### `scrolledToTop: Signal<boolean>`
- Indicates whether the user has scrolled to the top of the content
- Useful for implementing pull-to-refresh functionality
- Updates with a 5px threshold for better UX

### `scrolledToBottom: Signal<boolean>`
- Indicates whether the user has scrolled to the bottom of the content
- Perfect for implementing infinite loading/pagination
- Updates with a 5px threshold for better UX

## Quick Setup

```typescript
import { inject, effect } from '@angular/core';
import { LayoutService } from '../services/layout.service';

export class MyComponent {
  private layout = inject(LayoutService);

  constructor() {
    // React to scroll events
    effect(() => {
      if (this.layout.scrolledToBottom()) {
        console.log('Load more data!');
      }
    });
  }
}
```

## Common Patterns

### 1. Infinite Loading
```typescript
export class FeedComponent {
  private layout = inject(LayoutService);
  private loading = signal(false);
  
  constructor() {
    effect(() => {
      if (this.layout.scrolledToBottom() && !this.loading()) {
        this.loadMorePosts();
      }
    });
  }
  
  private async loadMorePosts() {
    this.loading.set(true);
    // Load data...
    this.loading.set(false);
  }
}
```

### 2. Pull to Refresh
```typescript
export class RefreshableComponent {
  private layout = inject(LayoutService);
  
  constructor() {
    effect(() => {
      if (this.layout.scrolledToTop()) {
        this.refreshData();
      }
    });
  }
}
```

### 3. Conditional UI
```typescript
export class NavigationComponent {
  private layout = inject(LayoutService);
  
  showScrollToTop = computed(() => !this.layout.scrolledToTop());
  showLoadMore = computed(() => this.layout.scrolledToBottom());
}
```

## Technical Details

- **Container**: Monitors `.mat-drawer-content` or `.content-wrapper`
- **Responsiveness**: Immediate updates when transitioning away from top/bottom, 50ms throttle for other changes
- **Threshold**: 5px tolerance for "at top" and "at bottom"
- **Automatic**: Initializes automatically, retries if DOM not ready
- **Reset Behavior**: Signals properly reset to `false` when scrolling away from top/bottom positions

## Utility Methods

```typescript
// Manually check scroll position (after content changes)
this.layout.refreshScrollMonitoring();

// Re-initialize monitoring (after DOM structure changes)
this.layout.reinitializeScrollMonitoring();

// Debug current scroll state (development only)
this.layout.debugScrollState();
```

## Best Practices

1. **Always check loading states** to prevent duplicate requests
2. **Use computed()** for reactive UI updates
3. **Call refreshScrollMonitoring()** after adding/removing content
4. **Debounce expensive operations** triggered by scroll events
5. **Consider UX** - don't load too aggressively

The scroll signals integrate seamlessly with Angular's reactive system and make scroll-based interactions much easier to implement.
