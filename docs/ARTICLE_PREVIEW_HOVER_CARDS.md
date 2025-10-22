# Article Preview Hover Cards and Flickering Fix

## Issues Addressed

1. **Missing Hover Cards**: Profile links in article preview weren't showing hover cards when mousing over user names
2. **Flickering Underlines**: The underline effect and entire preview was flickering when hovering over profile links
3. **Directive Input Error**: Fixed `pubkey.set is not a function` error in MentionHoverDirective
4. **Incorrect Positioning**: Hover card was appearing in top-left corner instead of near the hovered username

## Root Causes

### Missing Hover Cards
The profile links in the article preview were using the class `nostr-profile-link` without the required attributes for the hover card functionality. The `MentionHoverDirective` expects:
- Class name: `nostr-mention`
- Attribute: `data-pubkey` (the user's public key)
- Attribute: `data-type` (set to "profile" for profile links)

### Flickering Issue
The flickering was caused by the Cache service updating its internal `_stats` signal on every `get()` call. Since the `getCachedDisplayName()` method was called from within the `markdownHtml` computed property, accessing the cache created a reactive dependency. Every time a cache access occurred (including from hover events elsewhere in the app), the stats signal updated, triggering the computed property to recalculate, which regenerated the entire preview HTML.

### Directive Input Error
The `MentionHoverDirective` was using the old API to set component inputs (`instance.pubkey.set(pubkey)`), which doesn't work with Angular's signal-based inputs created by `input.required()`. The correct API is `componentRef.setInput('pubkey', pubkey)`.

### Positioning Issue
The CDK Overlay's `flexibleConnectedTo()` method needed a proper `ElementRef` wrapper around the HTMLElement to correctly calculate the position relative to the hovered element. Without this wrapper, the positioning system defaulted to an incorrect reference point (top-left of the viewport).

## Solution

### 1. Added MentionHoverDirective to Editor Component

**File**: `editor.component.ts`

Added the directive to imports:
```typescript
import { MentionHoverDirective } from '../../../directives/mention-hover.directive';

@Component({
  selector: 'app-editor',
  imports: [
    // ... other imports
    MentionHoverDirective,
  ],
  // ...
})
```

### 2. Applied Directive to Preview Container

**File**: `editor.component.html`

Added the `appMentionHover` directive to the preview markdown container:
```html
<div class="preview-markdown" appMentionHover>
  <div [innerHTML]="markdownHtml()"></div>
</div>
```

### 3. Updated Profile Link Generation

**File**: `editor.component.ts` - `processNostrReferences()` method

Changed profile links to use the correct class and data attributes:

**Before**:
```typescript
return `<a href="/p/${npubIdentifier}" class="nostr-profile-link" title="${match}">@${displayName}</a>`;
```

**After**:
```typescript
return `<a href="/p/${npubIdentifier}" class="nostr-mention" data-pubkey="${pubkey}" data-type="profile" title="${match}">@${displayName}</a>`;
```

This change applies to both `npub` and `nprofile` reference types.

### 4. Fixed MentionHoverDirective Input Setting

**File**: `mention-hover.directive.ts`

Changed from the old input API to the correct Angular signal-based input API:

**Before**:
```typescript
this.hoverCardComponentRef.instance.pubkey.set(pubkey);
```

**After**:
```typescript
this.hoverCardComponentRef.setInput('pubkey', pubkey);
```

This uses Angular's `ComponentRef.setInput()` method which properly handles signal-based inputs created with `input.required()`.

### 5. Fixed Flickering with untracked()

**File**: `editor.component.ts` - `getCachedDisplayName()` method

Wrapped cache access in `untracked()` to prevent reactive dependencies:

**Before**:
```typescript
private getCachedDisplayName(pubkey: string): string {
  const cacheKey = `metadata-${pubkey}`;
  const record = this.cache.get<NostrRecord>(cacheKey);
  // ...
}
```

**After**:
```typescript
private getCachedDisplayName(pubkey: string): string {
  return untracked(() => {
    const cacheKey = `metadata-${pubkey}`;
    const record = this.cache.get<NostrRecord>(cacheKey);
    // ...
  });
}
```

This prevents the Cache service's internal `_stats` signal from creating a reactive dependency that would cause the entire preview to recalculate on every cache access.

### 6. Fixed Positioning with ElementRef

**File**: `mention-hover.directive.ts` - `showHoverCard()` method

Wrapped HTMLElement in ElementRef for proper positioning:

**Before**:
```typescript
const positionStrategy = this.overlay
  .position()
  .flexibleConnectedTo(element)
```

**After**:
```typescript
const elementRef = new ElementRef(element);
const positionStrategy = this.overlay
  .position()
  .flexibleConnectedTo(elementRef)
```

This ensures the CDK Overlay positioning system correctly calculates the position relative to the hovered element.

## How It Works

1. **Event Delegation**: The `MentionHoverDirective` uses event delegation to listen for mouse events on the preview container
2. **Hover Detection**: When the mouse enters an element with class `nostr-mention` and `data-type="profile"`, it waits 500ms before showing the hover card
3. **Profile Loading**: The directive extracts the `data-pubkey` attribute and passes it to `ProfileHoverCardComponent`
4. **Card Display**: The hover card shows above, below, left, or right of the trigger element (whichever fits best)
5. **Smart Closing**: The card stays open when mousing over it, and closes when the mouse leaves both the trigger and the card

## Benefits

✅ **Hover Cards Work**: Users can now hover over profile names in article preview to see profile cards  
✅ **No Flickering**: Using `untracked()` eliminates flickering caused by cache stat updates  
✅ **Correct Positioning**: Hover cards now appear near the hovered username, not in the top-left corner  
✅ **Consistent UX**: Article preview now behaves the same as note content for profile mentions  
✅ **Delayed Loading**: 500ms delay prevents cards from appearing when quickly moving the mouse  
✅ **Reusable Infrastructure**: Uses existing `MentionHoverDirective` and `ProfileHoverCardComponent`  
✅ **Performance**: Prevents unnecessary recomputation of preview HTML

## Technical Details

### Cache and Reactivity
The Cache service internally tracks statistics (hits, misses, evictions) using signals. Every `cache.get()` call updates these stats, which can create unwanted reactive dependencies in computed properties. By wrapping cache access in `untracked()`, we prevent the computed property from subscribing to cache stat changes.

### CDK Overlay Positioning
The Angular CDK Overlay positioning system requires a proper reference to calculate positions. While `flexibleConnectedTo()` can accept HTMLElement directly, wrapping it in an `ElementRef` ensures more reliable positioning, especially for dynamically created elements from `[innerHTML]`.

### MentionHoverDirective Features
- Uses CDK Overlay for positioning
- 500ms delay before showing (prevents accidental triggers)
- Flexible positioning (top, bottom, left, right)
- Keeps card open when mouse is over it
- Auto-closes when mouse leaves both trigger and card
- Uses event delegation for dynamic content

### Profile Link Attributes
- `class="nostr-mention"`: Required for directive detection
- `data-pubkey="..."`: The user's hex public key
- `data-type="profile"`: Identifies this as a profile link (not an event link)
- `href="/p/npub..."`: Navigation target
- `title="nostr:npub..."`: Shows the full nostr URI on hover

## Testing

To verify these fixes:

1. Create an article with a profile reference (e.g., `nostr:npub1...`)
2. Switch to the preview tab
3. Hover over the profile name
4. The hover card should appear after 500ms without flickering
5. Move the mouse over the hover card - it should stay open
6. Move the mouse away - the card should close

## Related Files

- `src/app/pages/article/editor/editor.component.ts` - Added directive import and updated link generation
- `src/app/pages/article/editor/editor.component.html` - Added appMentionHover directive
- `src/app/directives/mention-hover.directive.ts` - Fixed input setting API for signal-based inputs
- `src/app/components/user-profile/hover-card/profile-hover-card.component.ts` - Hover card component (existing)

## Related Documentation

- `docs/ARTICLE_PREVIEW_DISPLAY_NAMES.md` - Profile display name implementation
- `docs/ARTICLE_PREVIEW_NOSTR_PARSING.md` - Initial nostr: parsing implementation
- `docs/NIP27_IMPLEMENTATION.md` - NIP-27 compliance implementation
