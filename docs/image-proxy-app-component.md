# Image Proxy Support for User Profile Images in App Component

## Overview
This document describes the implementation of image proxy support for user profile images displayed in the main app component (`app.html`). This enhancement ensures that user profile images are cached for offline use in the PWA app when the image cache feature is enabled in settings.

## Problem Statement
Previously, user profile images in `app.html` were loaded directly from their original URLs without going through the image proxy. This meant:
- Images were not cached for offline use in the PWA
- Images were not optimized for size and performance
- The behavior was inconsistent with other components (like `user-profile` and `profile-hover-card`) that already used the image proxy

## Solution
Added support for the image proxy to three locations in `app.html` where user profile pictures are displayed:

1. **Profile button avatar** (toolbar, top right) - Line 124
2. **Profile avatar in profile sidenav header** - Line 244
3. **Profile avatars in accounts list** - Line 332

## Implementation Details

### Changes to `app.ts`
1. **Import**: Added `ImageCacheService` import in alphabetical order
2. **Injection**: Injected `ImageCacheService` into the App component
3. **Helper Method**: Created `getOptimizedImageUrl()` method that:
   - Accepts `string | undefined` parameter (for type safety)
   - Returns empty string if URL is falsy
   - Delegates to `ImageCacheService.getOptimizedImageUrl()` for the actual optimization

```typescript
getOptimizedImageUrl(originalUrl: string | undefined): string {
  if (!originalUrl) return '';
  return this.imageCacheService.getOptimizedImageUrl(originalUrl);
}
```

### Changes to `app.html`
For each location where a profile picture is displayed, added a conditional check:

```html
@if (settings.settings().imageCacheEnabled) {
  <img [src]="getOptimizedImageUrl(metadata.data.picture)" alt="Profile picture" class="avatar-image" />
} @else {
  <img [src]="metadata.data.picture" alt="Profile picture" class="avatar-image" />
}
```

This pattern:
- Only uses the image proxy when enabled in settings
- Falls back to direct URLs when disabled
- Matches the implementation in other components

## Benefits
1. **Offline Support**: Profile images are now cached by the service worker for offline use
2. **Performance**: Images are optimized (96x96) by the proxy before being served
3. **Consistency**: All profile image displays now follow the same pattern
4. **User Control**: Users can enable/disable image caching via settings
5. **Regional CDN**: Images are served from the user's selected regional proxy

## Testing Considerations
To test this implementation:
1. Enable image cache in settings (Settings → Privacy → Image Cache)
2. Verify profile images load in the toolbar button
3. Open the profile sidenav and verify the profile avatar
4. Switch between accounts and verify avatars in the accounts list
5. Disable image cache and verify images still load (direct URLs)
6. Test offline functionality with PWA

## Security
- CodeQL security scan: **0 alerts** ✅
- No new vulnerabilities introduced
- Image URLs are properly encoded when sent to the proxy

## Related Components
Components that already use the image proxy pattern:
- `user-profile.component` - Main profile display component
- `profile-hover-card.component` - Profile hover preview card

## Future Enhancements
Consider extending image proxy support to other components that display user images, such as:
- Timeline/feed components
- Search results
- Badge displays
- Music artist displays
