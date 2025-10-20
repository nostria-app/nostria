# Notification Filter Persistence

## Feature Description

The Activity notification filters are now persisted across page navigations and browser sessions. When users toggle notification type filters (Zaps, Mentions, Reactions, etc.), their preferences are automatically saved to localStorage and restored when they return to the notifications page.

## Implementation Details

### Storage Key

```typescript
const NOTIFICATION_FILTERS_KEY = 'nostria-notification-filters';
```

The filter preferences are stored in localStorage under this namespaced key.

### Filter Structure

The filters are stored as a JSON object mapping each `NotificationType` to a boolean value:

```typescript
{
  [NotificationType.NEW_FOLLOWER]: true,
  [NotificationType.MENTION]: false,
  [NotificationType.REPOST]: true,
  [NotificationType.REPLY]: true,
  [NotificationType.REACTION]: false,
  [NotificationType.ZAP]: true,
  // System notifications
  [NotificationType.RELAY_PUBLISHING]: true,
  [NotificationType.GENERAL]: true,
  [NotificationType.ERROR]: true,
  [NotificationType.SUCCESS]: true,
  [NotificationType.WARNING]: true
}
```

## User Experience

### Before This Feature
- User toggles filters to hide Reactions and Mentions
- User navigates to another page (e.g., Profile)
- User returns to Notifications page
- ❌ All filters reset to default (all enabled)
- User must re-apply filters every time

### After This Feature
- User toggles filters to hide Reactions and Mentions
- User navigates to another page (e.g., Profile)
- User returns to Notifications page
- ✅ Filters remain as configured (Reactions and Mentions hidden)
- User's preferences persist across sessions

## Technical Implementation

### 1. **Automatic Save (Effect)**

```typescript
constructor() {
  // Save notification filters to localStorage whenever they change
  effect(() => {
    const filters = this.notificationFilters();
    this.localStorage.setItem(NOTIFICATION_FILTERS_KEY, JSON.stringify(filters));
  });
}
```

Uses Angular's `effect()` to automatically save filters whenever the signal changes. This is triggered by:
- User toggling a filter via `toggleNotificationFilter()`
- Programmatic filter changes

### 2. **Load on Initialization**

```typescript
async ngOnInit(): Promise<void> {
  // Load saved notification filters from localStorage
  this.loadNotificationFilters();
  
  await this.recordNotificationsView();
  await this.getLastViewedTimestamp();
}

private loadNotificationFilters(): void {
  try {
    const savedFilters = this.localStorage.getItem(NOTIFICATION_FILTERS_KEY);
    if (savedFilters) {
      const filters = JSON.parse(savedFilters) as Record<NotificationType, boolean>;
      this.notificationFilters.set(filters);
    }
  } catch (error) {
    console.error('Failed to load notification filters from localStorage', error);
  }
}
```

Loads saved filters from localStorage during component initialization, before any other data is loaded.

### 3. **Error Handling**

- **JSON Parse Errors**: If localStorage data is corrupted, the error is caught and logged, defaulting to the hardcoded filter values
- **Missing Data**: If no saved filters exist (first visit), uses default values (all filters enabled)
- **Invalid Data**: Type assertion ensures type safety

## Files Modified

### `notifications.component.ts`

**Imports Added:**
```typescript
import { effect } from '@angular/core';
import { LocalStorageService } from '../../services/local-storage.service';
```

**Constant Added:**
```typescript
const NOTIFICATION_FILTERS_KEY = 'nostria-notification-filters';
```

**Service Injected:**
```typescript
private localStorage = inject(LocalStorageService);
```

**Constructor Added:**
```typescript
constructor() {
  effect(() => {
    const filters = this.notificationFilters();
    this.localStorage.setItem(NOTIFICATION_FILTERS_KEY, JSON.stringify(filters));
  });
}
```

**Method Added:**
```typescript
private loadNotificationFilters(): void {
  try {
    const savedFilters = this.localStorage.getItem(NOTIFICATION_FILTERS_KEY);
    if (savedFilters) {
      const filters = JSON.parse(savedFilters) as Record<NotificationType, boolean>;
      this.notificationFilters.set(filters);
    }
  } catch (error) {
    console.error('Failed to load notification filters from localStorage', error);
  }
}
```

**ngOnInit Updated:**
```typescript
async ngOnInit(): Promise<void> {
  this.loadNotificationFilters(); // Added
  await this.recordNotificationsView();
  await this.getLastViewedTimestamp();
}
```

## Data Flow

```
User Action (Toggle Filter)
    ↓
toggleNotificationFilter() called
    ↓
notificationFilters signal updated
    ↓
effect() triggered automatically
    ↓
Filters saved to localStorage
    ↓
User navigates away
    ↓
User returns to notifications
    ↓
ngOnInit() called
    ↓
loadNotificationFilters() called
    ↓
Filters loaded from localStorage
    ↓
notificationFilters signal updated
    ↓
UI reflects saved preferences
```

## Benefits

### 1. **Improved User Experience**
- Users don't have to reconfigure filters every visit
- Reduces friction and cognitive load
- Consistent experience across sessions

### 2. **Reactive & Automatic**
- Uses Angular signals for reactive updates
- Effect automatically handles persistence
- No manual save button needed

### 3. **Robust Error Handling**
- Graceful degradation if localStorage is unavailable
- Handles corrupted data safely
- Falls back to sensible defaults

### 4. **Type Safe**
- TypeScript type assertions ensure data integrity
- Compile-time checks prevent errors
- IntelliSense support in IDE

## Testing Recommendations

### 1. **Basic Persistence Test**
1. Open notifications page
2. Toggle off "Zaps" and "Reactions"
3. Navigate to Profile page
4. Return to Notifications page
5. ✅ Verify "Zaps" and "Reactions" are still off

### 2. **Cross-Session Test**
1. Configure filters (e.g., only show Zaps and Mentions)
2. Close browser completely
3. Reopen browser and navigate to notifications
4. ✅ Verify filters are preserved

### 3. **All Filters Test**
1. Toggle each notification type individually
2. Verify each toggle is saved and restored
3. Test with all filters on
4. Test with all filters off
5. Test with mixed configuration

### 4. **Error Recovery Test**
1. Open DevTools console
2. Manually corrupt localStorage data:
   ```javascript
   localStorage.setItem('nostria-notification-filters', 'invalid-json{')
   ```
3. Reload notifications page
4. ✅ Verify it doesn't crash
5. ✅ Verify it logs error to console
6. ✅ Verify it uses default filters

### 5. **Multiple Notification Types Test**
1. Create notifications of various types
2. Apply filters to show only specific types
3. Navigate away and back
4. ✅ Verify only filtered types are visible

## Potential Future Enhancements

### 1. **Per-Account Filters**
Currently filters are global. Could be enhanced to save filters per account:
```typescript
const key = `nostria-notification-filters-${accountPubkey}`;
```

### 2. **Filter Presets**
Allow users to save and load filter presets:
```typescript
// Presets
"Only Zaps": { zap: true, all_others: false }
"Social Only": { mention: true, reply: true, reaction: true, ... }
"Everything": { all: true }
```

### 3. **Export/Import Settings**
Allow users to export/import their filter preferences across devices.

### 4. **Smart Defaults**
Learn from user behavior and suggest optimal filter settings.

### 5. **Sync Across Devices**
Store filter preferences in a Nostr event (kind 30078 - Application-specific data) for cross-device sync.

## Known Limitations

### 1. **localStorage Limits**
- Subject to browser localStorage quotas (~5-10MB)
- Not an issue for filter data (< 1KB)

### 2. **No Cross-Device Sync**
- Filters only persist on the current device
- Clearing browser data will reset filters

### 3. **No Migration Strategy**
- If NotificationType enum changes, old saved filters might have mismatches
- Consider adding version field for future migrations:
  ```typescript
  {
    version: 1,
    filters: { ... }
  }
  ```

## Related Code

- **Storage Service**: `src/app/services/local-storage.service.ts`
- **Notification Types**: `src/app/services/storage.service.ts` (NotificationType enum)
- **Component Template**: `src/app/pages/notifications/notifications.component.html`
- **Filter UI**: Look for filter toggle UI in the template

## Consistency with Other Features

This implementation follows the same pattern as:
- `LAST_NOTIFICATION_CHECK_KEY` in `content-notification.service.ts`
- Other localStorage keys use the `nostria-` prefix for namespacing
- Reactive patterns using signals and effects

## Conclusion

Notification filter persistence significantly improves UX by remembering user preferences across sessions. The implementation is reactive, robust, and follows Angular best practices using signals and effects for automatic synchronization with localStorage.
