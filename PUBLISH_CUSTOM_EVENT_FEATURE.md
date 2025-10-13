# Publish Custom Event Feature

## Overview
Added a new "Publish Event" option to the apps menu that allows users to paste any Nostr event JSON and publish it to selected relays.

## Changes Made

### 1. Extended PublishDialogComponent
**File**: `src/app/components/publish-dialog/publish-dialog.component.ts`

- Updated `PublishDialogData` interface to support custom mode:
  ```typescript
  export interface PublishDialogData {
    event?: Event;
    customMode?: boolean;
  }
  ```

- Added new signals for custom event mode:
  - `customMode`: Boolean signal to track if in custom mode
  - `customEventJson`: Signal to store the pasted event JSON
  - `customEventError`: Signal to display validation errors

- Added `parseCustomEvent()` method:
  - Parses and validates the JSON input
  - Checks for all required Nostr event fields (id, pubkey, created_at, kind, tags, content, sig)
  - Returns validated Event object or null with error message

- Updated `publish()` method:
  - Now handles both normal mode (with pre-set event) and custom mode (with user-pasted event)
  - Validates custom event JSON before publishing

- Updated `canPublish()` method:
  - Includes validation for custom mode (requires non-empty JSON input)

- Added `onCustomEventChange()` method:
  - Handles user input in the custom event textarea
  - Clears errors as user types

- Updated `getEventJson()` method:
  - Returns parsed custom event JSON in custom mode
  - Returns original event JSON in normal mode

### 2. Updated PublishDialogComponent Template
**File**: `src/app/components/publish-dialog/publish-dialog.component.html`

- Added conditional title:
  - "Publish Custom Event" in custom mode
  - "Publish Event" in normal mode

- Added custom event input section:
  - Large textarea for pasting Nostr event JSON
  - Displays validation errors below the input
  - Shows helpful placeholder with event structure
  - Helpful hint text

### 3. Updated Styles
**File**: `src/app/components/publish-dialog/publish-dialog.component.scss`

- Added `.custom-event-section` styles
- Added `.full-width` class for form field
- Added `.event-json-input` class with monospace font for better JSON readability

### 4. Added Method to Layout Service
**File**: `src/app/services/layout.service.ts`

- Added `openPublishCustomEvent()` method:
  - Opens the publish dialog in custom mode
  - Sets `customMode: true` in dialog data
  - Uses same dialog configuration as regular publish event

### 5. Added Menu Item
**File**: `src/app/app.html`

- Added "Publish Event" menu item to the apps menu
- Positioned after "Upload" option
- Only visible when user is authenticated
- Uses `publish` icon
- Calls `layout.openPublishCustomEvent()`

## Usage

1. User clicks on the apps menu (three dots icon in toolbar)
2. Selects "Publish Event" option
3. Dialog opens with a textarea for pasting event JSON
4. User pastes a complete signed Nostr event JSON
5. User selects target relays (account relays, author's relays, or custom relays)
6. User clicks "Publish to X Relays" button
7. Event is published to all selected relays
8. Results are displayed showing success/failure for each relay

## Validation

The feature validates that the pasted JSON contains all required Nostr event fields:
- `id` (string)
- `pubkey` (string)
- `created_at` (number)
- `kind` (number)
- `tags` (array)
- `content` (string)
- `sig` (string)

If validation fails, an error message is displayed below the textarea.

## Notes

- The event must be pre-signed (includes valid signature)
- User can view the parsed event JSON by toggling the "Event" button
- User can view target relays by toggling the "Relays" button
- All existing relay selection features work in custom mode
- Publishing results are displayed in real-time
