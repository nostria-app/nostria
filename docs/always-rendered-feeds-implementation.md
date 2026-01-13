# Always-Rendered Feeds Implementation

## Overview
Changed the dual-outlet layout to keep FeedsComponent always rendered in the DOM instead of loading/unloading it via router navigation. This prevents the component from being destroyed and recreated when opening/closing events, which was causing:
- Feed content to reload
- Scroll position to be lost
- Unnecessary re-rendering

## Architecture Changes

### Template Structure (app.html)
Changed from conditional rendering to always-rendered with CSS visibility control:

**Before:**
```html
@if(layout.useDualOutletLayout()) {
  <div class="dual-outlet-container">
    <router-outlet name="primary"></router-outlet>
    <div class="detail-outlet-wrapper">
      <!-- header and router-outlet -->
    </div>
  </div>
} @else {
  <router-outlet></router-outlet>
}
```

**After:**
```html
<div class="content-container" 
     [class.dual-layout]="layout.useDualOutletLayout()"
     [class.feeds-only]="!layout.useDualOutletLayout() && (router.url === '/' || router.url.startsWith('/f'))">
  <div class="feeds-wrapper">
    <app-feeds></app-feeds>
  </div>
  <div class="outlet-wrapper">
    <!-- detail header and router-outlet -->
  </div>
</div>
```

### CSS Layout (.content-container)
Three distinct modes controlled by CSS classes:

1. **Default (no class)**: Other routes (settings, messages, etc.)
   - Feeds hidden (`display: none`)
   - Router-outlet full width

2. **`.feeds-only`**: On `/` or `/f/*` routes
   - Feeds visible, full width
   - Router-outlet hidden (`display: none`)

3. **`.dual-layout`**: On `/e/:id` or `/p/:id` routes
   - Both feeds and router-outlet visible
   - Equal width side-by-side (max 1800px total)
   - Mobile: Outlet overlays feeds with `position: absolute`

### Component Updates

**app.ts:**
- Added `FeedsComponent` to imports array (not loaded via route anymore)
- Router events subscription detects route data flags
- Sets `useDualOutletLayout` signal based on `route.data['useDualOutlet']`

**app.routes.ts:**
- Event/profile routes have `useDualOutlet: true` in route data
- Feeds routes do NOT have this flag
- Router still handles all navigation

**feeds.component.ts:**
- Added check to skip URL syncing when `layoutService.useDualOutletLayout()` is true
- Prevents feeds from interfering with event/profile navigation

**layout.service.ts:**
- Kept all navigation methods (openProfile, openEvent, etc.)
- Navigation stack for back button functionality
- `useDualOutletLayout` signal controls layout mode

## Benefits

1. **No Feed Reloads**: FeedsComponent lifecycle preserved when opening/closing events
2. **Scroll Position Maintained**: Component state persists across navigation
3. **Better Performance**: No component destruction/recreation overhead
4. **Clean URLs**: Still using standard routes (`/e/xxx`, `/p/xxx`)
5. **Simpler Logic**: CSS-based visibility vs conditional rendering

## Testing Checklist

- [ ] Navigate to `/` - should show feeds only
- [ ] Click event - should open side-by-side, feeds stay in place
- [ ] Close event - should hide detail panel, feeds remain unchanged
- [ ] Click multiple events - feeds should never reload
- [ ] Check scroll position - should be preserved when opening/closing events
- [ ] Navigate to `/settings` - feeds should be hidden, settings full width
- [ ] Mobile view - detail should overlay feeds with close button
- [ ] Back button - should navigate through detail stack
- [ ] Direct URL `/e/nevent...` - should show dual layout immediately

## Files Modified

- [app.html](../src/app/app.html) - Template structure
- [app.scss](../src/app/app.scss) - CSS layout rules
- [app.ts](../src/app/app.ts) - Component imports and route detection
- [feeds.component.ts](../src/app/pages/feeds/feeds.component.ts) - URL syncing guard
