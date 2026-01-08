# Feed Migration Guide

## Overview
This document describes the automatic migration from the old column-based feed structure to the new flat feed structure.

## What Changed

### Old Structure (Before Migration)
Feeds contained an array of columns, with each column having its own settings:

```typescript
{
  id: 'feed-1',
  label: 'My Feed',
  icon: 'rss_feed',
  columns: [
    {
      id: 'col-1',
      label: 'Notes',
      type: 'notes',
      kinds: [1],
      source: 'following',
      relayConfig: 'account',
      showReplies: false,
      showReposts: true
      // ... other column settings
    },
    {
      id: 'col-2',
      label: 'Articles',
      type: 'articles',
      kinds: [30023],
      // ... other column settings
    }
  ]
}
```

### New Structure (After Migration)
Feeds are now flat, with all settings at the feed level:

```typescript
{
  id: 'feed-1',
  label: 'My Feed',
  icon: 'rss_feed',
  type: 'notes',
  kinds: [1],
  source: 'following',
  relayConfig: 'account',
  showReplies: false,
  showReposts: true
  // ... all settings directly on feed
}
```

## Migration Process

### Automatic Migration
The migration happens automatically when you load the app:

1. **On Startup**: When feeds are loaded from localStorage, the migration function checks each feed
2. **Column Detection**: If a feed has a `columns` array, migration is triggered
3. **First Column Preservation**: The first column's settings are copied to the feed level
4. **Additional Columns**: If multiple columns exist, only the first is preserved (warning logged)
5. **Save to Storage**: Migrated feeds are automatically saved back to localStorage
6. **One-Time Process**: Once migrated and saved, the feed won't be migrated again

### Migration Logic

```typescript
migrateLegacyFeed(feed: FeedConfig): FeedConfig {
  // Has columns? Migrate first column to feed level
  if (feed.columns && feed.columns.length > 0) {
    return {
      ...feed,
      type: firstColumn.type,
      kinds: firstColumn.kinds,
      source: firstColumn.source,
      relayConfig: firstColumn.relayConfig,
      // ... all column settings copied to feed
      columns: undefined, // Remove columns array
      updatedAt: Date.now()
    };
  }
  
  // Already migrated or needs defaults
  return feed;
}
```

## What Happens to Multiple Columns?

### Important Data Loss Warning
⚠️ **If a feed had multiple columns, only the FIRST column's settings will be preserved.**

Example:
```typescript
// Before: Feed with 3 columns
{
  label: 'Mixed Content',
  columns: [
    { label: 'Notes', type: 'notes', kinds: [1] },      // ✅ PRESERVED
    { label: 'Articles', type: 'articles', kinds: [30023] }, // ❌ LOST
    { label: 'Photos', type: 'photos', kinds: [20] }    // ❌ LOST
  ]
}

// After: Only first column preserved
{
  label: 'Mixed Content',
  type: 'notes',
  kinds: [1]
  // Articles and Photos settings are lost
}
```

### Recommendation for Multi-Column Users
If you had feeds with multiple columns:

1. **Check Your Feeds**: Review your feeds after migration
2. **Create New Feeds**: Create separate feeds for content that was in additional columns
3. **Example**:
   - Old: "Mixed Content" feed with Notes, Articles, and Photos columns
   - New: Create 3 feeds:
     - "Notes" feed (migrated automatically)
     - "Articles" feed (create new)
     - "Photos" feed (create new)

## Migration Logging

The migration process logs important information:

### Info Messages
```
🔄 Migrating legacy feed "My Feed" (feed-id) from column-based to flat structure.
   Preserving settings from column: "Notes"
```

### Warning Messages
```
⚠️ Feed "My Feed" (feed-id) has 3 columns. Only the first column "Notes" will be preserved.
   Other columns will be lost. Consider creating separate feeds for different content types.
```

### Completion Message
```
✅ Migration completed for 5 feeds. Saving migrated feeds to storage.
```

## Default Feeds

The default feeds that come with the app are already in the new flat format:

- **For You**: Personalized content
- **Following**: Content from people you follow
- **Trending**: Popular content (always appended, never stored)

## Backward Compatibility

The system maintains backward compatibility:

1. **Old Data Still Works**: Old column-based feeds can still be loaded
2. **Automatic Conversion**: They're automatically migrated on first load
3. **One-Way Migration**: Once migrated, feeds stay in the new format
4. **No Manual Action Required**: Everything happens automatically

## Edge Cases Handled

### Missing Required Properties
If a feed lacks required properties (type, kinds, relayConfig), defaults are set:
```typescript
{
  type: feed.type || 'notes',
  kinds: feed.kinds || [1],
  source: feed.source || 'public',
  relayConfig: feed.relayConfig ?? 'account'
}
```

### Empty Columns Array
If a feed has `columns: []`, it's treated as needing defaults.

### Already Migrated Feeds
If a feed already has `type`, `kinds`, and `relayConfig`, it's left unchanged.

## Testing Migration

To test the migration with your existing data:

1. **Backup First**: Export your feeds if possible
2. **Load App**: The migration runs automatically on startup
3. **Check Console**: Look for migration log messages
4. **Verify Feeds**: Check that your feeds work correctly
5. **Recreate Lost Content**: If you had multiple columns, create new feeds for lost content

## Technical Details

### Migration Trigger
- **File**: `feed.service.ts`
- **Method**: `migrateLegacyFeed(feed: FeedConfig)`
- **Called From**: `loadFeeds(pubkey: string)`
- **Timing**: During app initialization when loading feeds from localStorage

### Properties Migrated
All column properties are copied to the feed level:
- `type`, `kinds`, `source`, `relayConfig` (required)
- `customUsers`, `customStarterPacks`, `customFollowSets`
- `searchQuery`, `customRelays`, `filters`
- `showReplies`, `showReposts`, `lastRetrieved`

### Storage Location
- **Key Format**: `nostria-feeds-${pubkey}`
- **Storage**: Browser localStorage
- **Format**: JSON array of FeedConfig objects

## Troubleshooting

### Feed Not Showing Content
If a migrated feed isn't working:
1. Check browser console for errors
2. Look for migration warnings about missing properties
3. Try deleting and recreating the feed
4. Check that kinds array is not empty

### Multiple Columns Lost
If you're missing content from additional columns:
1. Review migration warnings in console
2. Create new feeds for each content type
3. Configure each feed with the appropriate kinds

### Migration Keeps Running
If migration runs on every load:
1. Check browser console for save errors
2. Verify localStorage is not full
3. Check that feeds are being saved (`saveFeeds()` called)

## Future Improvements

Potential enhancements to consider:
- Export/import functionality for feeds before migration
- UI warning before migration that explains data loss
- Option to auto-create separate feeds from multi-column feeds
- Migration history tracking
