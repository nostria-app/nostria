# Virtual Scrolling for Notifications

**Date**: 2025-01-26  
**Component**: `notifications.component.ts/html/scss`  
**Feature**: Angular CDK Virtual Scrolling implementation for performance optimization

## Problem

The notifications page rendered all notifications at once using `@for` loops. With hundreds or thousands of notifications, this caused:
- Significant UI lag and stuttering
- High memory usage from excessive DOM elements
- Poor scrolling performance
- Slow initial render times

## Solution

Implemented Angular Material CDK Virtual Scrolling (`cdk-virtual-scroll-viewport`), which only renders items currently visible in the viewport plus a small buffer. This dramatically reduces DOM elements and improves performance.

## Implementation Details

### 1. Module Import

Added `ScrollingModule` from `@angular/cdk/scrolling`:

```typescript
import { ScrollingModule } from '@angular/cdk/scrolling';

@Component({
  selector: 'app-notifications',
  imports: [
    // ... other imports
    ScrollingModule,
  ],
  // ...
})
```

### 2. Template Changes

**Before** (standard @for loop):
```html
<div class="notification-list">
  @for (notification of contentNotifications(); track notification.id) {
    <div class="notification-item">...</div>
  }
</div>
```

**After** (virtual scrolling):
```html
<cdk-virtual-scroll-viewport [itemSize]="150" class="notification-viewport">
  <div
    *cdkVirtualFor="let notification of contentNotifications(); trackBy: trackByNotificationId"
    class="notification-item"
  >
    ...
  </div>
</cdk-virtual-scroll-viewport>
```

### 3. TrackBy Function

Added a `trackBy` function for optimal change detection performance:

```typescript
/**
 * TrackBy function for virtual scrolling performance
 * Returns unique notification ID for Angular change detection
 */
trackByNotificationId(_index: number, notification: Notification): string {
  return notification.id;
}
```

This helps Angular efficiently identify which items have changed when the notification list updates.

### 4. Styling

Added viewport styles in `notifications.component.scss`:

```scss
.notification-viewport {
  height: calc(100vh - 320px); // Account for header, tabs, and padding
  min-height: 400px;
  width: 100%;

  ::ng-deep .cdk-virtual-scroll-content-wrapper {
    width: 100%;
  }
}
```

The viewport has a fixed height calculated from viewport height minus headers/padding. The minimum height ensures usability on smaller screens.

## Configuration

### Item Size

Set to `150px` based on the average height of notification items. This value is critical for:
- Accurate scroll position calculation
- Smooth scrolling behavior
- Proper buffer rendering

If notification items have variable heights in the future, consider using `CdkVirtualForOf` with dynamic item sizing.

### Viewport Height

Calculated as `calc(100vh - 320px)` to account for:
- Page header (~80px)
- Tab navigation (~48px)
- Padding and margins (~192px)

Adjust if layout changes significantly.

## Performance Impact

**Before Virtual Scrolling** (1000 notifications):
- ~1000 DOM elements rendered
- Initial render: slow
- Scrolling: laggy
- Memory: high

**After Virtual Scrolling** (1000 notifications):
- ~20-30 DOM elements rendered (viewport + buffer)
- Initial render: fast
- Scrolling: smooth
- Memory: low

The exact number of rendered items depends on:
- Viewport height
- Item size (150px)
- Buffer size (automatic, managed by CDK)

## Applied to Both Tabs

Virtual scrolling is implemented in:
1. **Activity Tab**: Content notifications (reactions, replies, mentions, zaps, reposts)
2. **System Tab**: System notifications (relay publishing, technical messages)

Both tabs use the same configuration and trackBy function.

## Browser Compatibility

Virtual scrolling is supported in all modern browsers that support:
- CSS transforms
- Intersection Observer API
- Flexbox

This covers all browsers supported by Angular 18+.

## Future Enhancements

1. **Dynamic Item Sizing**: If notification items have significantly variable heights, implement `CdkVirtualScrollViewport.checkViewportSize()` or use absolute positioning strategy
2. **Scroll Position Persistence**: Save/restore scroll position when navigating away and back
3. **Infinite Loading**: Add pagination/lazy loading when scrolling near the bottom
4. **Performance Metrics**: Add performance monitoring to track actual improvements

## Related Files

- `src/app/pages/notifications/notifications.component.ts` - Component logic and trackBy function
- `src/app/pages/notifications/notifications.component.html` - Virtual scroll viewport template
- `src/app/pages/notifications/notifications.component.scss` - Viewport styling

## Testing Recommendations

1. Test with varying notification counts (0, 10, 100, 1000+)
2. Verify smooth scrolling behavior
3. Check that all notification actions work correctly (mark as read, remove, navigate)
4. Test on different screen sizes (mobile, tablet, desktop)
5. Verify keyboard navigation still works
6. Check accessibility with screen readers

## References

- [Angular CDK Virtual Scrolling Documentation](https://material.angular.io/cdk/scrolling/overview)
- [CdkVirtualForOf API](https://material.angular.io/cdk/scrolling/api#CdkVirtualForOf)
- [Performance Optimization with Virtual Scrolling](https://blog.angular.io/angular-cdk-virtual-scrolling-420d90c2f1f0)
