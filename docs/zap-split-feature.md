# Zap Split Feature

## Overview
The Zap Split feature allows users to configure how zaps (Lightning Network payments) are split between the original author and the quoter when someone zaps a quoted note.

## Implementation Details

### NIP-57 Compliance
This feature implements NIP-57 Appendix G, which specifies how to add zap split tags to events:

```jsonc
{
    "tags": [
        [ "zap", "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2", "wss://nostr.oxtr.dev", "90" ],  // 90% to original author
        [ "zap", "fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52", "", "10" ]   // 10% to quoter
    ]
}
```

### User Interface
- **Location**: Advanced Options section in the Note Editor Dialog
- **Availability**: Only shown when quoting another note
- **Components**:
  - Toggle switch to enable/disable zap splitting
  - Two sliders for configuring the split percentages
  - Real-time percentage display for both recipients

### Default Configuration
- **Original Author**: 90%
- **Quoter**: 10%
- The sliders are linked - adjusting one automatically updates the other to maintain 100% total

### How It Works
1. User clicks "Quote" on a note
2. Note editor dialog opens with the quote context
3. User opens "Advanced Options"
4. User enables "Enable Zap Split" toggle
5. User adjusts the split percentages using the sliders
6. When the quote is published, zap tags are added to the event
7. When someone zaps the quote, wallets that support NIP-57 Appendix G will automatically split the zap according to the configured percentages

### Tag Format
The implementation adds zap tags in the following format:
- `["zap", "<pubkey>", "<relay>", "<weight>"]`

Where:
- `pubkey`: The recipient's public key
- `relay`: The relay URL (optional, can be empty)
- `weight`: The weight/percentage for this recipient

### Code Changes
1. **NoteEditorDialogComponent** (`note-editor-dialog.component.ts`):
   - Added signals for zap split state management
   - Added methods to handle slider changes
   - Modified `buildTags()` to add zap tags when enabled

2. **Template** (`note-editor-dialog.component.html`):
   - Added UI components in the Advanced Options section

3. **Styles** (`note-editor-dialog.component.scss`):
   - Added styling for the zap split sliders

## User Benefits
- **Incentivizes Quality Quotes**: Quoters can earn a portion of zaps while still rewarding the original author
- **Transparent**: Clear UI showing exactly how zaps will be split
- **Fair Default**: 90/10 split ensures original authors receive the majority of zaps
- **Flexible**: Users can adjust the split to any ratio they prefer
