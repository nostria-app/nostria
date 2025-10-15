# Zero Relays Quick Setup Feature

## Overview

This feature provides a one-click setup solution for users who have zero account relays configured. It helps onboard new users by automatically setting up Nostria relays based on their geographic location and network latency.

## User Flow

### 1. Detection
When a user has zero account relays:
- The UI displays a prominent "Quick Setup with Nostria" button
- A friendly message explains that relays are essential for using Nostr
- Option to manually add relays is still available

### 2. Region Selection
When the user clicks "Quick Setup with Nostria":
1. The system pings all available Nostria relay regions:
   - Europe (`eu.nostria.app`)
   - North America (`us.nostria.app`)
   - Africa (`af.nostria.app`)

2. A dialog shows the latency results for each region
3. Results are sorted by latency (fastest first)
4. The fastest region is highlighted with a special badge

### 3. Automatic Configuration
When the user selects a region:
1. **Account Relay Setup**: Adds the first relay instance from that region to account relays
   - Example: `wss://ribo.eu.nostria.app`

2. **Discovery Relay Setup**: If the user goes from zero to having relays, the discovery relay is also updated
   - Example: `wss://discovery.eu.nostria.app`

3. **Relay List Publication**: The new relay list (kind 10002) is published to both:
   - The newly added account relay
   - The discovery relay

## Implementation Details

### Components Modified

#### `relays.component.ts`
- **New Computed Signal**: `hasZeroAccountRelays()` - Detects when user has no relays
- **New Signal**: `isSettingUpNostriaRelays` - Tracks setup process state
- **New Property**: `nostriaRelayRegions` - Defines available Nostria regions
- **New Method**: `setupNostriaRelays()` - Orchestrates the entire setup flow

### Logic Flow

```typescript
async setupNostriaRelays() {
  1. Get relay URLs for each Nostria region
  2. Ping all relays in parallel using Promise.allSettled()
  3. Sort results by latency
  4. Show dialog with results
  5. On user selection:
     - Add account relay (e.g., wss://ribo.eu.nostria.app)
     - Add discovery relay (e.g., wss://discovery.eu.nostria.app)
     - Publish relay list to network
}
```

### Discovery Relay Update

The feature includes special logic to automatically update the discovery relay when:
- User had zero account relays
- User adds a Nostria relay via quick setup
- The discovery relay doesn't already include the Nostria discovery relay for that region

This ensures:
- Better discoverability of the user's relay list by others
- Consistent relay infrastructure across account and discovery relays
- Optimal performance by using geographically close discovery relays

### UI/UX

#### Zero Relays State
```html
<div class="zero-relays-container">
  - Large "cloud_off" icon
  - Friendly heading and description
  - Prominent "Quick Setup with Nostria" button
  - Loading spinner during setup
  - Alternative option to add manually
</div>
```

#### Region Selection Dialog
Reuses the existing `RelayPingResultsDialogComponent`:
- Shows region name and relay URL
- Displays latency in milliseconds
- Highlights fastest region
- Allows user to select their preferred region

### Error Handling

1. **No Reachable Relays**: Shows message if all ping attempts fail
2. **Network Errors**: Catches and logs errors, shows user-friendly message
3. **Setup Failures**: Handles errors during relay addition and publication

## Technical Considerations

### Relay Selection Strategy
- Uses the first relay instance (`ribo`) from each region for consistency
- Each region has multiple relay instances for redundancy
- Future enhancement: Could ping multiple instances per region

### Latency Checking
- Uses WebSocket connection establishment time
- 5-second timeout per relay
- Runs checks in parallel for speed

### NIP-65 Compliance
- Publishes kind 10002 (Relay List Metadata) event
- Uses `r` tags for relay URLs
- Includes proper event signatures

### State Management
- Uses Angular signals for reactive updates
- Computed signal `hasZeroAccountRelays()` automatically tracks relay count
- UI updates automatically when relays are added

## Benefits

1. **Onboarding**: Drastically simplifies first-time setup
2. **Performance**: Automatically selects fastest relay region
3. **Consistency**: Ensures both account and discovery relays are configured
4. **User Experience**: One-click solution vs manual relay entry
5. **Reliability**: Uses established Nostria relay infrastructure

## Future Enhancements

1. **Multi-Relay Setup**: Add multiple relays from selected region for redundancy
2. **Custom Region Selection**: Allow advanced users to select specific relay instances
3. **Relay Health Monitoring**: Show real-time health status of Nostria relays
4. **Migration Assistant**: Help users migrate from other relay infrastructure
5. **Load Balancing**: Automatically distribute users across relay instances
