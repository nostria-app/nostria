# Install App Feature Implementation

## Overview
Added an "Install App" option to the apps menu (`menuApps`) that intelligently detects the user's platform and installation status, showing relevant installation options.

## Components

### 1. InstallService (`install.service.ts`)
**Purpose:** Manages platform detection, PWA installation status, and installation prompts.

**Key Features:**
- Detects user's platform (Windows, Android, iOS, macOS, Linux)
- Checks if app is already installed as PWA
- Listens for `beforeinstallprompt` event for PWA installation
- Determines if installation options should be shown
- Opens installation dialog

**Signals:**
- `canInstall`: Whether PWA can be installed (browser supports it)
- `isInstalled`: Whether app is currently running as installed PWA
- `platformInfo`: Detailed platform detection results

**Key Methods:**
- `detectPlatformAndInstallation()`: Detects platform and checks installation status
- `setupInstallPrompt()`: Listens for PWA installation events
- `promptInstall()`: Triggers browser's native PWA install prompt
- `openInstallDialog()`: Opens the installation options dialog
- `shouldShowInstallOption()`: Returns true if "Install App" menu should be shown

### 2. InstallDialogComponent (`install-dialog.component.ts`)
**Purpose:** Dialog that presents installation options based on platform and capabilities.

**Features:**
- **PWA Installation:** Shows "Install Now" button if browser supports PWA installation
- **Microsoft Store:** Link to Windows Store (for Windows users)
- **Google Play Store:** Link to Play Store (for Android users)
- **Apple App Store:** Link to App Store (for iOS users)
- **iOS Instructions:** Special instructions for iOS/Safari users on how to add to home screen

**Styling:**
- Highlighted PWA option with primary container color
- Icon-based visual design for each platform
- Responsive layout
- Material Design components

### 3. App Component Updates (`app.ts` & `app.html`)

**app.ts:**
- Added `installService` injection
- Added `openInstallDialog()` method to trigger the dialog

**app.html:**
- Added conditional "Install App" menu item to `menuApps`
- Only shows if `installService.shouldShowInstallOption()` returns true
- Placed at the bottom of the menu with a divider

## Installation Detection Logic

### When "Install App" is Hidden:
1. **Already Installed:** App is running as standalone PWA
   - Detected via `(display-mode: standalone)` media query
   - Or via `window.navigator.standalone` (iOS)

### When "Install App" is Shown:
1. **PWA Installable:** Browser supports PWA installation
   - `beforeinstallprompt` event fired
   - Shows "Install as Web App" option
   
2. **Platform with Store:** User is on Windows, Android, or iOS
   - Shows respective store links
   - iOS users get additional instructions for Safari

## Store Links (To Be Updated)

Currently using placeholder links:
- **Windows:** `https://www.microsoft.com/store/apps`
- **Android:** `https://play.google.com/store/apps`
- **iOS:** `https://apps.apple.com/`

**TODO:** Replace these with actual Nostria app store links when available.

## User Experience Flow

1. **User Opens Apps Menu:** Clicks the apps icon in toolbar
2. **Sees "Install App" Option:** If not already installed
3. **Clicks "Install App":** Dialog opens with relevant options
4. **Chooses Installation Method:**
   - PWA: Clicks "Install Now" → Native browser prompt
   - Store: Clicks "Open Store" → Opens store in new tab
   - iOS: Follows on-screen instructions

## Platform Detection Details

```typescript
interface PlatformInfo {
  isWindows: boolean;    // /windows/ in user agent
  isAndroid: boolean;    // /android/ in user agent
  isIOS: boolean;        // /iphone|ipad|ipod/ in user agent
  isMacOS: boolean;      // /macintosh|mac os x/ (not iOS)
  isLinux: boolean;      // /linux/ (not Android)
  canInstallPWA: boolean; // beforeinstallprompt fired
  isInstalled: boolean;   // Running as standalone
}
```

## Technical Notes

### PWA Installation States
- **Not Installed + Can Install:** Shows PWA install button
- **Not Installed + Cannot Install:** Shows store links or instructions
- **Installed:** Menu option hidden completely

### Browser Support
- **Chrome/Edge:** Full PWA support with `beforeinstallprompt`
- **Safari (iOS):** Manual "Add to Home Screen" instructions
- **Firefox:** Store links as fallback

### iOS Special Handling
iOS Safari doesn't support `beforeinstallprompt`, so:
1. Shows instructions for manual installation
2. Still offers App Store link (if available)

## Future Enhancements

1. **Store Links:** Update with actual Nostria store URLs
2. **Analytics:** Track installation method preferences
3. **Localization:** Translate dialog content
4. **Deep Linking:** Support installation from specific pages
5. **Version Checking:** Notify if newer version available in store

## Files Modified/Created

**Created:**
- `src/app/services/install.service.ts`
- `src/app/components/install-dialog/install-dialog.component.ts`

**Modified:**
- `src/app/app.ts` (added InstallService injection and method)
- `src/app/app.html` (added "Install App" menu item)

## Testing Checklist

- [ ] Menu option hidden when app already installed as PWA
- [ ] Menu option shown when app not installed
- [ ] PWA install works on Chrome/Edge
- [ ] iOS instructions displayed on Safari
- [ ] Store links open in new tab
- [ ] Dialog closes after installation
- [ ] Platform detection works correctly on all platforms
- [ ] Responsive design works on mobile and desktop
