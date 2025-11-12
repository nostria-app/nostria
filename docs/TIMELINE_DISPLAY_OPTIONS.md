# Timeline Display Options Implementation

## Overview
Added display options to the Timeline feed on user profiles, allowing users to filter what types of content are shown. Articles and Media have dedicated tabs, so they are excluded from the timeline filters.

## Changes Made

### 1. New Interface: `TimelineFilterOptions`
**File**: `src/app/interfaces/timeline-filter.ts`

Created a new interface to define available filter options:

```typescript
export interface TimelineFilterOptions {
  showNotes: boolean;        // Kind 1: Short text notes
  showReposts: boolean;      // Kind 6, 16: Reposts and Generic Reposts
  showReplies: boolean;      // Kind 1 notes that are replies
  showReactions: boolean;    // Kind 7: Reactions (experimental)
}
```

All options default to `true` except for experimental features (reactions), which default to `false`.

**Note**: Articles (Kind 30023) and Media (Kind 20, 21, 22) are not included in the timeline filter as they have dedicated tabs in the profile.

### 2. Profile State Service Updates
**File**: `src/app/services/profile-state.service.ts`

#### New Signals
- `timelineFilter`: Signal to store current filter options
- `reactions`: Signal to store reaction events (Kind 7)

**Note**: Articles and Media signals continue to exist for their dedicated tabs, but are not included in the timeline filtering.

#### Enhanced Timeline Computation
The `sortedTimeline` computed signal now respects filter options:
- Only includes event types that are enabled in the filter
- Dynamically updates when filter options change
- Maintains chronological sorting (newest first)

#### Updated Data Loading
- Initial data loading queries include reactions when enabled
- `loadMoreNotes()` method updated to load additional reactions based on filter state
- Proper deduplication for all event types
- Articles and Media continue to be loaded for their dedicated tabs but are not part of the timeline filter

#### New Methods
- `updateTimelineFilter(filter: Partial<TimelineFilterOptions>)`: Update filter options
- `resetTimelineFilter()`: Reset to default filter state

### 3. Profile Notes Component Updates
**File**: `src/app/pages/profile/profile-notes/profile-notes.component.ts`

#### New Properties
- `timelineFilter` getter: Provides access to current filter state from ProfileStateService

#### New Methods
- `updateFilter(key, value)`: Update a specific filter option

### 4. UI Implementation
**File**: `src/app/pages/profile/profile-notes/profile-notes.component.html`

Added filter controls in the "Display Options" section with responsive behavior:

#### Mobile View (< 960px)
- Collapsible expansion panel to save screen space
- "Display Options" header with tune icon
- Expandable to show all filter toggles
- Collapsed by default to maximize content visibility

#### Desktop View (≥ 960px)
- Always-visible sidebar on the right
- Sticky positioning while scrolling
- Persistent filter controls

#### Available Filters
- **Notes**: Short text posts (Kind 1 root posts)
- **Reposts**: Shared content from others (Kind 6, 16)
- **Replies**: Comments on other posts (Kind 1 replies)
- **Reactions**: Like and emoji reactions (Kind 7) - *Experimental*

**Note**: Articles and Media are not included as they have dedicated tabs.

Each filter includes:
- Material slide toggle control
- Icon representing the content type
- Descriptive label
- Help text explaining what the filter does
- Tooltips for experimental features

### 5. Styling Updates
**File**: `src/app/pages/profile/profile-notes/profile-notes.component.scss`

Enhanced the options section styling with responsive behavior:

```scss
.options-section {
  // Mobile: Collapsed expansion panel
  .mobile-only {
    - Displayed only on screens < 960px
    - Collapsible expansion panel
    - Minimal space usage when collapsed
  }

  // Desktop: Always visible sidebar
  .desktop-only {
    - Displayed only on screens ≥ 960px
    - Sticky positioning
    - Sidebar layout on the right
  }
}

.filter-option {
  - Vertical layout with icon and label
  - Descriptive text aligned with toggle
  - Consistent spacing and typography
}

.advanced-option {
  - Visual distinction for experimental features
  - Secondary color accent for icons
}

.filter-divider {
  - Visual separator between standard and experimental options
}
```

## Event Kinds Reference

Based on Nostr NIPs (Nostr Implementation Possibilities):

### Timeline Filters
| Kind | Name | Description | NIP |
|------|------|-------------|-----|
| 1 | Short Text Note | Standard microblog post | NIP-01 |
| 6 | Repost | Share another user's note | NIP-18 |
| 7 | Reaction | Like or emoji reaction | NIP-25 |
| 16 | Generic Repost | Enhanced repost with quote | NIP-18 |

### Other Tabs (Not in Timeline Filter)
| Kind | Name | Description | NIP | Tab |
|------|------|-------------|-----|-----|
| 20 | Picture | Image content | NIP-68 | Media |
| 21 | Video Event | Video content | NIP-71 | Media |
| 22 | Short-form Portrait Video | Short video format | NIP-71 | Media |
| 30023 | Long-form Content | Articles and blog posts | NIP-23 | Articles |

## User Experience

### Responsive Behavior
#### Mobile (< 960px)
- Display Options appear as a collapsible expansion panel at the top
- Collapsed by default to maximize content visibility
- Users tap to expand and see filter controls
- Minimal UI footprint when not in use

#### Desktop (≥ 960px)
- Display Options always visible in a sticky sidebar on the right
- Remains visible while scrolling through timeline
- Easy access without interrupting reading flow

### Default Behavior
- Standard content types (Notes, Reposts, Replies) are shown by default
- Experimental features (Reactions) are off by default
- Timeline updates immediately when filters change
- Filter state persists during the session

### Filter Interactions
- Each toggle can be independently controlled
- Timeline automatically recalculates when filters change
- No reload required - changes are instant
- Filters apply to both initial load and infinite scroll

### Performance Considerations
- Filtering happens client-side using computed signals
- No additional server queries when toggling filters
- Efficient deduplication prevents duplicate events
- Lazy loading only queries for enabled experimental features
- Articles and Media are loaded separately for their dedicated tabs

## Future Enhancements

Potential additions:
1. Save filter preferences per profile
2. Quick filter presets (e.g., "Only Reposts")
3. Date range filtering
4. Sort order options (newest/oldest first)
5. More experimental event types as they become standardized
6. Export/import filter configurations
7. Remember expansion state on mobile

## Testing Recommendations

1. Toggle each filter individually and verify content appears/disappears
2. Try combinations of filters
3. Test with profiles that have various event types
4. Verify infinite scroll works with different filter combinations
5. Test experimental features with profiles that have reactions
6. Confirm filter state persists during navigation within the profile
7. **Check mobile responsiveness:**
   - Verify expansion panel appears and works on mobile
   - Confirm it's collapsed by default
   - Test expand/collapse interactions
8. **Check desktop layout:**
   - Verify sidebar appears on right side on desktop
   - Confirm sticky positioning works while scrolling
   - Test at various screen widths around the 960px breakpoint
