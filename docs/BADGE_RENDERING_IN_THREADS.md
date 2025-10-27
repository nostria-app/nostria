# Badge Rendering in Event Threads

## Problem
When a user shared an event that referenced a badge award (kind 8) using `nostr:nevent`, the badge was not rendered in the thread until the user clicked to open that specific event. Badge awards would appear as plain text or empty cards instead of displaying the badge component.

## Example
In the provided event example, a note with id `2f9947c7f2b705c5e48b68632d524fea093fb7c98cd6b2c230da6a4db8e92174` referenced a badge award event (id `208e322b04dd97a82f364e97901c9db57e56fa7a95ff0aed8437fa3badaa0b44`, kind 8) via a `q` tag and `nostr:nevent` reference in the content.

## Root Cause
The content component (`content.component.ts`) fetches and displays quoted events (nevent/note mentions) in a generic card format. It did not have special handling for badge awards (kind 8 events), which require the `BadgeComponent` to render properly.

## Solution
Added conditional rendering logic to detect when a quoted event is a badge award and render it using the `BadgeComponent` instead of the generic event card.

### Changes Made

#### 1. Updated `content.component.html`
Added a conditional check in the `eventMentions` loop to detect badge awards (kind 8) and render them using `<app-badge>`:

```html
@for (mention of eventMentions(); track mention.event.event.id) {
  @if (mention.event.event.kind === 8) {
  <!-- Badge Award (kind 8) -->
  <app-badge [badge]="mention.event.event"></app-badge>
  } @else {
  <!-- Regular event mention (existing card format) -->
  <mat-card appearance="outlined">
    ...
  </mat-card>
  }
}
```

#### 2. Updated `content.component.ts`
Added the `BadgeComponent` import to the component's imports array:

```typescript
import { BadgeComponent } from '../../pages/badges/badge/badge.component';

@Component({
  imports: [
    ...
    BadgeComponent,
  ],
  ...
})
```

## Technical Details

### Event Processing Flow
1. User posts note with `nostr:nevent1...` reference to badge award
2. Parsing service (`parsing.service.ts`) detects the nostr reference and extracts the event ID
3. Content component fetches the referenced event via `data.getEventById()`
4. Event is added to `eventMentions` signal with full event data
5. Template checks `mention.event.event.kind === 8` to determine if it's a badge
6. Badge awards render using `BadgeComponent`, other events use standard card layout

### Nostr Protocol Context
- **Kind 8**: Badge Award event (NIP-58)
- **nostr:nevent**: Nostr Event Reference format for sharing events
- **q tag**: Quote tag indicating which event is being referenced

## Result
Badge awards are now properly rendered in threads when quoted or referenced in other events, displaying the full badge UI with visual styling, recipient information, and award details without requiring the user to click through to the event details page.
