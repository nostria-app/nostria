# Live Event Support (Kind 30311) Implementation

## Summary
Added support for rendering Nostr kind 30311 (Live Events) according to NIP-53 specification.

## Changes Made

### 1. Created New Component: `LiveEventComponent`
**Location:** `src/app/components/event-types/live-event.component.ts`

**Features:**
- Displays live event title and summary
- Shows event status with visual badge (live, planned, ended)
- Displays thumbnail/image
- Shows start and end timestamps
- Displays participant counts (current and total)
- Lists participants with roles (Host, Speaker, Participant)
- Shows hashtags
- Provides "Watch Live" button for active streams
- Links to event details page

**Computed Properties:**
- `title()` - Event title from tags
- `summary()` - Event description
- `status()` - Current status (live/planned/ended)
- `starts()` - Start timestamp (seconds)
- `ends()` - End timestamp (seconds)
- `thumbnail()` - Preview image URL (thumb or image tag)
- `streamingUrl()` - Streaming URL
- `serviceUrl()` - API endpoint URL
- `currentParticipants()` - Current viewer count
- `totalParticipants()` - Total participant count
- `participants()` - List of participants with roles
- `hashtags()` - Event hashtags

**Visual Features:**
- Animated pulsing "LIVE" badge for active streams
- Status-specific colors (red for live, blue for planned, gray for ended)
- Participant chips showing display names and roles
- Clickable thumbnail with status overlay
- Action buttons for watching stream or viewing details

### 2. Template & Styles
**Template:** `src/app/components/event-types/live-event.component.html`
- Responsive layout with thumbnail and details
- Status badge overlay on thumbnail
- Time information with icons
- Participant list with chips
- Hashtag display
- Action buttons based on status

**Styles:** `src/app/components/event-types/live-event.component.scss`
- Modern card-based design
- Animated pulse effect for live status
- Responsive layout
- Material Design integration
- Accessibility-friendly styling

### 3. Integration
**Updated Files:**
- `src/app/components/event-types/index.ts` - Added export
- `src/app/components/event/event.component.ts` - Added import and component registration
- `src/app/components/event/event.component.html` - Added rendering logic for kind 30311 in all contexts:
  - Reposts
  - Root events in threads
  - Parent events in threads
  - Main event rendering

### 4. NIP-53 Compliance
The implementation follows NIP-53 specification for Live Streaming Events (kind 30311):
- Supports all standard tags: `d`, `title`, `summary`, `image`, `thumb`, `status`, `starts`, `ends`, `streaming`, `service`, `current_participants`, `total_participants`, `p`, `t`
- Displays event status (planned, live, ended)
- Shows participant information with roles
- Links to streaming URLs
- Displays timestamps in correct format (seconds converted to milliseconds for display)

## Example Event Supported
The component now correctly renders events like the provided example from zap.stream:
```json
{
  "kind": 30311,
  "tags": [
    ["d", "aa3811ce-b333-4b94-a4f8-8f0ee5a2c73a"],
    ["status", "ended"],
    ["starts", "1762362277"],
    ["ends", "1762364247"],
    ["title", "Nostria - Live Development"],
    ["summary", "Watch the live development of Nostria!"],
    ["thumb", "https://api-core.zap.stream/..."],
    ["t", "Nostr"],
    ["p", "...", "", "host"]
  ]
}
```

## Testing Recommendations
1. Test with live events (status: "live")
2. Test with planned events (status: "planned")
3. Test with ended events (status: "ended")
4. Test with/without thumbnails
5. Test with/without participant lists
6. Test in timeline and thread views
7. Test as reposts
8. Test streaming URL navigation

## Technical Notes
- All timestamps are in seconds (Nostr standard) and converted to milliseconds for Angular DatePipe
- Component uses Angular Material components for consistent UI
- Follows Nostria's architectural patterns (signals, computed properties)
- Uses standalone component architecture
- Integrates with existing hover card and profile display systems
