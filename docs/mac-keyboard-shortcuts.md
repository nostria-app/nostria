# Mac Keyboard Shortcuts Implementation

## Overview
This document describes the implementation of cross-platform keyboard shortcuts that work correctly on both Mac (using Cmd/⌘) and Windows/Linux (using Alt).

## Problem
Previously, all keyboard shortcuts used the Alt modifier key, which follows Windows/Linux conventions but is not idiomatic on Mac. Mac users expect to use the Command (⌘) key instead of Alt for application shortcuts.

## Solution
Created a centralized `PlatformService` that:
1. Detects the user's operating system
2. Provides a cross-platform API for checking modifier keys
3. Formats keyboard shortcuts correctly for display based on platform

## Changes Made

### 1. New PlatformService (`src/app/services/platform.service.ts`)
A new service that handles platform detection and keyboard modifier logic:

```typescript
class PlatformService {
  // Platform detection signals
  readonly isMac: Signal<boolean>
  readonly isWindows: Signal<boolean>
  readonly isLinux: Signal<boolean>
  
  // Check if correct modifier key is pressed
  hasModifierKey(event: KeyboardEvent): boolean
  
  // Get display name for modifier key ("Cmd", "Alt", "⌘")
  getModifierKeyDisplay(useSymbol?: boolean): string
  
  // Format shortcut for display ("Cmd+C", "Alt+C")
  formatShortcut(key: string, useSymbol?: boolean): string
}
```

### 2. Updated App Component (`src/app/app.ts`)
Modified the global keyboard event handler to use platform-aware modifier detection:

**Before:**
```typescript
if (event.altKey && event.key.toLowerCase() === 'c') {
  this.openCommandPalette();
}
```

**After:**
```typescript
if (this.platformService.hasModifierKey(event) && event.key.toLowerCase() === 'c') {
  this.openCommandPalette();
}
```

### 3. Updated Shortcuts Dialog (`src/app/components/shortcuts-dialog/shortcuts-dialog.component.ts`)
Changed to dynamically display the correct modifier key based on platform:

**Before:**
```typescript
shortcuts = [
  { keys: 'Alt+C', description: 'Open command palette' }
]
```

**After:**
```typescript
shortcuts = computed(() => {
  const modifier = this.platformService.getModifierKeyDisplay();
  return [
    { keys: `${modifier}+C`, description: 'Open command palette' }
  ];
});
```

### 4. Updated Note Editor Dialog (`src/app/components/note-editor-dialog/note-editor-dialog.component.ts`)
Applied the same pattern to note editor shortcuts:
- **Alt+Enter / Cmd+Enter**: Publish note
- **Alt+D / Cmd+D**: Toggle dictation

## Keyboard Shortcuts

All shortcuts now work correctly on both platforms:

| Action | Windows/Linux | Mac | Universal |
|--------|--------------|-----|-----------|
| Open Command Palette | Alt+C | Cmd+C (⌘+C) | Ctrl+K |
| Toggle Search | Alt+S | Cmd+S (⌘+S) | |
| Open Create Options | Alt+N | Cmd+N (⌘+N) | |
| Voice Command | Alt+V | Cmd+V (⌘+V) | |
| Show Shortcuts | Alt+P | Cmd+P (⌘+P) | |
| Publish Note | Alt+Enter | Cmd+Enter (⌘+Enter) | |
| Toggle Dictation | Alt+D | Cmd+D (⌘+D) | |

## Technical Details

### Platform Detection
The service uses `navigator.userAgent` to detect the platform:
```typescript
isMac = /macintosh|mac os x/.test(userAgent) && !/iphone|ipad|ipod/.test(userAgent)
```

### Modifier Key Logic
On Mac, the Command key is the `metaKey` in keyboard events:
```typescript
hasModifierKey(event: KeyboardEvent): boolean {
  if (this.isMac()) {
    return event.metaKey && !event.ctrlKey;
  } else {
    return event.altKey && !event.metaKey;
  }
}
```

The logic excludes the wrong modifier to prevent conflicts:
- On Mac: Check for `metaKey` without `ctrlKey`
- On Windows/Linux: Check for `altKey` without `metaKey`

## Testing
A comprehensive test suite (`platform.service.spec.ts`) verifies:
- Platform detection logic
- Modifier key detection for both platforms
- Display name formatting
- Shortcut formatting

## Future Enhancements
1. Add more keyboard shortcuts following the same pattern
2. Allow users to customize shortcuts
3. Add visual keyboard shortcut overlays for discoverability
4. Support additional platforms (iOS, Android) if needed

## Migration Guide
To add new keyboard shortcuts in the future:

1. Use `PlatformService.hasModifierKey()` instead of checking `event.altKey` directly:
```typescript
// ✅ Good
if (this.platformService.hasModifierKey(event) && event.key === 'x') {
  // Handle shortcut
}

// ❌ Bad
if (event.altKey && event.key === 'x') {
  // This won't work on Mac
}
```

2. Update the shortcuts dialog to include your new shortcut
3. Add tests to verify cross-platform behavior

## References
- [Mac Keyboard Shortcuts Guidelines](https://developer.apple.com/design/human-interface-guidelines/keyboards)
- [Keyboard Event API](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)
- [Angular Signals](https://angular.dev/guide/signals)
