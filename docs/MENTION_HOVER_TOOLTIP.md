# Mention Hover Tooltip Implementation

## Overview

Implemented hover tooltips for @mentions throughout the application, showing the same profile hover card that appears on user profile components. This provides a consistent user experience when interacting with user profiles anywhere in the app.

## Implementation Approaches

Due to how mentions are rendered in different parts of the application, two complementary approaches were implemented:

### 1. Template-Based Approach (Note Content Component)

For mentions rendered through Angular templates (regular notes/posts), hover events are bound directly in the template.

### 2. Directive-Based Approach (Article Content)

For mentions rendered through `[innerHTML]` (articles, markdown content), a custom directive uses event delegation to handle dynamically created mention links.

## Changes Made

### 1. Template-Based: NoteContentComponent Updates

**File: `src/app/components/content/note-content/note-content.component.ts`**

Added CDK Overlay integration similar to the user-profile component:

- **New Imports:**
  - `Overlay`, `OverlayRef` from `@angular/cdk/overlay`
  - `ComponentPortal` from `@angular/cdk/portal`
  - `ProfileHoverCardComponent` for reusable hover card
  - `ViewContainerRef` for portal attachment

- **New State Signals:**
  - `isMouseOverTrigger`: Tracks if mouse is over the mention link
  - `isMouseOverCard`: Tracks if mouse is over the hover card itself

- **New Private Properties:**
  - `overlayRef`: CDK overlay reference
  - `hoverCardComponentRef`: Instance of the hover card component
  - `hoverTimeout`: Delay before showing card (500ms)
  - `closeTimeout`: Delay before closing card (300ms)

- **New Methods:**
  - `onMentionMouseEnter()`: Handles mouse enter on mention links
  - `onMentionMouseLeave()`: Handles mouse leave from mention links
  - `showMentionHoverCard()`: Creates and positions the hover card overlay
  - `scheduleClose()`: Recursively schedules card closing, checking menu state
  - `closeHoverCard()`: Cleanup and disposal of overlay

**File: `src/app/components/content/note-content/note-content.component.html`**

Updated mention link template to add hover events:

```html
<a
  class="nostr-mention"
  (click)="onNostrMentionClick(token)"
  (mouseenter)="onMentionMouseEnter($event, token)"
  (mouseleave)="onMentionMouseLeave()"
>@{{ token.nostrData?.displayName }}</a>
```

### 2. Directive-Based: MentionHoverDirective

**File: `src/app/directives/mention-hover.directive.ts`**

Created a new standalone directive that uses event delegation to handle mentions rendered via `[innerHTML]`:

- **Event Delegation:** Listens for mouseenter/mouseleave at the container level
- **Mention Detection:** Traverses DOM to find elements with `.nostr-mention` class
- **Data Attributes:** Reads `data-pubkey` and `data-type` from mention links
- **Same Overlay Logic:** Uses identical positioning and state management as template approach

**Applied to:**
- `article.component.html` - Full article pages
- `article-event.component.html` - Article preview cards

**Usage:**
```html
<div class="markdown-content" [innerHTML]="parsedContent()" appMentionHover></div>
```

The directive automatically handles all `.nostr-mention` links within the container, regardless of when they're created.

### 3. Repost Footer Alignment Fix

**File: `src/app/components/event/event.component.scss`**

Fixed the "Published with" icon alignment in repost footers:

**Before:**
```scss
.note-footer-right {
  margin-left: auto;
}
```

**After:**
```scss
.note-footer-right {
  &:first-of-type {
    margin-left: auto;
  }
}
```

**Rationale:** When multiple elements have the `.note-footer-right` class (POW indicator, client tag, bookmark button), only the first one should push left with `margin-left: auto`. This ensures proper right-alignment without centering subsequent elements.

## Technical Details

### Hover Card Positioning

The hover card uses CDK Overlay's flexible positioning with 4 fallback strategies:

1. **Primary:** Below the mention, centered
2. **Fallback 1:** Above the mention, centered
3. **Fallback 2:** Right of the mention, vertically centered
4. **Fallback 3:** Left of the mention, vertically centered

Configuration:
- **Viewport Margin:** 16px to prevent edge clipping
- **Push:** Enabled to automatically adjust position when near viewport edges
- **Scroll Strategy:** Close on scroll to prevent detached cards

### State Management

The implementation uses Angular signals for reactive state tracking:

- **500ms delay** before showing hover card (prevents accidental triggers)
- **300ms delay** before closing (allows smooth transitions between trigger and card)
- **Recursive scheduling** checks if context menu is open before closing
- **Dual state tracking** ensures card stays open when hovering either trigger or card

### Menu Integration

The hover card includes a context menu (report/block). The close logic checks `isMenuOpen()` signal and reschedules closing if the menu is active, preventing premature dismissal.

## User Experience

**Mention Hover Behavior:**
1. User hovers over @mention in note content
2. After 500ms, profile hover card appears
3. Card shows: banner, avatar, name, npub, about, mutual following, follow button, context menu
4. User can hover between mention and card without closing
5. Card closes 300ms after mouse leaves both areas (unless menu is open)

**Footer Alignment:**
- POW indicator (if present) is right-aligned
- Client tag ("Published with") sits adjacent to POW or right-aligned if POW absent
- Bookmark button sits adjacent to client tag

## Reusability

This implementation demonstrates the reusability of the `ProfileHoverCardComponent`:

- **User Profile Component:** Shows on profile name/npub hover (template-based)
- **Note Content Component:** Shows on @mention hover (template-based)
- **Article Components:** Shows on @mention hover (directive-based with event delegation)
- All use identical positioning and state management patterns
- Shared component ensures consistent UX across the application

## Technical Challenges Solved

### Challenge: innerHTML Event Binding

Angular cannot bind events to content rendered through `[innerHTML]` for security reasons (XSS prevention). The `format.service.ts` generates HTML strings for mentions in articles:

```typescript
replacement: `<a href="/p/${npub}" class="nostr-mention" data-pubkey="${pubkey}" data-type="profile">@${username}</a>`
```

**Solution:** Created `MentionHoverDirective` that uses native DOM event delegation with the capture phase to intercept events on dynamically created elements.

### Challenge: Finding Mention Elements

Event delegation fires on any child element, not just mention links.

**Solution:** `findMentionLink()` method traverses DOM hierarchy to locate parent with `.nostr-mention` class.

### Challenge: Maintaining State Across Dynamic Content

Mentions can appear/disappear as content updates.

**Solution:** Directive stores reference to `currentTrigger` element and validates it before showing hover card.

## Notes

- Template approach: Hover card only for `npub` and `nprofile` mentions (not `nevent` or `note`)
- Directive approach: Checks `data-type="profile"` attribute before showing card
- Index signature access used for `token.nostrData['pubkey']` to satisfy TypeScript strict mode
- All timeouts properly cleaned up to prevent memory leaks
- Directive cleans up event listeners in `ngOnDestroy()`
- Uses capture phase (`true` parameter) for event delegation to ensure events are caught
- Follows Angular best practices: signals, standalone components, OnPush change detection
- Both approaches share identical hover card positioning and state management logic
