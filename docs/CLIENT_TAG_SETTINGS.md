# Client Tag Settings Implementation

## Overview
Added two new local settings options to control client tag behavior in Nostria.

## Changes Made

### 1. Local Settings Service (`local-settings.service.ts`)

**Added to `LocalSettings` interface:**
- `addClientTag: boolean` - Controls whether to add the Nostria client tag to published events
- `showClientTag: boolean` - Controls whether to display what client authors are using

**Default values:**
- Both settings default to `true`

**New computed signals:**
- `addClientTag()` - Returns the current state of the add client tag setting
- `showClientTag()` - Returns the current state of the show client tag setting

**New setter methods:**
- `setAddClientTag(addClientTag: boolean)` - Updates the add client tag preference
- `setShowClientTag(showClientTag: boolean)` - Updates the show client tag preference

### 2. General Settings Component (`general.component.ts`)

**Added toggle methods:**
- `toggleAddClientTag()` - Toggles the add client tag setting
- `toggleShowClientTag()` - Toggles the show client tag setting

### 3. General Settings Template (`general.component.html`)

**Added new section:**
- "Client Tags" section with two toggle switches
- "Add Client Tag" - "Add the Nostria client tag to events you publish"
- "Show Client Tag" - "Show what client that authors are using"

## Technical Details

### Storage Location
These settings are stored in **local storage only** (not in Nostr events) using the `LocalSettingsService`. They are persisted in the browser's localStorage under the key `nostria-settings`.

### Persistence
Settings are automatically saved to localStorage whenever they change, thanks to the `effect()` in `LocalSettingsService` that monitors the settings signal.

### UI Location
The new options appear in the General settings page, under the "Client Tags" section, positioned after the "Max relays per user" section and before the "Release Channel" section (if applicable).

## Usage

### For Developers

**To check if client tags should be added:**
```typescript
const localSettings = inject(LocalSettingsService);
if (localSettings.addClientTag()) {
  // Add client tag to event
}
```

**To check if client tags should be displayed:**
```typescript
const localSettings = inject(LocalSettingsService);
if (localSettings.showClientTag()) {
  // Show client tag in UI
}
```

### For Users
1. Navigate to Settings → General
2. Scroll to the "Client Tags" section
3. Toggle the switches as desired:
   - Enable "Add Client Tag" to include Nostria's client tag in your published events
   - Enable "Show Client Tag" to see what clients other users are using
