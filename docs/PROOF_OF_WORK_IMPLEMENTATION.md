# Proof-of-Work (PoW) Implementation

## Overview

This document describes the implementation of Proof-of-Work (PoW) functionality for Nostr notes in Nostria, following the NIP-13 specification. PoW adds computational proof to notes as a spam deterrence mechanism.

## Implementation Date

October 19, 2025

## NIP-13 Specification

NIP-13 defines a way to generate and interpret Proof of Work for Nostr notes. The "difficulty" is defined as the number of leading zero bits in the NIP-01 event ID. For example, an id starting with `000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d` has a difficulty of 36 with 36 leading 0 bits.

### Mining Process

To generate PoW for a note, a `nonce` tag is used:

```json
["nonce", "776797", "20"]
```

Where:
- First element: tag name "nonce"
- Second element: the nonce value (incremented during mining)
- Third element: target difficulty commitment

During mining:
1. The nonce value is incremented
2. The event ID is recalculated
3. Leading zero bits are counted
4. Process repeats until target difficulty is achieved

## Components

### 1. PowService (`src/app/services/pow.service.ts`)

A dedicated Angular service that handles all PoW-related operations.

#### Key Features:
- **Mining Algorithm**: Implements the NIP-13 mining algorithm with nonce iteration
- **Difficulty Calculation**: Counts leading zero bits in hexadecimal event IDs
- **Progress Tracking**: Reactive signals for real-time mining progress
- **Pause/Stop Control**: Ability to stop mining and keep the best result
- **Validation**: Validates PoW for events with committed difficulty

#### Key Methods:
- `mineEvent(baseEvent, targetDifficulty, onProgress)`: Mines an event to achieve target difficulty
- `countLeadingZeroBits(hex)`: Counts leading zero bits in a hex string
- `validatePow(event, expectedDifficulty)`: Validates an event's PoW
- `stop()`: Stops the mining process
- `reset()`: Resets all progress state

#### Signals:
- `progress`: Contains current mining state (difficulty, nonce, attempts, isRunning, bestEvent)

### 2. Note Editor Dialog Integration

The note editor dialog now includes PoW functionality in the Advanced Options section.

#### UI Components:
1. **PoW Toggle**: Enable/disable PoW for the note
2. **Difficulty Selector**: Number input for target difficulty (1-40 bits, recommended 20-25)
3. **Mining Controls**:
   - "Generate Proof" button to start mining
   - "Stop Mining" button to pause/stop
   - "Reset & Mine Again" button after completion
4. **Progress Display**:
   - Current difficulty achieved
   - Number of attempts
   - Progress bar showing percentage to target
   - Success indicator when ready

#### Implementation Details:

##### New Signals:
```typescript
powEnabled = signal(false);
powTargetDifficulty = signal(20);
powProgress = signal<PowProgress>(...);
powMinedEvent = signal<UnsignedEvent | null>(null);
```

##### New Computed Properties:
```typescript
isPowMining = computed(() => this.powProgress().isRunning);
hasPowResult = computed(() => this.powMinedEvent() !== null);
powDifficulty = computed(() => this.powProgress().difficulty);
powProgressPercentage = computed(() => ...);
```

##### Mining Flow:
1. User enables PoW in advanced options
2. User sets target difficulty (default 20 bits)
3. User clicks "Generate Proof"
4. Service creates base event and starts mining
5. Progress updates in real-time
6. User can stop mining at any time
7. Best result is saved and used for publishing
8. When publishing, mined event (with nonce tag) is used instead of base event

## User Experience

### Mining Process:
1. Open note editor dialog
2. Expand "Advanced Options"
3. Enable "Proof of Work" toggle
4. Set desired difficulty (20-25 recommended)
5. Click "Generate Proof"
6. Watch progress bar and difficulty counter
7. Either wait for target or stop when satisfied
8. Click "Publish Note" to publish with PoW

### Visual Feedback:
- Real-time difficulty counter
- Attempt counter with locale formatting (e.g., "1,234,567")
- Progress bar showing percentage to target
- Success indicator when mining complete
- Snackbar notifications for events

## Technical Considerations

### Performance:
- Mining yields to browser event loop every 1000 attempts
- Prevents UI blocking during intensive computation
- Uses `AbortController` for cancellation
- Each difficulty bit doubles the average time required

### Difficulty Guidelines:
- **1-10 bits**: Very easy, minimal spam protection
- **15-20 bits**: Moderate, good balance for most use cases
- **20-25 bits**: Strong protection (recommended)
- **25-30 bits**: Very strong, may take significant time
- **30+ bits**: Extremely difficult, can take hours

### Event Structure:
When PoW is enabled, the published event includes:
```json
{
  "tags": [
    ["nonce", "1234567", "20"],
    // ... other tags
  ]
}
```

## Security Considerations

1. **Committed Difficulty**: The nonce tag includes the target difficulty to prevent bulk spammers from getting lucky with lower difficulties
2. **Validation**: Relays and clients can validate PoW by checking both actual and committed difficulty
3. **No Private Key Risk**: Mining happens before signing, using the unsigned event

## Future Enhancements

Potential improvements for future versions:
1. **Web Workers**: Move mining to background thread for better performance
2. **Difficulty Presets**: Quick-select buttons for common difficulty levels
3. **Time Estimates**: Predict mining time based on device performance
4. **Mining History**: Save and display PoW statistics
5. **Delegated PoW**: Support for outsourcing PoW to providers (NIP-13 spec)

## Testing

Manual testing should verify:
- Mining starts and progresses correctly
- Progress updates in real-time
- Stop button works and preserves best result
- Reset clears state properly
- Mined event publishes successfully
- Event includes correct nonce tag with difficulty commitment
- Different difficulty levels produce appropriate results
- Publishing works with all account types (extension, nsec, remote)

## Known Issues & Fixes

### Timestamp Preservation Issue (Fixed)
**Problem**: When signing a mined event using a browser extension or other signing methods, the `created_at` timestamp was being overwritten with the current time. This invalidated the proof-of-work since the event ID depends on the timestamp.

**Solution**: Modified the `NostrService.sign()` method to preserve the `created_at` timestamp from the event if it already exists, using `event.created_at ?? this.currentDate()`. This ensures that mined events keep their original timestamp, maintaining the validity of the proof-of-work.

**Files Modified**:
- `src/app/services/nostr.service.ts` - Updated all signing methods (extension, remote, nsec) to preserve timestamp

## References

- [NIP-13: Proof of Work](https://github.com/nostr-protocol/nips/blob/master/13.md)
- [NIP-01: Basic protocol flow description](https://github.com/nostr-protocol/nips/blob/master/01.md)
