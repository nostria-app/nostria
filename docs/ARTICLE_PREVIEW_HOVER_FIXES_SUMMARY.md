# Article Preview Hover Card Fixes - Summary

## Overview
Fixed multiple issues with profile hover cards in the article editor preview, including flickering, incorrect positioning, and runtime errors.

## Issues Fixed

### 1. Flickering Preview (Critical)
**Problem**: The entire article preview was flickering/recalculating when hovering over profile links or when any cache access occurred anywhere in the app.

**Root Cause**: The Cache service updates internal `_stats` signal on every `get()` call. The `getCachedDisplayName()` method was called inside the `markdownHtml` computed property, creating a reactive dependency on cache stats. Any cache access (even from other components) triggered the computed to recalculate, regenerating the entire preview HTML.

**Solution**: Wrapped cache access in `untracked()` to prevent reactive dependency:
```typescript
private getCachedDisplayName(pubkey: string): string {
  return untracked(() => {
    const cacheKey = `metadata-${pubkey}`;
    const record = this.cache.get<NostrRecord>(cacheKey);
    // ... rest of logic
  });
}
```

### 2. Incorrect Hover Card Positioning
**Problem**: Hover cards appeared in the top-left corner of the viewport instead of near the hovered username.

**Root Cause**: The CDK Overlay's `flexibleConnectedTo()` needed a proper `ElementRef` wrapper to correctly calculate position relative to the hovered element.

**Solution**: Created ElementRef wrapper in the directive:
```typescript
const elementRef = new ElementRef(element);
const positionStrategy = this.overlay
  .position()
  .flexibleConnectedTo(elementRef)
```

### 3. Runtime Error on Hover
**Problem**: Console error when hovering: `TypeError: this.hoverCardComponentRef.instance.pubkey.set is not a function`

**Root Cause**: Using outdated API to set component inputs with signal-based inputs created by `input.required()`.

**Solution**: Used correct Angular API:
```typescript
// Old (broken)
this.hoverCardComponentRef.instance.pubkey.set(pubkey);

// New (correct)
this.hoverCardComponentRef.setInput('pubkey', pubkey);
```

## Files Modified

### 1. `editor.component.ts`
- Added `untracked` import
- Wrapped cache access in `getCachedDisplayName()` with `untracked()`
- Added imports for `Cache`, `NostrRecord`, and `MentionHoverDirective`
- Updated `processNostrReferences()` to use `nostr-mention` class and data attributes

### 2. `editor.component.html`
- Added `appMentionHover` directive to preview-markdown container

### 3. `mention-hover.directive.ts`
- Fixed input setting API from `.instance.pubkey.set()` to `.setInput()`
- Wrapped HTMLElement in ElementRef for proper positioning

## Key Technical Insights

### Angular Signals and Reactivity
- Signals create reactive dependencies when accessed inside computed properties
- The `untracked()` function prevents creating these dependencies
- Cache services with signal-based stats need careful handling in computed properties

### CDK Overlay Positioning
- `flexibleConnectedTo()` works better with `ElementRef` wrappers
- Especially important for dynamically created elements from `[innerHTML]`
- Ensures accurate positioning calculations

### Signal-Based Component Inputs
- Modern Angular inputs created with `input()` or `input.required()` use signals
- Use `ComponentRef.setInput(name, value)` to set inputs on dynamically created components
- The old `.instance.propertyName.set()` pattern doesn't work with signal inputs

## Testing Checklist

✅ Hover over profile name in article preview - no flickering  
✅ Hover card appears near the hovered username  
✅ Hover card shows after 500ms delay  
✅ Hover card stays open when mouse moves over it  
✅ Hover card closes when mouse leaves both trigger and card  
✅ No console errors when hovering  
✅ Preview doesn't regenerate when hovering over profiles  
✅ Preview doesn't regenerate when cache is accessed elsewhere in the app  

## Related Documentation

- `docs/ARTICLE_PREVIEW_HOVER_CARDS.md` - Detailed implementation guide
- `docs/ARTICLE_PREVIEW_DISPLAY_NAMES.md` - Profile display name implementation
- `docs/ARTICLE_PREVIEW_NOSTR_PARSING.md` - Initial nostr: parsing implementation
- `docs/NIP27_IMPLEMENTATION.md` - NIP-27 compliance implementation

## Performance Impact

**Before**: 
- Preview recalculated on every cache access (potentially dozens per second)
- Entire markdown-to-HTML conversion and nostr: reference processing on each recalculation
- Visible flickering and performance degradation

**After**:
- Preview only recalculates when article content actually changes
- Cache access doesn't trigger reactivity
- Smooth, flicker-free user experience

## Lessons Learned

1. **Be cautious with cache services in computed properties** - Cache implementations that track statistics with signals can create unexpected reactive dependencies

2. **Use `untracked()` for non-reactive data access** - When accessing data that shouldn't trigger reactivity (like cache stats), wrap the access in `untracked()`

3. **ElementRef wrapping for CDK Overlay** - When working with dynamically created DOM elements, wrapping in ElementRef ensures better positioning

4. **Signal-based inputs require modern API** - Always use `ComponentRef.setInput()` for dynamically created components with signal-based inputs

5. **Test with cache activity** - Reactive issues with caches may not appear until other parts of the app are actively using the cache
