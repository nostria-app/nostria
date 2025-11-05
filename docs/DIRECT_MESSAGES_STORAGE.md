# Direct Messages Storage Implementation

## Overview

This document describes the implementation of persistent storage for direct messages in Nostria. The system stores decrypted messages in IndexedDB to avoid repeated expensive decryption operations and provides efficient querying and management capabilities.

## Architecture

### Database Schema

A new `messages` table has been added to the IndexedDB schema (version 9) with the following structure:

```typescript
interface StoredDirectMessage {
  id: string; // composite key: accountPubkey::chatId::messageId
  accountPubkey: string; // The pubkey of the account that owns this message
  chatId: string; // The chat ID (format: otherPubkey-nip04 or otherPubkey-nip44)
  messageId: string; // The original event ID
  pubkey: string; // The author's pubkey
  created_at: number; // Timestamp in seconds
  content: string; // Decrypted message content
  isOutgoing: boolean; // Whether this is an outgoing message
  tags: string[][]; // Original event tags
  encryptionType: 'nip04' | 'nip44'; // Which encryption was used
  read: boolean; // Whether the message has been read
  received: boolean; // Whether the message was successfully received
  pending?: boolean; // Whether the message is still being sent
  failed?: boolean; // Whether the message failed to send
}
```

### Indexes

The messages table includes the following indexes for efficient querying:

- `by-account-chat`: Composite index on `[accountPubkey, chatId]` for fetching all messages in a specific chat
- `by-created`: Index on `created_at` for sorting messages by timestamp
- `by-account`: Index on `accountPubkey` for account-wide operations
- `by-chat`: Index on `chatId` for chat-wide operations

## Storage Service Methods

### Core Operations

#### `saveDirectMessage(message: StoredDirectMessage): Promise<void>`
Saves a single direct message to the database.

#### `saveDirectMessages(messages: StoredDirectMessage[]): Promise<void>`
Saves multiple direct messages in a single batch transaction for better performance.

#### `getMessagesForChat(accountPubkey: string, chatId: string): Promise<StoredDirectMessage[]>`
Retrieves all messages for a specific chat, sorted by timestamp (oldest first).

#### `getChatsForAccount(accountPubkey: string): Promise<ChatSummary[]>`
Gets a summary of all chats for an account, including message counts, last message time, and unread counts.

### Read Status Management

#### `markMessageAsRead(accountPubkey: string, chatId: string, messageId: string): Promise<void>`
Marks a single message as read.

#### `markChatAsRead(accountPubkey: string, chatId: string): Promise<void>`
Marks all unread messages in a chat as read.

### Deletion

#### `deleteDirectMessage(accountPubkey: string, chatId: string, messageId: string): Promise<void>`
Deletes a specific message.

#### `deleteChat(accountPubkey: string, chatId: string): Promise<void>`
Deletes all messages in a specific chat.

#### `deleteAllMessagesForAccount(accountPubkey: string): Promise<void>`
Deletes all messages for an account (useful during account removal).

### Utility Methods

#### `getMostRecentMessageTimestamp(accountPubkey: string): Promise<number>`
Returns the timestamp of the most recent message for pagination purposes.

#### `messageExists(accountPubkey: string, chatId: string, messageId: string): Promise<boolean>`
Checks if a message already exists in the database to avoid duplicates.

## Account Local State

### Messages Last Check Timestamp

The `AccountLocalStateService` has been extended to track when messages were last retrieved for each account:

```typescript
interface AccountLocalState {
  // ... other properties
  messagesLastCheck?: number; // Timestamp in seconds
}
```

### Methods

#### `getMessagesLastCheck(pubkey: string): number`
Gets the timestamp of the last message check for an account. Returns 0 if never checked.

#### `setMessagesLastCheck(pubkey: string, timestamp: number): void`
Updates the timestamp of the last message check for an account.

## Integration with MessagingService

The `MessagingService` should be updated to:

1. **On Load**: 
   - Check `getMessagesLastCheck()` for the current account
   - Load messages from IndexedDB first for instant display
   - Query relays for new messages since the last check timestamp
   - Decrypt and save new messages to the database
   - Update the last check timestamp

2. **On New Message**:
   - Decrypt the message
   - Save to database using `saveDirectMessage()`
   - Update the in-memory chat map

3. **On Message Send**:
   - Save the outgoing message to database with `pending: true`
   - Update status after confirmation
   - Update `messagesLastCheck` timestamp

4. **On Chat Open**:
   - Load messages from database
   - Mark messages as read using `markChatAsRead()`

## Benefits

1. **Performance**: Messages are decrypted once and stored, avoiding repeated expensive decryption operations
2. **Offline Support**: Users can view their message history even when offline
3. **Instant Loading**: Messages appear immediately from local storage while new messages sync in the background
4. **Efficient Syncing**: Only new messages since the last check are fetched from relays
5. **Read Receipts**: Track which messages have been read per account
6. **Better UX**: Pagination support through timestamp tracking

## Migration Considerations

- The database schema upgrade from version 8 to 9 is automatic
- Existing users will have an empty messages table initially
- First load will fetch and store all available messages
- Subsequent loads will only fetch new messages

## Storage Considerations

- Messages are stored per account to support multi-account usage
- Chat IDs include encryption type (nip04 vs nip44) to keep separate message threads
- The composite key format ensures uniqueness across accounts and chats
- IndexedDB quota limits apply (typically several hundred MB to GBs depending on browser)

## Future Enhancements

Potential improvements for future versions:

1. **Message Cleanup**: Implement automatic deletion of old messages to manage storage
2. **Export/Import**: Allow users to export and import their message history
3. **Search**: Add full-text search across stored messages
4. **Media Caching**: Store decrypted media content locally
5. **Sync Status**: Track sync status per chat to show loading indicators
6. **Conflict Resolution**: Handle cases where messages arrive out of order
