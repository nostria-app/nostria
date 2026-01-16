# NIP-17 Reply Support Implementation

## Overview

This document describes the implementation of reply support for Direct Messages (DMs) in Nostria, following the NIP-17 specification.

## NIP-17 Specification

According to NIP-17, replies in direct messages are denoted by an `e` tag that references the event ID of the message being replied to:

```jsonc
{
  "id": "<usual hash>",
  "pubkey": "<sender-pubkey>",
  "created_at": "<current-time>",
  "kind": 14,
  "tags": [
    ["p", "<receiver-pubkey>", "<relay-url>"],
    ["e", "<kind-14-id>", "<relay-url>"] // if this is a reply
  ],
  "content": "<message-in-plain-text>",
}
```

## Implementation Details

### 1. Data Model Changes

Added `replyTo` field to the `DirectMessage` interface:

```typescript
interface DirectMessage {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  isOutgoing: boolean;
  tags: string[][];
  pending?: boolean;
  failed?: boolean;
  received?: boolean;
  read?: boolean;
  encryptionType?: 'nip04' | 'nip44';
  replyTo?: string; // The event ID this message is replying to (from 'e' tag)
}
```

### 2. Backend Changes

#### Messaging Service (`messaging.service.ts`)

- **Added helper method** `getReplyToFromTags(tags: string[][]): string | undefined`
  - Extracts the reply-to message ID from event tags
  - Looks for the first 'e' tag and returns its value

- **Updated all DirectMessage creations** to include the `replyTo` field by calling `getReplyToFromTags()` on the message tags

### 3. UI Components

#### Messages Component (`messages.component.ts`)

Added new signals and methods:

```typescript
// Track which message is being replied to
replyingToMessage = signal<DirectMessage | null>(null);

// Set a message to reply to
setReplyTo(message: DirectMessage): void

// Clear the reply context
clearReply(): void

// Get a message by ID for displaying reply context
getMessageById(messageId: string): DirectMessage | undefined
```

Updated message sending methods:

- `sendNip44Message()` - Adds 'e' tag when replying to a message
- `sendNip04Message()` - Adds 'e' tag when replying to a message (for backward compatibility)

### 4. UI Features

#### Reply Context Display

Messages that are replies show a subtle reply context above the message content, displaying:
- Reply icon
- Preview of the original message being replied to

#### Reply Preview Bar

When replying, a preview bar appears above the message input showing:
- Reply icon
- Preview of the message being replied to
- Cancel button to clear the reply

#### Reply Button

On message hover, a reply button appears that:
- Allows users to select a message to reply to
- Sets the reply context
- Focuses the message input

### 5. Styling

Added comprehensive CSS styles for:
- Reply context inside message bubbles
- Reply preview bar above input
- Reply button on hover
- Support for both light and dark modes
- Glass morphism effects consistent with the app's design

## User Flow

1. User hovers over a message
2. Reply button appears
3. User clicks reply button
4. Reply preview shows above input with the selected message
5. User types their reply
6. User sends the message
7. The sent message includes an 'e' tag referencing the original message
8. When displayed, the reply shows the context of the original message

## Technical Notes

- The implementation works with both NIP-44 (modern) and NIP-04 (legacy) encryption
- Reply context is preserved when switching between chats
- Reply context is cleared when sending a message or switching to a different chat
- The 'e' tag is added to the unsigned rumor (kind 14) before encryption, following NIP-17 spec

## Testing

Added unit tests for the `getReplyToFromTags()` method to ensure:
- Correct extraction of reply-to ID from tags
- Handling of missing 'e' tags
- Handling of multiple tags

## Future Enhancements

Potential improvements for future iterations:
- Scroll to original message when clicking on reply context
- Support for multiple levels of threading (though NIP-17 only supports direct replies)
- Quote replies with content
- Visual indicators for messages that have replies
