# Two-Column Layout with Right Panel Service

## Overview

This document describes the implementation of a two-column layout system for the Nostria app, where:
- **Left Panel**: Displays list/root views (Feeds, Music, Articles, Activity, etc.) via Angular routing
- **Right Panel**: Displays detail views (Event threads, Article content, etc.) via a component-based service

## Architecture

### Key Components

1. **`RightPanelService`** ([right-panel.service.ts](../src/app/services/right-panel.service.ts))
   - Manages the right panel content independently from Angular routing
   - Maintains a navigation stack for back navigation within the panel
   - Provides methods: `open()`, `goBack()`, `close()`, `clearHistory()`

2. **`RightPanelContainerComponent`** ([right-panel-container.component.ts](../src/app/components/right-panel-container/right-panel-container.component.ts))
   - Dynamically renders components passed to `RightPanelService.open()`
   - Includes header with back/close buttons
   - Glass effect styling matching the app design

3. **`PanelNavigationService`** ([panel-navigation.service.ts](../src/app/services/panel-navigation.service.ts))
   - Manages the left panel (routed) navigation
   - Coordinates with `RightPanelService` to clear right panel when navigating to root components
   - Route type detection (list vs detail) for proper panel assignment

### Navigation Flow

```
User clicks item in list (e.g., Activity)
    │
    ├── List component calls RightPanelService.open()
    │       │
    │       └── Right panel renders detail component
    │           │
    │           └── URL updated for sharing/bookmarking
    │
    └── Left panel remains visible (not destroyed)
```

### History Clearing

When the user navigates to a **root list component** (e.g., clicks "Music" in navigation):
1. Left panel stack is cleared and set to the new route
2. Right panel content is cleared via callback
3. Route cache is cleared (for RouteReuseStrategy)

This ensures users start with a clean slate when switching contexts.

## Usage Example

To open a detail view in the right panel from a list component:

```typescript
import { RightPanelService } from '../../services/right-panel.service';
import { EventPageComponent } from '../event/event.component';

// In your component
private readonly rightPanel = inject(RightPanelService);

openEvent(eventId: string): void {
  this.rightPanel.open({
    component: EventPageComponent,
    inputs: { dialogEventId: eventId },
    title: 'Thread'
  }, `/e/${eventId}`);
}
```

## CSS Structure

The layout uses flexbox for the two-column arrangement:

```
┌──────────────────────────────────────────────────┐
│                    Toolbar                       │
├──────────────────────┬───────────────────────────┤
│                      │                           │
│    Left Panel        │     Right Panel           │
│    (700px)           │     (700px)               │
│                      │                           │
│    - Feeds           │    - Event details        │
│    - Music list      │    - Article content      │
│    - Activity        │    - Profile details      │
│                      │                           │
└──────────────────────┴───────────────────────────┘
```

### Responsive Behavior

- **Tablet (1024px-1440px)**: Both panels shrink to 600px
- **Mobile (<1024px)**: Right panel overlays left panel with full width

## Benefits of Component-Based Right Panel

1. **Preservation of Left Panel State**: The router-outlet in the left panel is never destroyed when opening details
2. **Clean URLs**: URLs can be updated for sharing without complex named outlet syntax
3. **Independent Navigation**: Right panel has its own back/forward navigation
4. **Flexible Rendering**: Any component can be rendered in the right panel without route configuration

## Files Modified

- `src/app/app.html` - Template with two-panel layout
- `src/app/app.scss` - Styles for dual-panel layout
- `src/app/app.ts` - Wired up services and imports
- `src/app/pages/summary/summary.component.ts` - Updated to use RightPanelService

## Files Created

- `src/app/services/right-panel.service.ts`
- `src/app/components/right-panel-container/right-panel-container.component.ts`
- `src/app/services/panel-route-reuse.strategy.ts` (for future RouteReuseStrategy enhancement)
