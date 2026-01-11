# Emoji Sets: Kind 10030 Support Implementation

## Overview

Added support for displaying user's preferred emojis (kind 10030) in the Emoji Sets page, along with a "Find Emojis" button to help users discover new emoji collections.

## Changes

### 1. CollectionSetsService Updates

Added new method to query kind 10030 events:

```typescript
async getPreferredEmojis(pubkey: string): Promise<string[]>
```

This method:
- Queries for kind 10030 events (user's preferred emojis)
- Extracts emoji characters from "emoji" tags
- Returns the most recent list of preferred emojis

### 2. EmojiSetsComponent Updates

#### TypeScript

- Added `Router` injection for navigation
- Added `preferredEmojis` signal to store kind 10030 emojis
- Updated `loadData()` to load both emoji sets and preferred emojis
- Added `findEmojis()` method to navigate to search with kind filter

#### HTML

- Added "My Emojis" section that displays when preferredEmojis has content
  - Uses `favorite` icon to distinguish from emoji collections
  - Shows emoji grid with all preferred emojis
  - Only visible if user has kind 10030 data

- Added "Find Emojis" button
  - Positioned next to "Create Collection" button
  - Uses `search` icon
  - Navigates to `/search?q=kind:30030` to find emoji sets

#### SCSS

- Added `.header-actions` style for button group layout
- Buttons spaced with 12px gap

## Nostr Protocol

### Kind 10030 - User Preferred Emojis

This kind represents a user's personal emoji list and can contain:
- `"emoji"` tags with direct emoji characters
- `"a"` tags referencing kind 30030 emoji sets

Example:
```json
{
  "kind": 10030,
  "tags": [
    ["emoji", "😀"],
    ["emoji", "🎉"],
    ["a", "30030:pubkey:identifier"]
  ]
}
```

### Kind 30030 - Emoji Sets

Represents categorized emoji collections:
- `"emoji"` tags with shortcode and image URL
- `"d"` tag for unique identifier
- `"name"` tag for collection name

## User Experience

1. **My Emojis Section**: Appears at the top of the page when user has kind 10030 data
2. **Emoji Collections**: Displays kind 30030 emoji sets below
3. **Find Emojis Button**: Helps users discover new emoji collections via search
4. **Create Collection**: Allows users to create their own kind 30030 sets

## Search Integration

The "Find Emojis" button navigates to:
```
/search?q=kind:30030
```

This allows users to discover emoji sets created by others in the Nostr network.
