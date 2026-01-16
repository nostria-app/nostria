# Articles Component Fix - Implementation Summary

## Overview
This document describes the changes made to fix two bugs in the Articles section:
1. Following's Articles was always empty
2. Navigating back from an article incorrectly switched to Following's Articles

## Problem Analysis

### Issue 1: Following's Articles Always Empty
The original implementation loaded ALL public articles from relays and then filtered locally to find articles from users in the following list. This approach had several problems:
- It relied on public article discovery which may not include articles from followed users on different relays
- It didn't query individual relay lists for each followed user
- Articles were not persisted to the database for offline/fast loading

### Issue 2: Navigation State Not Preserved
When navigating back from an article detail view, the component didn't remember whether the user was viewing "Following" or "Public" articles, always defaulting back to "Following".

## Solution Implementation

### 1. Articles Settings Dialog Component
Created a new settings dialog similar to Music and Streams settings dialogs:

**Files Created:**
- `/src/app/pages/articles/articles-settings-dialog/articles-settings-dialog.component.ts`
- `/src/app/pages/articles/articles-settings-dialog/articles-settings-dialog.component.html`
- `/src/app/pages/articles/articles-settings-dialog/articles-settings-dialog.component.scss`

**Features:**
- Manages NIP-51 relay set (kind 30002) with d-tag "articles"
- Allows users to configure custom relays for article discovery
- Loads from database cache first, then fetches from relays
- Persists relay set to database for offline use
- Suggests default relays (nos.lol, relay.damus.io)

### 2. Updated Articles Component Logic

**Modified File:** `/src/app/pages/articles/articles.component.ts`

**Key Changes:**

#### Database Caching
- `loadCachedArticles()`: Loads previously fetched articles from local database instantly
- Articles are displayed immediately while new content is fetched from relays
- Each article is saved to database as it arrives for future sessions

#### Following Articles Subscription
- `startFollowingSubscription()`: New method that queries articles specifically from followed users
- `queryIndividualRelays()`: Queries each followed user's relay list in batches of 10
- Uses both account relays and custom articles relays from relay set
- Processes users in batches to avoid overwhelming the system

#### Public Articles Subscription
- `startPublicSubscription()`: Only initiated when user switches to "Public" view
- Queries all public articles from configured relays
- Filters out articles from followed users to avoid duplicates

#### Relay Set Integration
- `loadArticlesRelaySet()`: Loads user's custom articles relay configuration
- Combines account relays with articles-specific relays
- Falls back to account relays if no custom relay set exists

#### Settings Dialog Integration
- Added settings button to panel actions
- `openSettings()`: Opens the articles settings dialog
- Refreshes articles when settings are saved

### 3. State Persistence

**Modified File:** `/src/app/services/account-local-state.service.ts`

**Changes:**
- Added `articlesDiscoverFeedSource` to `AccountLocalState` interface
- Added `getArticlesDiscoverFeedSource()` method
- Added `setArticlesDiscoverFeedSource()` method
- Feed source preference is now saved per account in localStorage

**Updated Articles Component:**
- Loads persisted feed source on initialization
- Saves feed source when user switches between Following/Public
- Restores correct view when navigating back from article detail

### 4. Article Event Handling

**New Method:** `handleArticleEvent(event: Event)`

Centralized event handler that:
- Deduplicates events using pubkey + d-tag as unique identifier
- Keeps only the newest version of each article
- Filters out blocked users and content
- Updates the article list reactively
- Persists articles to database asynchronously

## Technical Details

### Constants
```typescript
const PAGE_SIZE = 30;
const RELAY_SET_KIND = 30002;
const ARTICLES_RELAY_SET_D_TAG = 'articles';
```

### Database Schema
Articles are stored using the existing event storage:
- Kind: 30023 (Long-form content / Articles)
- Indexed by: pubkey, kind, d-tag
- Supports parameterized replaceable events

### Relay Query Strategy
1. **Account Relays**: User's configured relays from relay list
2. **Articles Relays**: Custom relays from articles relay set (NIP-51)
3. **User Relays**: Individual relay lists for each followed user

### Batching Strategy
- Following users are processed in batches of 10
- Each batch queries user relay lists concurrently
- 100ms delay between batches to prevent overwhelming
- Individual subscriptions timeout after 3 seconds

## User Experience Improvements

1. **Instant Loading**: Articles appear immediately from database cache
2. **Progressive Loading**: New articles load in the background
3. **Smart Discovery**: Articles from followed users are found even on their personal relays
4. **Persistent State**: View preference is remembered across sessions
5. **Custom Relays**: Users can configure article-specific relays for better discovery
6. **Correct Navigation**: Back button returns to the correct view (Following/Public)

## Performance Considerations

1. **Database Cache**: Reduces initial load time significantly
2. **Batch Processing**: Prevents overwhelming the relay pool
3. **Subscription Management**: Separate subscriptions for Following/Public to avoid unnecessary traffic
4. **Lazy Loading**: Public articles only loaded when needed
5. **Event Deduplication**: Map-based storage prevents duplicate processing

## Testing Recommendations

1. **Verify Following Articles**:
   - Check that articles from followed users appear
   - Verify articles load from user's individual relays
   - Test with users who have articles on different relays

2. **Verify Public Toggle**:
   - Switch to Public and confirm new subscription starts
   - Verify public articles don't include followed users' articles
   - Check that switching back to Following works correctly

3. **Verify Settings Dialog**:
   - Open settings and add/remove relays
   - Save settings and verify relay set is persisted
   - Confirm articles refresh with new relay configuration

4. **Verify Database Persistence**:
   - Load articles, close app, reopen
   - Verify cached articles appear instantly
   - Confirm new articles are added to cache

5. **Verify Navigation**:
   - View Following articles
   - Open an article
   - Navigate back
   - Confirm Following view is still active
   - Repeat for Public view

## Future Enhancements

1. **Relay Health Monitoring**: Track which relays successfully return articles
2. **Smart Relay Selection**: Prioritize relays based on success rate
3. **Background Sync**: Periodically update articles in the background
4. **Read/Unread Tracking**: Mark articles as read and filter accordingly
5. **Article Recommendations**: Suggest articles based on user interests
