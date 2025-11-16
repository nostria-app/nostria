# Addressable Video Events (NIP-71) Implementation

## Overview
Implemented full support for NIP-71 addressable video events (kinds 34235 and 34236) in the Nostria app, including rendering and creation capabilities.

## Changes Made

### 1. Video Event Rendering Support

#### Updated Components
- **new-column-dialog.component.ts**: Added kinds 34235 and 34236 to NOSTR_KINDS array with "Addressable" prefix labels
- **feed.service.ts**: Extended COLUMN_TYPES.videos.kinds from `[21]` to `[21, 22, 34235, 34236]`
- **video-event.component.ts**: Updated getVideoData() method to parse addressable video kinds (34235, 34236)
- **event.component.html**: Updated 5 video rendering locations to include addressable video kinds

### 2. Video Event Creation Support

#### Media Publish Dialog
**File**: `media-publish-dialog.component.ts`

- Updated `MediaPublishOptions` interface:
  - Changed kind type from `20 | 21 | 22` to `20 | 21 | 22 | 34235 | 34236`
  - Added `dTag?: string` for addressable event unique identifier
  - Added `origin?: { platform: string; externalId?: string; url?: string }` for imported content

- Added new form signals:
  - `dTag = signal('')` - unique identifier for addressable events
  - `originPlatform = signal('')` - original platform (e.g., youtube, vimeo)
  - `originExternalId = signal('')` - video ID on original platform
  - `originUrl = signal('')` - original URL of the video

- Updated `getAvailableKinds()`:
  - Added options for kinds 34235 and 34236 for video media type
  - Labels: "Addressable Video (kind 34235)" and "Addressable Short Video (kind 34236)"
  - Descriptions: "Updateable normal video (NIP-71)" and "Updateable short video (NIP-71)"

- Updated `publish()` method:
  - Auto-generates d-tag using `${timestamp}-${randomSuffix}` if not provided by user
  - Includes origin tag data if platform is specified

#### Media Publish Dialog Template
**File**: `media-publish-dialog.component.html`

- Added d-tag input field (shown only for kinds 34235/34236):
  - Label: "Unique Identifier (d-tag)"
  - Hint: "Unique identifier for this addressable event (required for updating)"
  - Auto-generates if left empty

- Added origin section (shown only for kinds 34235/34236):
  - Platform field (e.g., youtube, vimeo, rumble)
  - External ID field (original video ID)
  - Original URL field (original video URL)
  - Conditionally shows ID and URL fields only if platform is specified

### 3. Event Building Logic

#### Media Component
**File**: `media.component.ts`

Updated `buildMediaEvent()` method:
- Added d-tag to tags array for kinds 34235/34236
- Extended thumbnail upload logic to support addressable video kinds
- Updated all video kind checks to include 34235 and 34236:
  - Thumbnail URL handling
  - Blurhash generation
  - Duration tag
- Added origin tag construction:
  ```typescript
  ['origin', platform, externalId?, url?]
  ```

#### Media Details Component
**File**: `media-details.component.ts`

Updated `buildMediaEvent()` method:
- Added d-tag support for addressable events
- Updated duration check to include kinds 34235 and 34236
- Added origin tag construction matching media.component.ts

## NIP-71 Compliance

### Required Tags
- **d-tag**: Unique identifier for addressable events (auto-generated if not provided)
  - Format: `${timestamp}-${randomSuffix}` (e.g., "1704067200-a3f9d2")

### Optional Tags
- **origin**: For imported content from other platforms
  - Format: `["origin", "<platform>", "<external-id>", "<original-url>"]`
  - Example: `["origin", "youtube", "dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ"]`

### Event Kinds
- **34235**: Addressable normal/horizontal video (updateable via same d-tag)
- **34236**: Addressable short/vertical video (updateable via same d-tag)

## User Experience

### Rendering
- Addressable videos (kinds 34235, 34236) now render identically to regular videos (kinds 21, 22)
- All existing video features work: thumbnails, blurhash, duration, metadata

### Creation
1. User uploads video file
2. User selects "Addressable Video" or "Addressable Short Video" from Event Type dropdown
3. Optional: User provides custom d-tag identifier (or auto-generated)
4. Optional: User fills in origin platform details if importing from elsewhere
5. Event is published with proper d-tag and origin tags

### Updating
- Users can re-publish with the same d-tag to update an addressable video event
- The newest event with the same d-tag replaces the previous version

## Technical Notes

### D-tag Generation
- Auto-generated format: `${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).substring(2, 8)}`
- Uses seconds timestamp (Nostr standard) not milliseconds
- Includes random suffix for uniqueness in case of rapid publishing

### Video Kind Checks
All video kind checks now follow this pattern:
```typescript
if (kind === 21 || kind === 22 || kind === 34235 || kind === 34236)
```

This ensures addressable videos get the same treatment as regular videos for:
- Thumbnail extraction and upload
- Blurhash generation
- Duration metadata
- imeta tag construction

## Testing Recommendations

1. **Rendering Test**: Subscribe to feeds with addressable video events
2. **Creation Test**: Publish new addressable video with auto-generated d-tag
3. **Update Test**: Re-publish same video with same d-tag to verify update functionality
4. **Origin Test**: Publish addressable video with YouTube origin metadata
5. **Custom d-tag Test**: Publish with user-provided d-tag identifier

## Related Files
- `src/app/pages/feeds/new-column-dialog/new-column-dialog.component.ts`
- `src/app/services/feed.service.ts`
- `src/app/components/event-types/video-event.component.ts`
- `src/app/components/event/event.component.html`
- `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.ts`
- `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.html`
- `src/app/pages/media/media.component.ts`
- `src/app/pages/media/media-details/media-details.component.ts`

## Bug Fixes

### Custom Relay Connection Fix
**File**: `feed.service.ts`

- **Problem**: Custom relay URLs selected in column dialog weren't actually connecting
- **Root Cause**: Code was using `UserRelayService.init(relayUrls)` which is deprecated and doesn't support custom relay URLs
- **Solution**: Refactored to use `RelayPoolService.subscribe(relayUrls, filter, callback)` which properly connects to specified relay URLs
- **Impact**: Custom relay columns now correctly connect to the user-specified relay URLs
