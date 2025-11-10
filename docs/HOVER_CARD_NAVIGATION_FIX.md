# Hover Card Navigation Fix

## Problem
Profile hover cards would sometimes get stuck on screen when navigating to a new page. This occurred when a hover card was open and the user navigated away before it closed.

## Root Cause
The application has multiple implementations of profile hover cards:

1. **ProfileHoverCardService** - Centralized service with proper navigation handling
2. **MentionHoverDirective** - Direct overlay implementation without navigation cleanup
3. **NoteContentComponent** - Direct overlay implementation without navigation cleanup

The `ProfileHoverCardService` properly subscribes to router navigation events to close hover cards when navigating. However, the `MentionHoverDirective` and `NoteContentComponent` create their own overlay instances directly without listening to router events, causing them to remain open during navigation.

## Solution
Added router event subscriptions to both `MentionHoverDirective` and `NoteContentComponent` to automatically close hover cards when navigation starts.

### Changes Made

#### 1. MentionHoverDirective
- Added `Router` injection and `NavigationStart` event subscription
- Added `routerSubscription` property to track the subscription
- Subscribe to router events in constructor to close hover card on navigation
- Unsubscribe from router events in `ngOnDestroy` lifecycle hook

#### 2. NoteContentComponent
- Added `OnDestroy` interface implementation
- Added `Router` injection and `NavigationStart` event subscription
- Added `routerSubscription` property to track the subscription
- Subscribe to router events in constructor to close hover card on navigation
- Added `ngOnDestroy` lifecycle hook to clean up both hover card and router subscription

### Technical Details

Both components now follow the same pattern as `ProfileHoverCardService`:

```typescript
// Subscribe to navigation events
this.routerSubscription = this.router.events
  .pipe(filter(event => event instanceof NavigationStart))
  .subscribe(() => {
    this.closeHoverCard();
  });
```

And properly clean up in `ngOnDestroy`:

```typescript
ngOnDestroy(): void {
  this.closeHoverCard();
  this.routerSubscription?.unsubscribe();
}
```

## Testing
To verify the fix:
1. Hover over a user mention or profile name to open a hover card
2. While the hover card is visible, navigate to a different page
3. The hover card should close automatically and not remain stuck on screen

## Files Modified
- `src/app/directives/mention-hover.directive.ts`
- `src/app/components/content/note-content/note-content.component.ts`
