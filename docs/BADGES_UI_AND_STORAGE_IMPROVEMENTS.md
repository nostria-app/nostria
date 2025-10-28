# Badges UI and Storage Improvements

## Overview
This document describes the comprehensive improvements made to the badges system, including UI updates, account switching support, and database storage implementation.

## Changes Made

### 1. Updated Accepted Badges UI (badges.component)
- **Changed layout**: Modified the "Accepted" tab to use a horizontal list layout instead of grid, matching the "Received" tab
- **Improved consistency**: Both Accepted and Received tabs now display badges in a consistent list format
- **Added empty state**: Shows a helpful message when no badges have been accepted

### 2. Added User Profile Display
- **Profile header integration**: Added the ProfileHeaderComponent to the top of the badges page
- **Context awareness**: Users can now clearly see whose badges are being viewed
- **Compact mode**: Uses the compact version of the profile header to save space
- **Dynamic loading**: Profile data is loaded alongside badge data based on the viewing pubkey

### 3. Account Switching Support
- **Query parameter support**: Badges page now accepts a `pubkey` query parameter to view any user's badges
- **Profile loading**: The viewing user's profile is loaded and displayed
- **Service updates**: BadgeService properly handles loading badges for any specified pubkey
- **Proper isolation**: Badge data is correctly associated with the viewing user

### 4. Conditional Edit/Issue Badge Buttons
- **Ownership check**: Badge details page now checks if the current user is the badge creator
- **Dynamic UI**: "Edit" and "Issue Badge" buttons only appear when viewing badges you created
- **Security**: Uses AccountStateService to verify current user's pubkey against badge creator

### 5. Database Storage for Badge Definitions
- **IndexedDB integration**: Added methods to StorageService for badge definition persistence
  - `saveBadgeDefinition(badgeEvent: Event)`
  - `getBadgeDefinition(pubkey: string, slug: string)`
  - `getBadgeDefinitionsByPubkey(pubkey: string)`
  - `deleteBadgeDefinition(pubkey: string, slug: string)`
- **Composite key**: Badge definitions are stored with key format `pubkey::slug`
- **Caching strategy**: Badge definitions are checked in this order:
  1. Memory (signal state)
  2. Local database (IndexedDB)
  3. Relays (network fetch)
- **Performance improvement**: Significantly faster badge definition retrieval on subsequent loads
- **Automatic persistence**: Badge definitions are automatically saved to database when loaded

## Technical Details

### Database Schema
Badge definitions are stored in the `badgeDefinitions` object store with:
- **Key**: Composite string `{pubkey}::{slug}`
- **Value**: Complete badge definition event (kind 30009)
- **Indexes**: 
  - `by-pubkey`: For retrieving all badges by a specific creator
  - `by-updated`: For sorting by last update time (uses `created_at` field)

**Important**: The database schema was upgraded from version 6 to version 7 to include the `badgeDefinitions` object store. Users will automatically get this upgrade on next app load.

### Service Updates

#### BadgeService
- `putBadgeDefinition()`: Now saves to storage in addition to updating memory
- `loadBadgeDefinition()`: Checks storage before fetching from relays
- `loadBadgeDefinitions()`: Loads cached definitions first, then updates from relays

#### StorageService
New methods added for badge definition management, following the same pattern as other stored data types.

### Component Updates

#### BadgesComponent
- Added `viewingPubkey` signal to track which user's badges are displayed
- Added `viewingProfile` signal for the profile data
- Integrated ProfileHeaderComponent
- Updated to load profile data alongside badges

#### BadgeDetailsComponent
- Injected AccountStateService
- Updated `isCreator` check to use current account's pubkey
- Properly validates ownership before showing edit/issue controls

## Benefits

1. **Better UX**: Consistent badge display across tabs
2. **Clarity**: Users always know whose badges they're viewing
3. **Performance**: Fast badge loading from local database
4. **Security**: Proper ownership validation for administrative functions
5. **Flexibility**: Support for viewing any user's badges via URL parameters

## Usage

### View Your Own Badges
Navigate to `/badges` - defaults to current user's badges

### View Another User's Badges
Navigate to `/badges?pubkey={npub or hex pubkey}` - shows that user's badges

### Create/Edit Badges
Only available when viewing your own badges - buttons automatically shown/hidden based on ownership
