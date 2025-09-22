# Observed Relays Feature Implementation

This document describes the implementation of the Observed Relays feature as requested in the issue.

## Overview

The Observed Relays feature adds the ability to track relay statistics and maintain a mapping between public keys and relay URLs discovered from relay hints in events. This helps users discover relays and provides fallback options when a user's relays are not easily discoverable using the Discovery Relay and their NIP-65 relay lists.

## Components Implemented

### 1. IndexedDB Storage Extensions

#### New Tables Added:

- **observedRelays**: Stores relay statistics and information
  - Primary key: `url` (relay URL)
  - Fields: connection status, events received, connection attempts, timestamps
  - Indexes: by last updated, first observed, events received, connection status

- **pubkeyRelayMappings**: Stores mappings between pubkeys and relay URLs
  - Primary key: `id` (composite: pubkey::relayUrl)  
  - Fields: pubkey, relayUrl, source, timestamps, event count
  - Indexes: by pubkey, relay URL, last seen, source

#### Methods Added to StorageService:
- `saveObservedRelay()` / `getObservedRelay()` / `getAllObservedRelays()`
- `savePubkeyRelayMapping()` / `getPubkeyRelayMapping()`
- `getRelayUrlsForPubkey()` / `getPubkeysForRelay()`
- `updatePubkeyRelayMappingFromHint()`
- `cleanupOldPubkeyRelayMappings()`

### 2. RelaysService Enhancements

#### New Features:
- Persist relay statistics to IndexedDB automatically
- Load observed relays on initialization
- Add relay hints from event parsing
- Get fallback relays for a pubkey
- Enhanced relay performance scoring

#### Methods Added:
- `addRelayHintsFromEvent()` - Process relay hints from events
- `getFallbackRelaysForPubkey()` - Get discovered relays for a user
- `getAllObservedRelays()` / `getObservedRelaysSorted()` - Get observed relays
- `loadObservedRelays()` - Refresh observed relays from storage

### 3. Event Processing Integration

#### DataService Modifications:
- Added automatic relay hint processing when events are saved
- Process e-tags to extract relay URLs and associated pubkeys
- Skip kind 10002 events (user relay lists) to avoid duplication
- Store hints for both event creators and mentioned authors

#### Event Processing Flow:
1. When an event is saved from relays (not from local storage)
2. Extract relay hints from e-tags (3rd element in e-tag arrays)
3. Extract author pubkeys from e-tags (5th element in e-tag arrays)
4. Create/update pubkey-relay mappings for discovered hints
5. Update relay statistics in both memory and IndexedDB

### 4. UI Implementation

#### New "Observed Relays" Tab:
- Added to the Relays settings page alongside "Account Relays" and "Discovery Relays"
- Displays all observed relays with detailed statistics
- Shows performance scores, connection status, event counts
- Sortable by last updated, events received, or first observed
- Actions: view relay info, delete observed relay data

#### Features:
- **Performance Scoring**: Visual badges showing relay reliability (0-100%)
- **Connection Status**: Icons showing connected/offline/disconnected state
- **Statistics Display**: Events received, connection attempts, timestamps
- **Responsive Design**: Mobile-friendly layout with grid adjustments
- **Data Management**: Clear all data button with confirmation

#### Styling:
- Performance badges with color coding (excellent/good/fair/poor)
- Grid layout for relay information and statistics
- Mobile responsive design with collapsible layouts
- Consistent with existing Angular Material design

## Data Flow

### Relay Hint Collection:
1. Events received from relays → DataService.processEventForRelayHints()
2. Extract relay URLs from e-tags → RelaysService.addRelayHintsFromEvent()  
3. Update pubkey-relay mappings → StorageService.updatePubkeyRelayMappingFromHint()
4. Update relay statistics → StorageService.saveObservedRelay()

### Fallback Relay Discovery:
1. User relay discovery fails → DataService.getUserRelays()
2. Check fallback mappings → RelaysService.getFallbackRelaysForPubkey()
3. Return discovered relay URLs → StorageService.getRelayUrlsForPubkey()

### UI Updates:
1. Relay statistics change → RelaysService.updateSignals()
2. UI reactively updates → observedRelaysSignal computed property
3. User interactions → StorageService methods → Signal updates

## Configuration

- **Database Version**: Incremented to version 2 to include new object stores
- **Cleanup**: Old pubkey-relay mappings can be cleaned up (default: 30 days)
- **Exclusions**: Kind 10002 events (relay lists) are excluded from mapping storage
- **Sources**: Mappings are tagged with source ('hint', 'user_list', 'discovery')

## Benefits

1. **Better Relay Discovery**: Helps discover relays for users even when their relay lists aren't available
2. **Fallback Mechanism**: Provides alternative relays when primary discovery methods fail
3. **Network Intelligence**: Builds knowledge of relay usage patterns across the network
4. **Performance Insights**: Users can see which relays perform well
5. **Data Persistence**: All relay statistics survive app restarts
6. **Privacy Friendly**: Only stores relay hints already present in public events

## Usage

Once implemented, the feature works automatically:

1. **Background Collection**: Relay hints are collected automatically as events are processed
2. **UI Access**: Users can view observed relays in Settings > Relays > "Observed Relays" tab
3. **Fallback Discovery**: The system automatically uses fallback relays when needed
4. **Performance Monitoring**: Users can see real-time relay performance and statistics

The feature is designed to be unobtrusive and provide value without requiring user configuration.