# Two-Column Feeds View Implementation

## Overview

This document describes the implementation of the two-column feeds view, which replaces the previous single-page feeds route with a dynamic two-column layout that preserves feed state while allowing users to navigate to profiles and events.

## Architecture

### Navigation Stack Service

**File**: `src/app/services/navigation-stack.service.ts`

A service that manages a stack of navigation items (profiles and events). Key features:

- **Stack Management**: Push/pop operations for navigation items
- **Type Safety**: Each item has a type ('event' | 'profile') and associated data
- **Computed Signals**: 
  - `hasItems()` - Whether stack has any items
  - `hasMultipleItems()` - Whether to show back button
  - `currentItem()` - The item currently displayed

```typescript
// Example usage
navigationStack.navigateToProfile(pubkey);
navigationStack.navigateToEvent(eventId, eventData);
navigationStack.pop(); // Go back
navigationStack.clear(); // Close all
```

### Home Component

**Files**: 
- `src/app/pages/home/home.component.ts`
- `src/app/pages/home/home.component.html`  
- `src/app/pages/home/home.component.scss`

The main container that manages the two-column layout:

#### Desktop Layout (≥1024px)
```
┌─────────────────────────────────────────┐
│  [Feeds - 700px]  │  [Content - Flex]  │
│                   │                     │
│   • Feed items    │  • Profile/Event   │
│   • Centered when │  • With header     │
│     no content    │    - Back/Close    │
└─────────────────────────────────────────┘
```

#### Mobile Layout (<1024px)
```
Show Feed OR Content (not both):
- No stack items → Show feed
- Has stack items → Show content
```

### Modified Components

#### ProfileComponent
- Added `twoColumnPubkey` input for direct pubkey injection
- Falls back to route params for standalone navigation
- Works in both contexts seamlessly

#### EventPageComponent
- Already had `dialogEventId` and `dialogEvent` inputs
- Used as-is in two-column context

#### LayoutService
- Updated `openProfile()` to use navigation stack on home page
- Updated `openGenericEvent()` to use navigation stack on home page
- Preserves dialog behavior for other pages

#### FeedsComponent
- Removed URL synchronization logic
- Removed route params subscription
- Now a pure UI component
- Keeps query params for relay feeds

## Routing Changes

### Before
```typescript
{
  path: '',
  component: FeedsComponent
}
{
  path: 'f/:path',
  component: FeedsComponent
}
```

### After
```typescript
{
  path: '',
  component: HomeComponent // Contains FeedsComponent
}
{
  path: 'f',
  redirectTo: '' // Legacy redirect
}
{
  path: 'f/:path',
  redirectTo: '' // Legacy redirect
}
```

## CSS Implementation

### Two-Column Layout
```scss
.columns-wrapper {
  display: flex;
  
  // Desktop: side-by-side
  &:not(.mobile) {
    gap: 0;
    
    // Center feed when no content
    &:not(.has-content) {
      justify-content: center;
    }
  }
  
  // Mobile: one at a time
  &.mobile {
    .hidden-mobile {
      display: none !important;
    }
  }
}
```

### Column Sizing
- **Feed Column**: Fixed 700px width on desktop, 100% on mobile
- **Content Column**: Flex 1 (fills remaining space)
- **Centered Feed**: Max-width 700px when no content selected

## User Interaction Flow

### Opening Content
1. User clicks profile/event in feed
2. `LayoutService.openProfile()` or `LayoutService.openGenericEvent()` called
3. Item pushed to navigation stack
4. Right column renders with header and content
5. Feed remains mounted and visible (desktop) or hidden (mobile)

### Navigation
- **Single Item**: Header shows X button → calls `navigationStack.clear()`
- **Multiple Items**: Header shows back button → calls `navigationStack.pop()`
- **Mobile**: Automatically switches between feed and content views

### Closing Content
1. User clicks X or navigates back to empty stack
2. Stack is cleared
3. Right column disappears
4. Feed centers on desktop, shows on mobile

## Benefits

### Performance
- **No Re-initialization**: Feeds component stays mounted
- **Preserved Scroll**: Feed scroll position maintained
- **Efficient Updates**: Only content column re-renders

### User Experience
- **Smooth Navigation**: No page reloads
- **Context Preservation**: Users can easily return to feed
- **Mobile Optimized**: Native app-like experience

### Code Quality
- **Separation of Concerns**: Navigation logic separated from UI
- **Reusable**: Navigation stack can be used elsewhere
- **Type Safe**: Full TypeScript support

## Future Enhancements

### Possible Improvements
1. **Deep Linking**: URL updates to reflect current navigation state
2. **Animations**: Smooth transitions between views
3. **Breadcrumbs**: Show navigation path in header
4. **Keyboard Navigation**: Alt+Left/Right for back/forward
5. **Swipe Gestures**: Mobile swipe to go back

### Feed Options Context Menu
The toolbar options in the feed header should be moved to a context menu:
- Show/Hide Replies
- Show/Hide Reposts
- Refresh Feed
- Edit Feed
- Delete Feed
- Reset Feeds

This is a minor UI refinement that can be done separately.

## Testing Checklist

- [ ] Navigate to profile from feed
- [ ] Navigate to event from feed
- [ ] Navigate to multiple items sequentially
- [ ] Use back button to return
- [ ] Use X button to close
- [ ] Test on desktop (>1024px)
- [ ] Test on mobile (<1024px)
- [ ] Verify feed state preservation
- [ ] Test relay feeds still work
- [ ] Test feed switching
- [ ] Verify no memory leaks

## Technical Notes

### Why Not Use Router?
The router could handle this, but using a navigation stack service provides:
- Better performance (no route re-resolution)
- More control over transitions
- Simpler state management
- Preserved feed context

### Why Keep Feed Mounted?
Keeping the feeds component mounted avoids:
- Re-fetching data
- Losing scroll position
- Destroying subscriptions
- Re-initializing state

This creates a better user experience, especially for users browsing many profiles/events.

## Migration Notes

### Breaking Changes
- `/f` and `/f/:path` routes now redirect to `/`
- Feed navigation is no longer URL-driven
- Cannot deep-link to specific feed via path parameter

### Backward Compatibility
- Existing `/f` URLs redirect to home
- Relay feeds query param (`?r=domain`) still works
- All other pages unchanged

## Conclusion

The two-column feeds implementation successfully transforms Feeds from a route to a persistent component while adding powerful navigation capabilities. The implementation is clean, performant, and provides an excellent user experience on both desktop and mobile devices.
