# Following List Backup Implementation

## Overview
This document describes the implementation of automatic backup functionality for the user's following list (Nostr kind 3 events) in Nostria.

## Features Implemented

### 1. Automatic Backup Service (`FollowingBackupService`)
Located at: `src/app/services/following-backup.service.ts`

**Key Features:**
- Automatically backs up the following list whenever it changes (follow/unfollow actions)
- Stores up to 10 backup versions locally in browser storage
- Provides methods to restore (replace) or merge backup versions
- Prevents duplicate backups by comparing arrays before saving
- Uses local storage to persist backups across sessions

**Public Methods:**
- `getBackups()`: Returns all available backups
- `restoreBackup(backupId)`: Replaces current following list with a backup
- `mergeBackup(backupId)`: Combines a backup with the current following list
- `deleteBackup(backupId)`: Removes a specific backup
- `clearAllBackups()`: Removes all backups

**Automatic Backup Trigger:**
The service uses Angular's `effect()` to watch for changes in the following list and automatically creates backups when:
- A user follows someone new
- A user unfollows someone
- The following list is loaded or updated

### 2. History Dialog Component
Located at: `src/app/pages/backup/following-history-dialog/following-history-dialog.component.ts`

**Features:**
- Displays list of all available backups with timestamps
- Shows the number of accounts in each backup
- Provides actions menu for each backup:
  - **Restore**: Replaces the current following list with the backup
  - **Merge**: Combines the backup with the current list (no duplicates)
  - **Delete**: Removes the backup
- Clear All button to delete all backups at once
- Responsive design that works on mobile and desktop

### 3. Updated Backup Page
Located at: `src/app/pages/backup/backup.component.ts` and `.html`

**New Section Added:**
- "Following List History" section below the existing backup/restore cards
- Displays statistics:
  - Number of backups available
  - Current following count
- "View History" button to open the history dialog
- Button is disabled when no backups exist
- Visual design matches existing backup page style

## Technical Details

### Backup Data Structure
```typescript
interface FollowingBackup {
  id: string;              // Unique identifier (UUID)
  timestamp: number;       // Unix timestamp in milliseconds
  pubkeys: string[];       // Array of followed public keys
  event: Event;           // The original kind 3 Nostr event
}
```

### Storage
- Backups are stored in browser localStorage under key: `nostria-following-history`
- Maximum of 10 backups are kept (oldest are automatically removed)
- Storage is per-browser/per-device (backups do not sync across devices)

### Integration
- Service is injected in `app.ts` to ensure it's instantiated on application startup
- The `effect()` in the service constructor automatically triggers on following list changes
- No manual backup calls are needed - everything is automatic

## User Flow

### Viewing Backup History
1. Navigate to Settings → Backup
2. Scroll to "Following List History" section
3. Click "View History" button
4. See list of all backups with timestamps

### Restoring a Backup
1. Open the history dialog
2. Click the "Actions" menu on a backup
3. Select "Restore (Replace)"
4. The backup's following list will be published as a new kind 3 event
5. The current following list is updated to match the backup

### Merging a Backup
1. Open the history dialog
2. Click the "Actions" menu on a backup
3. Select "Merge (Combine)"
4. Both lists are combined (duplicates removed)
5. A new kind 3 event is published with the merged list

### Deleting a Backup
1. Open the history dialog
2. Click the "Actions" menu on a backup
3. Select "Delete"
4. The backup is removed from local storage

## Similarities to Memos Backup
This implementation follows the same pattern as the existing Memos backup:
- Automatic backups on every change
- Local storage for persistence
- Last 10 versions kept
- Restore and merge capabilities
- History dialog with similar UI

## Testing Considerations

### Manual Testing
1. **Backup Creation**: Follow/unfollow users and verify backups are created
2. **Restore**: Restore an old backup and verify the following list updates
3. **Merge**: Merge a backup and verify both lists are combined correctly
4. **Delete**: Delete a backup and verify it's removed
5. **Limit**: Create more than 10 backups and verify only the last 10 are kept

### Automated Testing
Unit tests have been created in `following-backup.service.spec.ts` to test:
- Service creation
- Getting backups from storage
- Handling invalid JSON
- Deleting backups
- Clearing all backups

## Files Modified/Created

### New Files
1. `src/app/services/following-backup.service.ts` - Main backup service
2. `src/app/services/following-backup.service.spec.ts` - Unit tests
3. `src/app/pages/backup/following-history-dialog/following-history-dialog.component.ts` - History dialog

### Modified Files
1. `src/app/pages/backup/backup.component.ts` - Added following backup integration
2. `src/app/pages/backup/backup.component.html` - Added following history section
3. `src/app/pages/backup/backup.component.scss` - Added new styles
4. `src/app/app.ts` - Injected service to enable automatic backups

## Screenshot
![Following List Backup UI](https://github.com/user-attachments/assets/0ce2f07e-1282-45b9-9463-b324d754e6cf)

The screenshot shows the new "Following List History" section on the backup page with:
- Statistics showing backup count and current following count
- View History button to access the backup management dialog
- Clean, Material Design 3 compatible styling

## Future Enhancements (Not Implemented)
- Export/import backups to files
- Sync backups across devices using Nostr events
- Schedule automatic backups at specific intervals
- Compare two backups to see differences
- Backup notes/labels for each version
