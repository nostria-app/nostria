# Settings Page Mobile Title Fix

## Problem

On mobile devices, when viewing the settings menu (after closing a settings detail page), the app title displayed "General" even though the settings menu was being shown, not the General settings page itself. This was misleading to users.

## Root Cause

The issue occurred because:

1. On mobile, the settings page has two states:
   - **Menu state**: Shows the list of settings options (`showDetails = false`)
   - **Detail state**: Shows a specific settings page like General, Algorithm, etc. (`showDetails = true`)

2. When the user clicked the close button to go back to the menu, the component navigated to `/settings` and set `showDetails` to `false`.

3. However, the Angular route configuration has a redirect from empty path to `general`:
   ```typescript
   { path: '', redirectTo: 'general', pathMatch: 'full' }
   ```

4. Due to the URL being `/settings` (parent route), the router's title resolver would see the active child route as `general` (due to the redirect), even though on mobile the menu was being displayed.

5. The page title was always reflecting the active section ("General") rather than considering whether the menu or detail view was being shown.

## Solution

Added an `effect()` that reactively updates the page title based on three factors:

1. **Mobile state** (`isMobile`): Whether the viewport is mobile-sized
2. **View state** (`showDetails`): Whether showing the menu or a detail page
3. **Active section** (`activeSection`): Which settings page is selected

The logic is:
- **On mobile showing menu**: Title = "Settings" (the menu view)
- **On mobile showing details OR on desktop**: Title = section name (e.g., "General", "Algorithm", etc.)

## Implementation

```typescript
// Update page title based on mobile state and active section
effect(() => {
  const mobile = this.isMobile();
  const details = this.showDetails();
  const section = this.activeSection();
  
  // On mobile, when showing menu (not details), show "Settings" as title
  // When showing details or on desktop, show the section title
  if (mobile && !details) {
    this.titleService.setTitle('Settings');
  } else {
    const sectionTitle = this.sections.find(s => s.id === section)?.title || 'Settings';
    this.titleService.setTitle(sectionTitle);
  }
});
```

## Changes Made

1. Imported `effect` from `@angular/core`
2. Imported `Title` service from `@angular/platform-browser`
3. Injected `Title` service as `titleService`
4. Added an `effect()` in the constructor that reactively updates the page title based on the current view state

## Testing

To verify the fix works:

1. Open the app on a mobile viewport (or use browser dev tools to simulate mobile)
2. Navigate to Settings
3. Click on "General" to open the General settings page
   - Title should show "General"
4. Click the close button (X) to go back to the settings menu
   - Title should now show "Settings" (not "General")
5. Try with other settings sections to ensure it works consistently

On desktop/tablet (larger screens), the title should always show the active section name since the menu and details are shown side-by-side.
