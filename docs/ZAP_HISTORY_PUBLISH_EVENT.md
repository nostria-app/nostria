# Zap History - Publish Event Feature

## Overview
Added a "Publish Event" option to the context menu in zap history that allows users to republish received zap events to their own relays.

## Purpose
This feature enables users to create backup copies of received zap events on their own relays, ensuring they have a persistent record even if the original relay becomes unavailable.

## Implementation Details

### Changes Made

#### 1. Component Updates (`zap-history.component.ts`)
- **Imported Services**: Added `AccountRelayService` to access relay functionality
- **New Method**: `publishEvent(zap: ZapHistoryEntry)`
  - Retrieves user's relay list via `accountRelay.getRelayUrls()`
  - Publishes the zap receipt event to all user relays using `accountRelay.publishToRelay()`
  - Provides user feedback via snackbar notifications

#### 2. Template Updates
- Added "Publish Event" menu item to all three tabs:
  - **All Zaps** tab
  - **Sent** tab  
  - **Received** tab
- Each menu includes both:
  - Copy Event Data (existing)
  - Publish Event (new)

### User Experience

1. User opens zap history page
2. User clicks the three-dot menu (⋮) on any zap entry
3. User selects "Publish Event" from the context menu
4. System publishes the zap receipt to all configured relays
5. Success/error feedback displayed via snackbar

### Technical Notes

- Uses existing `AccountRelayService.publishToRelay()` method
- Publishes complete zap receipt event (kind 9735) as-is
- No modification to event data - maintains signature integrity
- Publishes to all relays configured for the current account
- Error handling includes:
  - No account available
  - No relays configured
  - Publishing failures

### Related NIP
- **NIP-57**: Zaps (Lightning Zaps)
  - kind 9735: Zap receipts

## Benefits

1. **Backup**: Creates redundant copies of zap events on user's preferred relays
2. **Availability**: Ensures zap history remains accessible even if original relay goes offline
3. **Control**: Gives users control over where their zap data is stored
4. **Simplicity**: One-click operation to republish events

## Future Enhancements

Potential improvements could include:
- Batch republish option for multiple zaps
- Selective relay targeting (choose which relays to publish to)
- Visual indicator showing which relays already have the event
- Auto-republish option for newly received zaps
