# Badge Hover Card Integration

## Overview
Integrated the badge hover card component with profile badges, allowing users to see detailed badge information when hovering over badges on the profile.

## Implementation

### 1. BadgeHoverCardService (`badge-hover-card.service.ts`)
Created a new service following the same pattern as `ProfileHoverCardService`:

- **Purpose**: Manage badge hover cards across the application with consistent behavior
- **Key Methods**:
  - `showHoverCard(element, pubkey, slug, delay)` - Shows hover card after delay (default 500ms)
  - `hideHoverCard()` - Hides the currently displayed hover card
  - `createHoverCard()` - Creates the overlay with proper positioning
  
- **Features**:
  - Uses Angular CDK Overlay for positioning
  - Tracks mouse state with signals (isMouseOverTrigger, isMouseOverCard)
  - Manages show/hide delays and timers
  - Closes on navigation
  - Supports hover persistence (card stays when hovering over card itself)
  - Multiple fallback positions for optimal display

### 2. Profile Header Component Updates

#### TypeScript (`profile-header.component.ts`)
- Injected `BadgeHoverCardService`
- Added `badgeHoverElement` to track current hover target
- Added hover handlers:
  - `onBadgeMouseEnter(event, badge)` - Stores element and shows hover card
  - `onBadgeMouseLeave()` - Clears element and hides hover card

#### HTML (`profile-header.component.html`)
- Updated badge loop to iterate over `topBadges()` instead of `parsedBadges()`
- Added mouseenter/mouseleave event handlers to badge links
- Used `@if` with alias for null-safe access to parsed badge data
- Preserved loading state for badges that haven't loaded yet

## Technical Details

### Hover Pattern
```typescript
// Component
onBadgeMouseEnter(event: Event, badge: { pubkey: string; slug: string }): void {
  const element = event.currentTarget as HTMLElement;
  this.badgeHoverElement = element;
  this.badgeHoverCardService.showHoverCard(element, badge.pubkey, badge.slug);
}

onBadgeMouseLeave(): void {
  this.badgeHoverElement = undefined;
  this.badgeHoverCardService.hideHoverCard();
}
```

```html
<!-- Template -->
<a 
  (mouseenter)="onBadgeMouseEnter($event, badge)"
  (mouseleave)="onBadgeMouseLeave()">
  <!-- Badge content -->
</a>
```

### Service Architecture
- **Overlay Management**: Uses CDK Overlay with flexible positioning
- **Mouse State Tracking**: Signals track hover state on trigger and card
- **Timing**: 500ms delay before showing, 200ms delay before hiding
- **Navigation Handling**: Automatically closes on route changes
- **Memory Management**: Proper cleanup in ngOnDestroy

## Benefits
- Consistent hover behavior across the application
- Improved user experience with detailed badge information
- Follows established pattern from ProfileHoverCardService
- Proper null safety and loading states
- Clean separation of concerns (service handles logic, component handles events)

## Related Files
- `/src/app/services/badge-hover-card.service.ts` - Service implementation
- `/src/app/pages/profile/profile-header/profile-header.component.ts` - Integration
- `/src/app/pages/profile/profile-header/profile-header.component.html` - Template
- `/src/app/components/badge/hover-card/badge-hover-card.component.ts` - Card component
