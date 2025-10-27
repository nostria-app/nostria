# Event Mention Router Navigation Fix

## Problem
When users clicked on quoted event preview cards in threads (events that mention other events using `nostr:nevent`), the application would perform a full page reload instead of using Angular's router for internal navigation. This resulted in:
- Poor user experience with unnecessary page reloads
- Loss of application state
- Slower navigation
- Breaking the single-page application (SPA) behavior

## Example Scenario
In the thread example provided:
1. Parent event (id: `347af3ec...`) mentions child event (id: `b7be6099...`)
2. Child event mentions grandchild event (id: `d5d03b9b...`) with video content
3. Clicking on the quoted event cards caused full page reload

## Root Cause
The event mention cards in the content component had no click handler on the card itself. Only the date link had a click handler, but it used an `<a>` tag with `role="button"` instead of proper Angular router navigation on the entire clickable surface.

When users clicked on other parts of the card (content area, profile info, etc.), the browser's default link behavior was triggered, causing a full page reload.

## Solution

### Changes Made

#### 1. Updated `content.component.html`
- Removed the `<a>` tag from the date display
- Added click, enter, and space handlers to the entire `mat-card` element
- Made the entire card focusable with `tabindex="0"` and `role="button"`

```html
<mat-card appearance="outlined" class="event-mention-card" tabindex="0" role="button"
  (click)="onEventMentionClick($event, mention.event.event)"
  (keydown.enter)="onEventMentionClick($event, mention.event.event)"
  (keydown.space)="onEventMentionClick($event, mention.event.event)">
  <mat-card-header>
    <app-user-profile [pubkey]="mention.event.event.pubkey" view="compact">
      <span class="date-link" [matTooltip]="mention.event.event.created_at * 1000 | date: 'medium'"
        matTooltipPosition="below">
        {{ mention.event.event.created_at | ago }}
      </span>
    </app-user-profile>
  </mat-card-header>
  <mat-card-content>
    <div class="content-container">
      <app-note-content [contentTokens]="mention.contentTokens"></app-note-content>
    </div>
  </mat-card-content>
</mat-card>
```

#### 2. Updated `content.component.ts`
- Renamed Nostr `Event` import to `NostrEvent` to avoid conflict with DOM `Event` type
- Added `onEventMentionClick()` method that:
  - Prevents default browser behavior
  - Stops event propagation
  - Uses `layoutService.openEvent()` which properly navigates via Angular router
- Updated the `event` input signal to use `NostrEvent` type

```typescript
import { Event as NostrEvent } from 'nostr-tools';

// Input for the event (to access tags for mentions/articles)
event = input<NostrEvent | null>(null);

onEventMentionClick(event: Event, nostrEvent: NostrEvent) {
  // Prevent default link behavior and stop propagation
  event.preventDefault();
  event.stopPropagation();
  
  // Use the layout service to navigate, which properly uses Angular router
  this.layoutService.openEvent(nostrEvent.id, nostrEvent);
}
```

#### 3. Updated `content.component.scss`
Added visual feedback for clickable cards:
- Cursor pointer on hover
- Subtle elevation and transform on hover
- Focus outline for accessibility
- Active state feedback
- Dark mode support

```scss
.event-mention-card {
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  
  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateY(-2px);
  }
  
  &:active {
    transform: translateY(0);
  }
  
  &:focus {
    outline: 2px solid var(--mat-sys-primary, #6200ea);
    outline-offset: 2px;
  }
}
```

## Technical Details

### Navigation Flow
1. User clicks anywhere on the event mention card
2. `onEventMentionClick()` intercepts the event
3. `event.preventDefault()` prevents default browser navigation
4. `event.stopPropagation()` prevents event bubbling
5. `layoutService.openEvent()` uses Angular router to navigate
6. Router performs SPA navigation without page reload

### Type Safety
The fix properly handles the naming conflict between:
- DOM `Event` type (click, keyboard events)
- Nostr `Event` type (protocol event objects)

By importing Nostr Event as `NostrEvent`, the code maintains type safety for both event types.

### Accessibility
- Entire card is keyboard accessible with `tabindex="0"`
- Enter and Space keys trigger navigation
- Focus outline visible for keyboard navigation
- Semantic `role="button"` for screen readers

## Result
- Event mention cards now use Angular router for all internal navigation
- No more page reloads when clicking quoted events
- Better user experience with instant navigation
- Application state is preserved
- Proper SPA behavior maintained
- Full keyboard accessibility

## Related Files
- `src/app/components/content/content.component.html`
- `src/app/components/content/content.component.ts`
- `src/app/components/content/content.component.scss`
- `src/app/services/layout.service.ts` (existing router navigation)
