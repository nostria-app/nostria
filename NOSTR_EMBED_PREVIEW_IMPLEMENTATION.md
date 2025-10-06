# Nostr Embed Preview & NPub Truncation Implementation

## Summary
This document describes the implementation of embedded preview cards for Nostr identifiers in articles and the truncation of npub values in user mentions.

## Changes Made

### 1. NPub Truncation in Profile Display Names

**Files Modified:**
- `src/app/components/user-profile/display-name/profile-display-name.component.ts`
- `src/app/components/user-profile/display-name/profile-display-name.component.html`

**Changes:**
- Added `truncatedNpubValue()` computed property that returns only the first 8 characters of an npub
- Updated the template to use `truncatedNpubValue()` instead of `npubValue()` when displaying fallback names
- This ensures that when a user profile is not found in the "Mentioned:" listing, only `npub1xxx` (8 chars) is shown instead of the full npub string

**Before:**
```
Mentioned: npub1abcdefghijklmnopqrstuvwxyz1234567890...
```

**After:**
```
Mentioned: npub1abc
```

### 2. Embedded Preview Cards for Nostr Identifiers

**Files Modified:**
- `src/app/services/format/format.service.ts`
- `src/app/components/content/content.component.scss`
- `src/app/pages/article/article.component.scss`

**Changes:**

#### Format Service (`format.service.ts`)
- Added `escapeHtml()` helper method to prevent XSS attacks
- Enhanced the `naddr` case in `processNostrTokens()` to generate rich embedded preview cards instead of simple inline links
- Preview cards include:
  - Icon indicator (📄)
  - Article title/identifier
  - Metadata (Article type, Kind number)
  - Clickable link to full content

**Preview Card Structure:**
```html
<div class="nostr-embed-preview">
  <a href="/a/{naddr}" class="nostr-embed-link">
    <div class="nostr-embed-icon">
      <span class="embed-icon">📄</span>
    </div>
    <div class="nostr-embed-content">
      <div class="nostr-embed-title">Article Title</div>
      <div class="nostr-embed-meta">Article · Kind 30023</div>
    </div>
  </a>
</div>
```

#### Styling
Added comprehensive CSS styling for `.nostr-embed-preview` with:
- **Card appearance**: Border, rounded corners, padding
- **Hover effects**: Shadow, border color change, background highlight
- **Responsive layout**: Flexbox for icon and content
- **Dark mode support**: Appropriate colors for dark theme
- **Typography**: Proper font sizes, weights, line clamping
- **Visual hierarchy**: Clear distinction between title and metadata

### 3. Benefits

#### User Experience
- **Better Content Discovery**: Article references are now visually prominent with embedded previews
- **Cleaner Mentions**: NPub fallbacks are concise and readable
- **Professional Appearance**: Rich preview cards look polished and modern
- **Accessibility**: Clear visual hierarchy and clickable areas

#### Technical
- **Security**: HTML escaping prevents XSS attacks
- **Performance**: Lightweight CSS-only implementation
- **Maintainability**: Centralized styling with CSS variables
- **Consistency**: Uniform appearance across light and dark themes

## Usage Examples

### In Articles
When an article contains:
```
Check out this article: nostr:naddr1...
```

It now renders as an embedded preview card with the article title, icon, and metadata, making it easy to see what's being referenced without leaving the current article.

### In Mentions
When a user is mentioned but their profile isn't loaded:
- **Before**: `@npub1abcdefghijklmnopqrstuvwxyz1234567890`
- **After**: `@npub1abc`

## CSS Variables Used

The implementation uses Material Design system variables for consistent theming:
- `--mat-sys-primary` - Primary color for borders and accents
- `--mat-sys-primary-container` - Background for icon container
- `--mat-sys-on-surface` - Primary text color
- `--mat-sys-on-surface-variant` - Secondary text color
- `--mat-sys-outline-variant` - Border colors
- `--mat-sys-surface-variant` - Hover backgrounds

## Browser Support

- All modern browsers (Chrome, Firefox, Safari, Edge)
- Graceful degradation for older browsers
- Dark mode support via CSS classes

## Future Enhancements

Potential improvements for future iterations:
1. Load actual article metadata (title, description, image) dynamically
2. Add loading states for preview cards
3. Support for other Nostr event types (video, audio, etc.)
4. Cache article metadata for performance
5. Add tooltips with full npub on hover for truncated values
