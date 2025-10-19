# Proof-of-Work Event Indicator

## Overview

This document describes the implementation of a visual indicator for Proof-of-Work (PoW) on event cards. The indicator shows when a note has PoW and displays the difficulty strength.

## Implementation Date

October 19, 2025

## Location

The PoW indicator appears in the event card footer, positioned before the "Published with" client tag indicator.

## Features

### 1. Visual Indicator

The PoW indicator displays:
- **Icon**: A "verified" Material icon (checkmark in a shield)
- **Difficulty Number**: The actual number of leading zero bits achieved
- **Color Coding**: 
  - Default color for difficulty < 20 bits
  - Primary color (highlighted) for difficulty ≥ 20 bits

### 2. Strength Labels

The system categorizes PoW strength into levels:
- **Minimal**: 0-9 bits
- **Low**: 10-14 bits
- **Moderate**: 15-19 bits
- **Strong**: 20-24 bits (highlighted in UI)
- **Very Strong**: 25-29 bits (highlighted in UI)
- **Extreme**: 30+ bits (highlighted in UI)

### 3. Tooltip Information

Hovering over the PoW indicator shows:
- Actual difficulty achieved (number of leading zero bits)
- Strength label (e.g., "Strong", "Moderate")
- Target difficulty committed in the nonce tag (if different)

Example tooltip:
```
Proof-of-Work: 23 bits (Strong)
Target: 20 bits
```

## Implementation Details

### TypeScript Component (`event.component.ts`)

#### New Dependencies
```typescript
import { PowService } from '../../services/pow.service';
```

#### New Methods

**`hasProofOfWork(event)`**
- Checks if an event has a `nonce` tag
- Returns `boolean`

**`getProofOfWorkDifficulty(event)`**
- Calculates the actual difficulty by counting leading zero bits in the event ID
- Returns `number` (difficulty in bits)

**`getCommittedDifficulty(event)`**
- Extracts the committed target difficulty from the nonce tag
- Returns `number` (committed difficulty in bits)

**`getProofOfWorkLabel(difficulty)`**
- Converts numeric difficulty to human-readable strength label
- Returns `string` (e.g., "Strong", "Moderate")

**`getProofOfWorkTooltip(event)`**
- Generates the tooltip text with difficulty and strength information
- Shows target difficulty if it differs from achieved difficulty
- Returns `string`

### HTML Template (`event.component.html`)

The indicator is conditionally rendered in the card actions section:

```html
@if (hasProofOfWork(targetItem.event)) {
<div class="note-footer-right hide-small pow-indicator"
  [matTooltip]="getProofOfWorkTooltip(targetItem.event)"
  matTooltipPosition="below">
  <mat-icon [class.pow-strong]="getProofOfWorkDifficulty(targetItem.event) >= 20">verified</mat-icon>
  <span class="pow-difficulty">{{ getProofOfWorkDifficulty(targetItem.event) }}</span>
</div>
}
```

### CSS Styling (`event.component.scss`)

```scss
.pow-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  opacity: 0.7;
  font-size: 12px;
  font-weight: 500;
  border-radius: 12px;
  background-color: var(--mat-sys-surface-variant);
  transition: opacity 0.2s ease-in-out;

  &:hover {
    opacity: 1;
  }

  mat-icon {
    font-size: 16px;
    width: 16px;
    height: 16px;
    color: var(--mat-sys-tertiary);

    &.pow-strong {
      color: var(--mat-sys-primary);
    }
  }

  .pow-difficulty {
    color: var(--mat-sys-on-surface-variant);
    font-size: 11px;
    font-weight: 600;
  }
}
```

## User Experience

### Visual Design
- **Subtle but noticeable**: The indicator has reduced opacity (0.7) to not distract from content
- **Interactive feedback**: Opacity increases to 1.0 on hover
- **Highlighted strong PoW**: Difficulty ≥ 20 bits shows the icon in primary color
- **Pill shape**: Rounded background makes it distinct from other elements
- **Compact**: Small size doesn't take much space in the footer

### Responsive Behavior
- Uses `hide-small` class to hide on mobile devices (like other footer metadata)
- Maintains consistent spacing with other footer elements

### Placement
The indicator appears in this order in the event card footer:
1. Reaction buttons (like, reply, repost, zap)
2. **PoW Indicator** ← New
3. Client tag indicator (e.g., "Published with Nostria")
4. Bookmark button

## Technical Considerations

### Performance
- Uses the existing `PowService.countLeadingZeroBits()` method
- Minimal computational overhead (simple bit counting)
- No network requests required

### Validation
- Checks for presence of `nonce` tag before displaying
- Calculates actual difficulty from event ID
- Compares with committed difficulty in nonce tag

### Accessibility
- Material Design icon provides visual recognition
- Tooltip provides detailed text information
- Sufficient color contrast for visibility

## Examples

### Moderate PoW (17 bits)
```
Icon: verified (tertiary color)
Number: 17
Tooltip: "Proof-of-Work: 17 bits (Moderate)"
```

### Strong PoW (23 bits)
```
Icon: verified (primary color - highlighted)
Number: 23
Tooltip: "Proof-of-Work: 23 bits (Strong)"
```

### Exceeded Target (achieved 25, target 20)
```
Icon: verified (primary color - highlighted)
Number: 25
Tooltip: "Proof-of-Work: 25 bits (Very Strong)\nTarget: 20 bits"
```

## Future Enhancements

Potential improvements:
1. **Color gradients**: Different colors for different strength levels
2. **Animation**: Subtle pulse or glow for extreme PoW
3. **Statistics**: Show average mining time or attempts
4. **Leaderboard**: Highlight highest PoW in feed
5. **Settings**: Allow users to toggle PoW indicator visibility
6. **Mobile**: Consider showing on mobile with different styling

## Related Files

- `src/app/components/event/event.component.ts` - Component logic
- `src/app/components/event/event.component.html` - Template
- `src/app/components/event/event.component.scss` - Styling
- `src/app/services/pow.service.ts` - PoW calculation service

## References

- [NIP-13: Proof of Work](https://github.com/nostr-protocol/nips/blob/master/13.md)
- [PROOF_OF_WORK_IMPLEMENTATION.md](./PROOF_OF_WORK_IMPLEMENTATION.md)
- [POW_TIMESTAMP_FIX.md](./POW_TIMESTAMP_FIX.md)
