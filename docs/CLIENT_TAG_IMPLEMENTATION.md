# Client Tag Implementation in Note Editor

## Overview
Implemented client tag functionality in the note editor that allows users to add or omit the Nostria client tag on a per-post basis, while respecting their global preference set in settings.

## Changes Made

### 1. LocalSettingsService (`local-settings.service.ts`)

Already implemented in a previous update:
- `addClientTag: boolean` - Default: `true`
- `showClientTag: boolean` - Default: `true`

Users can change these defaults in Settings → General → Client Tags.

### 2. Note Editor Dialog Component (`note-editor-dialog.component.ts`)

**Imports:**
- Added `LocalSettingsService` import

**Service Injection:**
```typescript
private localSettings = inject(LocalSettingsService);
```

**New Signal:**
```typescript
addClientTag = signal(true); // Default to true, will be set from user preference in constructor
```

**Constructor Changes:**
- Reads the user's preference from `localSettings.addClientTag()` and sets it as the default value
```typescript
this.addClientTag.set(this.localSettings.addClientTag());
```

**Auto-Draft Interface (`NoteAutoDraft`):**
- Added `addClientTag: boolean` field to preserve the user's choice when auto-saving drafts

**Auto-Save Methods:**
- `saveAutoDraft()`: Saves the `addClientTag` value with the draft
- `loadAutoDraft()`: Restores the `addClientTag` value, falling back to user preference if not in draft

**Tag Building (`buildTags()`):**
- Added client tag logic at the end of the method:
```typescript
// Add client tag if enabled
if (this.addClientTag()) {
  tags.push(['client', 'nostria']);
}
```

### 3. Note Editor Dialog Template (`note-editor-dialog.component.html`)

**Advanced Options Section:**
Added a new toggle option between "Upload Original" and "Expiration":

```html
<!-- Add Client Tag Option -->
<div class="option-row">
  <div class="option-header">
    <mat-slide-toggle [checked]="addClientTag()" (change)="addClientTag.set($event.checked)" color="primary">
      Add Client Tag
    </mat-slide-toggle>
    <span class="option-description">
      Add the Nostria client tag to this event
    </span>
  </div>
</div>
```

## User Experience

### Default Behavior
1. When opening the note editor, the "Add Client Tag" toggle is set to the user's global preference from Settings
2. By default, this is `true` (enabled), so users are opted-in to adding client tags
3. Users can override this on a per-post basis using the toggle in Advanced Options

### Per-Post Override
1. Click the settings icon (⚙️) in the note editor to open Advanced Options
2. Toggle "Add Client Tag" on or off for this specific post
3. The choice is saved with auto-drafts if the user leaves and returns to the draft

### Global Setting
Users can change the default behavior in Settings → General → Client Tags:
- Toggle "Add Client Tag" to change the default for all new posts
- This doesn't affect posts that are already drafted or have been explicitly toggled

## Technical Details

### Client Tag Format
The client tag follows the Nostr convention:
```typescript
['client', 'nostria']
```

Where:
- First element: `'client'` (the tag type)
- Second element: `'nostria'` (lowercase client name)

### Tag Placement
The client tag is added at the end of the tags array, after:
- Reply tags (e tags)
- Quote tags (q tags)
- Mention tags (p tags)
- Expiration tags (expiration)

### Auto-Draft Persistence
The user's per-post choice for `addClientTag` is:
- Saved with auto-drafts every 2 seconds
- Restored when returning to a draft
- Falls back to the global preference if the draft was created before this feature was implemented

## Related Files
- `src/app/services/local-settings.service.ts` - Global settings storage
- `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` - Note editor logic
- `src/app/components/note-editor-dialog/note-editor-dialog.component.html` - Note editor UI
- `src/app/pages/settings/general/general.component.ts` - Settings page logic
- `src/app/pages/settings/general/general.component.html` - Settings page UI

## Future Considerations
- The "Show Client Tag" setting (also added to Settings) can be used in other components to display or hide client information in the UI
- Consider adding the client tag to other event types (long-form articles, DMs, etc.) in their respective editors
