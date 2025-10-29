# Proof-of-Work Persistence and Auto-Mining Implementation

## Overview
Implemented persistent Proof-of-Work (PoW) settings per account and automatic mining when publishing notes.

## Changes Made

### 1. Account-Local State Service (`account-local-state.service.ts`)
Added per-account storage for PoW preferences:

- **New Properties in `AccountLocalState` Interface:**
  - `powEnabled?: boolean` - Whether PoW is enabled for the account
  - `powTargetDifficulty?: number` - Target difficulty for PoW mining (default: 20)

- **New Methods:**
  - `getPowEnabled(pubkey: string): boolean` - Get PoW enabled state
  - `setPowEnabled(pubkey: string, enabled: boolean): void` - Save PoW enabled state
  - `getPowTargetDifficulty(pubkey: string): number` - Get target difficulty (defaults to 20)
  - `setPowTargetDifficulty(pubkey: string, difficulty: number): void` - Save target difficulty

### 2. Note Editor Dialog (`note-editor-dialog.component.ts`)

#### Constructor Changes
- Loads PoW settings from account state on initialization
- Restores both `powEnabled` and `powTargetDifficulty` from the user's account-specific settings

#### PoW Toggle Method Updates
- `onPowToggle()` now persists the enabled state to account local storage
- `onPowDifficultyChange()` now persists the difficulty value to account local storage

#### Auto-Mining on Publish
Modified `publishNote()` method to automatically mine PoW before publishing:

1. **When PoW is Enabled:**
   - Checks if a mined event exists and matches current content
   - If no mined event or content changed, automatically starts mining
   - Shows snackbar notification: "Mining Proof-of-Work before publishing..."
   - Displays real-time progress in the dialog footer
   - Waits for mining to complete before signing and publishing
   - Handles mining failures gracefully

2. **Progress Display:**
   - Real-time progress updates via `PowProgress` callback
   - User can see mining progress without manually clicking "Generate Proof"

3. **Content Change Detection:**
   - Compares existing mined event content with current content
   - Automatically re-mines if content has changed since last mining operation

### 3. UI Changes (`note-editor-dialog.component.html`)

#### Dialog Footer Progress Indicator
Added a compact progress indicator to the left of the Cancel button:

```html
@if (powEnabled() && isPowMining()) {
<div class="pow-progress-indicator">
  <mat-icon class="pow-icon spinning">auto_awesome</mat-icon>
  <span class="pow-text">Mining PoW: {{ powDifficulty() }}/{{ powTargetDifficulty() }} bits</span>
</div>
}
```

- Shows only when PoW is enabled and actively mining
- Displays current vs target difficulty (e.g., "Mining PoW: 15/20 bits")
- Animated icon indicates active mining
- Auto-hides when mining completes

### 4. Styling (`note-editor-dialog.component.scss`)

#### New Dialog Actions Styles
```scss
.dialog-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0 0 0;
  flex-shrink: 0;

  .pow-progress-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    padding: 4px 12px;
    background-color: var(--mat-sys-primary-container);
    border-radius: 16px;
    color: var(--mat-sys-on-primary-container);
    // ...
  }
}
```

- Positioned to the left of Cancel button using `margin-right: auto`
- Styled as a compact pill with primary colors
- Spinning animation on the icon for visual feedback

## User Experience Flow

### First-Time Setup
1. User opens note editor
2. Expands Advanced Options
3. Toggles "Proof of Work" on
4. Sets desired difficulty (e.g., 20 bits)
5. Settings are automatically saved to account state

### Subsequent Usage
1. User opens note editor
2. PoW is already enabled (loaded from account state)
3. Difficulty is pre-set to saved value
4. User writes note and clicks "Publish Note"
5. **Automatic mining starts** (no manual "Generate Proof" click needed)
6. Progress indicator appears in footer showing: "Mining PoW: X/Y bits"
7. When mining completes, note is automatically signed and published
8. User is redirected to the published note

### Manual Pre-Mining (Optional)
Users can still manually generate proof in Advanced Options:
1. Click "Generate Proof" button in PoW section
2. Watch progress in the advanced section
3. When satisfied, click "Publish Note" (uses already-mined event)

## Technical Details

### State Persistence
- Stored in localStorage under the `nostria-state` key
- Organized by account pubkey: `nostria-state[pubkey].powEnabled`
- Persists across browser sessions
- Independent per account (multi-account support)

### Mining Logic
- Uses NIP-13 compliant PoW implementation
- Counts leading zero bits in event ID
- Non-blocking (yields to browser every 1000 attempts)
- Progress updates via reactive signals
- Graceful cancellation support

### Performance Considerations
- Mining runs asynchronously (doesn't block UI)
- Progress indicator provides feedback
- Content change detection prevents unnecessary re-mining
- Mining can be stopped at any time

## Benefits

1. **Convenience:** PoW settings persist, no need to toggle each time
2. **Seamless:** Automatic mining on publish, no extra clicks
3. **Transparent:** Clear progress indicator shows mining status
4. **Flexible:** Users can still manually pre-mine if desired
5. **Account-Specific:** Different PoW settings per account
6. **Smart:** Detects content changes and re-mines only when needed

## Example Usage Scenarios

### Scenario 1: Regular User with PoW
- Enables PoW once at difficulty 20
- Every subsequent note automatically includes PoW
- No additional user interaction needed
- Notes are naturally protected against spam

### Scenario 2: Multi-Account User
- Main account: PoW enabled at difficulty 20
- Alt account: PoW disabled (faster posting)
- Settings maintained independently per account

### Scenario 3: High-Priority Note
- User wants extra strong PoW for important announcement
- Increases difficulty to 25 temporarily
- Publishes note (automatically mines at 25)
- Next note still uses 25 until changed back

## Related Files
- `src/app/services/account-local-state.service.ts` - State persistence
- `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` - Main logic
- `src/app/components/note-editor-dialog/note-editor-dialog.component.html` - UI template
- `src/app/components/note-editor-dialog/note-editor-dialog.component.scss` - Styling
- `src/app/services/pow.service.ts` - PoW mining implementation (unchanged)
