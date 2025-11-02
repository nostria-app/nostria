# Event Navigation Alternatives - Keeping Feeds Component Alive

## Problem Statement

Currently, when a user clicks on an event in the feeds view to see its thread, the Angular router navigates to `/e/:id`, which completely destroys the `FeedsComponent` and creates the `EventPageComponent`. When the user navigates back, the feeds component is recreated from scratch, causing:

- Loss of scroll position
- Re-fetching of data
- Re-initialization of all component state
- Poor user experience with loading states

## Current Architecture

```typescript
// Current route structure
{
  path: '',
  component: FeedsComponent,  // Gets destroyed on navigation
}
{
  path: 'e/:id',
  component: EventPageComponent,  // New route replaces FeedsComponent
}
```

## Solution Options

### Option 1: Modal/Dialog Overlay (Recommended)

**Implementation:** Open events in a full-screen or large dialog/drawer above the feeds component.

**Advantages:**
- ✅ Feeds component stays alive and maintains all state
- ✅ Scroll position preserved
- ✅ Data and subscriptions remain active
- ✅ Fast back navigation (just close dialog)
- ✅ Maintains browser history with query params
- ✅ Can support swipe gestures to close
- ✅ Works well on mobile and desktop

**Disadvantages:**
- ❌ Different UX pattern (not a traditional route)
- ❌ Need to handle deep linking differently
- ❌ Browser back button needs special handling

**Implementation Approach:**

```typescript
// In layout.service.ts
openEvent(eventId: string, event: Event): void {
  // Update URL without navigation
  this.location.go(`/e/${neventId}`);
  
  // Open dialog
  const dialogRef = this.dialog.open(EventDialogComponent, {
    data: { eventId, event },
    width: '100%',
    maxWidth: '800px',
    height: '100vh',
    maxHeight: '100vh',
    panelClass: 'event-dialog',
    hasBackdrop: true,
    autoFocus: false,
  });
  
  // Update URL back when closed
  dialogRef.afterClosed().subscribe(() => {
    this.location.back();
  });
}
```

**Browser History Handling:**

```typescript
// In app.component.ts or a route guard
constructor() {
  // Listen to popstate (back button)
  this.location.subscribe((event) => {
    if (event.url?.includes('/e/')) {
      // Reopen dialog from URL
      const eventId = this.extractEventId(event.url);
      this.openEventDialog(eventId);
    }
  });
}
```

---

### Option 2: Child Routes with Named Outlets

**Implementation:** Use Angular's auxiliary routes to display events in a named outlet while keeping the feeds visible.

**Advantages:**
- ✅ Uses native Angular routing
- ✅ Can show feeds and event side-by-side
- ✅ Good for desktop/tablet layouts
- ✅ Proper browser history handling

**Disadvantages:**
- ❌ More complex route configuration
- ❌ URL structure becomes more complex: `/(feeds//event:e/abc123)`
- ❌ May not work well on mobile
- ❌ Feeds component still partially re-rendered

**Implementation Approach:**

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: '',
    component: FeedsComponent,
    children: [
      {
        path: 'e/:id',
        component: EventPageComponent,
        outlet: 'event'
      }
    ]
  }
];

// feeds.component.html
<div class="feeds-container">
  <!-- Feeds content -->
</div>
<router-outlet name="event"></router-outlet>

// Open event
this.router.navigate(['/', { outlets: { event: ['e', eventId] } }]);
```

---

### Option 3: Angular's RouteReuseStrategy (Not Recommended for This Case)

**Implementation:** Cache component instances using a custom `RouteReuseStrategy`.

**Advantages:**
- ✅ Standard Angular solution for component reuse
- ✅ Maintains component state across routes

**Disadvantages:**
- ❌ Complex to implement correctly
- ❌ Hard to control which components to cache
- ❌ Memory leaks if not managed properly
- ❌ Still recreates component on first navigation
- ❌ Doesn't solve the immediate user experience issue

---

### Option 4: Dynamic Component Loading with URL Management

**Implementation:** Manually load event component dynamically within feeds while managing URL state.

**Advantages:**
- ✅ Full control over component lifecycle
- ✅ Can create any desired UX
- ✅ Feeds never destroyed

**Disadvantages:**
- ❌ Manual component creation/destruction
- ❌ Manual URL management
- ❌ Doesn't use Angular router benefits
- ❌ More code to maintain

---

### Option 5: Bottom Sheet (Mobile-Optimized)

**Implementation:** Use Angular Material Bottom Sheet for mobile, dialog for desktop.

**Advantages:**
- ✅ Native mobile feel
- ✅ Swipe-to-close gesture
- ✅ Feeds component stays alive
- ✅ Fast and smooth transitions

**Disadvantages:**
- ❌ Requires different UX for mobile vs desktop
- ❌ Same URL management challenges as modal

**Implementation Approach:**

```typescript
openEvent(eventId: string, event: Event): void {
  const isMobile = this.layout.isMobile();
  
  if (isMobile) {
    this.bottomSheet.open(EventBottomSheetComponent, {
      data: { eventId, event },
      panelClass: 'event-bottom-sheet',
    });
  } else {
    // Use dialog or other approach
  }
}
```

---

## Recommended Implementation: Hybrid Approach

Combine **Option 1 (Modal/Dialog)** with proper URL management for the best user experience:

### Phase 1: Dialog Implementation

1. Create a new `EventDialogComponent` that wraps the existing event page logic
2. Modify `LayoutService.openEvent()` to open dialog instead of navigating
3. Update URL using `Location.go()` without actual navigation
4. Handle browser back button to close dialog

### Phase 2: Deep Link Support

1. Add route guard or app component logic to detect `/e/:id` URLs
2. If feeds component is active, open dialog
3. If coming from external link, route normally

### Phase 3: Mobile Enhancement (Optional)

1. Use bottom sheet on mobile for better UX
2. Support swipe gestures

### Implementation Checklist

- [ ] Create `EventDialogComponent` (reuse event page template)
- [ ] Update `LayoutService.openEvent()` method
- [ ] Handle URL updates with `Location` service
- [ ] Implement popstate listener for back button
- [ ] Test deep linking scenarios
- [ ] Add dialog animations
- [ ] Test on mobile and desktop
- [ ] Update all event opening call sites

### Code Structure

```
src/app/
  components/
    event-dialog/
      event-dialog.component.ts
      event-dialog.component.html
      event-dialog.component.scss
  services/
    layout.service.ts (modified)
  app.ts (modified - add popstate listener)
```

## Alternative: Keep Current Routing, Improve Performance

If the modal approach is not desired, optimize the current routing:

1. **Implement route data caching**: Store feed state in a service
2. **Use route resolvers**: Pre-load event data before navigation
3. **Restore scroll position**: Save and restore on navigation
4. **Lazy load feeds content**: Load feed items on-demand

This keeps the current UX but makes it faster and more reliable.

## Comparison Table

| Approach | State Preservation | UX Quality | Implementation Complexity | Browser History | Mobile Support |
|----------|-------------------|------------|--------------------------|----------------|----------------|
| Modal/Dialog | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Named Outlets | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| RouteReuseStrategy | ⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Dynamic Loading | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐⭐ | ⭐⭐⭐ |
| Bottom Sheet | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

## Conclusion

**Recommended:** Implement the Modal/Dialog approach (Option 1) as it provides the best balance of:
- Complete state preservation
- Good user experience
- Reasonable implementation complexity
- Excellent mobile support

The hybrid approach with bottom sheet on mobile and dialog on desktop would provide the most polished experience.

## Next Steps

1. Review this document with the team
2. Choose the preferred approach
3. Create implementation tasks
4. Build proof of concept
5. Test with real users
6. Roll out gradually with feature flag
