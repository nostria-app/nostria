# Searchable Settings Feature

## Overview

The settings page now includes a search functionality that allows users to quickly find and navigate to specific settings sections based on keywords. This feature significantly improves user experience by making settings discoverable without having to remember where each setting is located.

## Features

### 1. Search Input in Settings Sidebar

A search input field has been added to the settings sidebar that allows users to filter settings sections in real-time as they type.

**Location**: `/settings` - Left sidebar (top of the navigation list)

**Key Features**:
- Real-time filtering as users type
- Clear button (X) appears when there's a search query
- Case-insensitive search
- Searches both section titles and keywords
- "No results" message when no sections match

### 2. Keyword-Based Filtering

Each settings section now has associated keywords that make it easier to find related settings:

#### General Settings
**Keywords**: dark mode, theme, language, locale, relays, max relays, authentication, auto relay auth, client tags, media, blur, privacy, calendar, time format, short form, autoplay, repeat, placeholder, external links, domains, event expiration, emoji, cache, wipe data, delete, storage

#### Algorithm Settings
**Keywords**: algorithm, feed, ranking, scoring, sort, filter, boost, penalty, weights, engagement, personalization

#### Relays Settings
**Keywords**: relays, connections, servers, websocket, nip-65, relay list, user relays, discovery relays, bootstrap, inbox, outbox, dm relays, messaging, relay info, ping, latency, status, authentication, cleanup

#### Search Settings
**Keywords**: search, index, elasticsearch, find, query, lookup, discover

#### Privacy & Safety Settings
**Keywords**: privacy, safety, security, mute, block, hide, filter, reports, nudity, malware, profanity, illegal, spam, impersonation, image cache, social sharing, preview, tracking, parameters, trusted media, delete account, delete event, muted words, muted tags, muted threads, muted accounts

#### Trust Settings
**Keywords**: trust, web of trust, wot, reputation, score, trusted, follows, network, verification

#### Wallet Settings
**Keywords**: wallet, lightning, bitcoin, zap, payments, nwc, nostr wallet connect, alby, balance, transactions, lightning address, lnurl

#### Backup Settings
**Keywords**: backup, restore, export, import, data, download, save, recovery, archive

#### Premium Settings
**Keywords**: premium, subscription, paid, features, upgrade, pro, benefits, support

#### Logs Settings
**Keywords**: logs, debug, console, errors, warnings, diagnostics, troubleshooting, developer

#### About Settings
**Keywords**: about, version, info, information, app, nostria, credits, license, terms, privacy policy, contact, support, help

### 3. Command Palette Integration

Settings sections are now fully integrated with the Command Palette (Ctrl+K / Cmd+K), allowing users to quickly jump to any settings section from anywhere in the application.

**New Commands Added**:
- Open General Settings
- Open Algorithm Settings
- Open Search Settings
- Open Privacy & Safety Settings
- Open Trust Settings
- Open Logs Settings
- Open About

Each command includes relevant keywords for easy discovery through the command palette search.

## Usage Examples

### Example 1: Finding Dark Mode Settings
1. Navigate to `/settings`
2. Type "dark" in the search input
3. "General" section appears (matches keyword "dark mode")
4. Click on "General" to access dark mode toggle

### Example 2: Finding Mute Settings
1. Navigate to `/settings`
2. Type "mute" in the search input
3. "Privacy & Safety" section appears (matches keyword "mute")
4. Click on "Privacy & Safety" to access mute lists

### Example 3: Using Command Palette
1. Press Ctrl+K (or Cmd+K on Mac) from anywhere in the app
2. Type "privacy settings"
3. Select "Open Privacy & Safety Settings"
4. Instantly navigate to the Privacy & Safety settings page

### Example 4: Finding Lightning Wallet Settings
1. Navigate to `/settings`
2. Type "lightning" in the search input
3. "Wallet" section appears (matches keyword "lightning")
4. Click on "Wallet" to access wallet settings

## Technical Implementation

### Component Changes

**File**: `src/app/pages/settings/settings.component.ts`

**Changes**:
1. Added `searchQuery` signal to track the search input
2. Extended `SettingsSection` interface to include `keywords` array
3. Added comprehensive keywords to each settings section
4. Created `filteredSections` computed signal that filters sections based on search query
5. Added `clearSearch()` method to clear the search input
6. Imported necessary Angular Material modules (MatInputModule, MatFormFieldModule, FormsModule)

**File**: `src/app/pages/settings/settings.component.html`

**Changes**:
1. Added search input field with Material Design styling
2. Added clear button (X icon) that appears when there's a search query
3. Updated the section list to use `filteredSections()` instead of `sections`
4. Added "No results" message that displays when no sections match the search

**File**: `src/app/pages/settings/settings.component.scss`

**Changes**:
1. Added `.search-container` styling for proper spacing
2. Added `.search-field` styling for the search input
3. Added `.no-results` styling for the no-results message

**File**: `src/app/components/command-palette-dialog/command-palette-dialog.component.ts`

**Changes**:
1. Added detailed settings section commands to the command palette
2. Each command includes comprehensive keywords for discoverability

### Architecture Alignment

This implementation follows the Nostria architecture guidelines:
- Uses Angular signals for reactive state management
- Implements computed signals for derived state (filtered sections)
- Follows Material Design 3 principles
- Uses standalone components
- Maintains mobile-first responsive design
- Integrates with existing Command Palette system

## Benefits

1. **Improved Discoverability**: Users can find settings by typing natural keywords instead of remembering exact locations
2. **Faster Navigation**: Quick filtering reduces the need to scan through all sections
3. **Better UX**: Real-time feedback as users type
4. **Keyboard-Friendly**: Full integration with Command Palette for keyboard-centric users
5. **Scalability**: Easy to add new settings sections with keywords in the future
6. **Consistency**: Matches the existing Command Palette search pattern

## Future Enhancements

Potential future improvements could include:
1. Deep search within individual setting items (not just section titles)
2. Search result highlighting
3. Recent searches/suggestions
4. Fuzzy search for typo tolerance
5. Search analytics to improve keywords based on user behavior
6. Quick actions directly from search results (e.g., toggle dark mode from search)
