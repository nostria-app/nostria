# External Link Handler Feature

## Overview

The External Link Handler feature allows users to configure which external domains should open within the Nostria app instead of opening in a new browser tab. This provides a seamless experience when navigating between different Nostr clients.

## How It Works

### 1. Service Architecture

The `ExternalLinkHandlerService` is the core service that manages domain configuration and handles link clicks.

**Location:** `src/app/services/external-link-handler.service.ts`

**Key Features:**
- Stores configured domains in localStorage
- Provides default domains (primal.net, snort.social, iris.to, coracle.social, nostur.com)
- Checks if a URL should be handled internally
- Extracts Nostr identifiers from URLs and routes to internal pages
- Respects browser conventions (Ctrl/Cmd/Shift+Click still opens in new tab)

### 2. Integration Points

#### Articles (Long-form Content)
- **Component:** `ArticleComponent` (`src/app/pages/article/article.component.ts`)
- **Method:** `setupLinkClickListeners()`
- Intercepts clicks on links with class `external-link` in article content
- Markdown renderer adds this class automatically to regular links

#### Notes (Short-form Content)
- **Component:** `NoteContentComponent` (`src/app/components/content/note-content/note-content.component.ts`)
- **Method:** `onUrlClick(url, event)`
- Handles URL token clicks in note content

#### Markdown Renderer
- **File:** `src/app/services/format/markdownRenderer.ts`
- Modified to add `external-link` class to all regular links
- Preserves existing functionality for images and other content types

### 3. User Interface

**Location:** General Settings page (`src/app/pages/settings/general/`)

The settings UI provides:
- List of currently configured domains
- Add new domain input field
- Remove domain button for each entry
- Reset to defaults button

**Features:**
- Domain normalization (removes protocol, www, trailing slashes)
- Real-time updates when domains are added/removed
- Persists across browser sessions

## URL Pattern Recognition

The handler recognizes common Nostr URL patterns:

- Profile URLs: `/p/npub...` or `/profile/npub...` → Routes to `/p/{npub}`
- Event URLs: `/e/note...` or `/event/note...` or `/e/nevent...` → Routes to `/e/{note/nevent}`
- Article URLs: `/a/naddr...` or `/article/naddr...` → Routes to `/a/{naddr}`

## Default Domains

The following domains are configured by default:
- `primal.net` - Primal client
- `snort.social` - Snort client
- `iris.to` - Iris client
- `coracle.social` - Coracle client
- `nostur.com` - Nostur client

Users can add or remove domains as needed.

## User Experience

### Normal Click
When a user clicks a link to a configured domain:
1. The handler checks if the domain is in the configured list
2. If yes, extracts the Nostr identifier from the URL
3. Routes to the appropriate internal page
4. Link opens within the app (no new tab)

### Special Key Combinations
- **Ctrl+Click** (Windows/Linux) or **Cmd+Click** (Mac): Opens in new tab
- **Shift+Click**: Opens in new window
- These browser conventions are preserved for user flexibility

### Fallback Behavior
If the URL pattern cannot be recognized or extracted:
- Link opens in a new browser tab (default behavior)
- User sees a warning in the browser console (debug mode)

## Storage

Configuration is stored in localStorage with the key: `nostria-external-domains`

**Data Format:**
```json
["primal.net", "snort.social", "iris.to", "coracle.social", "nostur.com"]
```

## Platform Support

This feature works on:
- ✅ Web browsers (desktop and mobile)
- ✅ Progressive Web App (PWA)
- ✅ Desktop apps (Tauri)
- ⚠️ Native mobile apps - May require additional configuration for "Open by default" functionality

### Android "Open by Default"

On Android, the "Open by default" setting in app settings allows the app to handle URLs system-wide. To enable this:

1. Go to Android Settings
2. Apps → Nostria → Open by default
3. Add supported web addresses
4. Add the domains you want to handle

This allows links from other apps (email, messaging, etc.) to open in Nostria.

### iOS Universal Links

On iOS, similar functionality can be achieved with Universal Links configuration in the app's associated domains entitlement.

## Future Enhancements

Potential improvements for future versions:

1. **Auto-detection:** Automatically add domains when user visits Nostr clients
2. **Pattern matching:** Support wildcards (e.g., `*.primal.net`)
3. **Import/Export:** Share domain configurations between devices
4. **Sync via Nostr:** Store configuration in user's Nostr profile (NIP-78)
5. **Smart routing:** Detect content type and route to appropriate view
6. **Performance:** Cache domain checks for frequently accessed URLs

## Technical Notes

### Domain Normalization

Domains are normalized before storage:
- Remove `http://` or `https://`
- Remove `www.` prefix
- Remove trailing slashes
- Convert to lowercase

Example: `https://www.Primal.net/` → `primal.net`

### URL Matching

The handler supports both exact matches and subdomain matches:
- `primal.net` matches `primal.net` and `*.primal.net`
- `m.primal.net` would also be handled if `primal.net` is configured

### Security Considerations

- All URLs are validated before processing
- Invalid URLs are logged and ignored
- External links still use `rel="noopener noreferrer"` for security
- User can always override with modifier keys (Ctrl/Cmd+Click)

## Testing

To test the feature:

1. Navigate to Settings → General → External Links
2. Ensure default domains are configured
3. Find a post with a link to a configured domain (e.g., primal.net)
4. Click the link without modifier keys → Should open in app
5. Ctrl/Cmd+Click the same link → Should open in new tab
6. Try adding a custom domain (e.g., `example.com`)
7. Create a test link to that domain
8. Verify it routes internally when clicked

## Code References

### Service
- `src/app/services/external-link-handler.service.ts` - Main handler service

### Components
- `src/app/pages/article/article.component.ts` - Article link handling
- `src/app/components/content/note-content/note-content.component.ts` - Note link handling
- `src/app/pages/settings/general/general.component.ts` - Settings UI

### Renderer
- `src/app/services/format/markdownRenderer.ts` - Markdown link rendering

### Templates
- `src/app/pages/settings/general/general.component.html` - Settings UI template
- `src/app/components/content/note-content/note-content.component.html` - Note content template

### Styles
- `src/app/pages/settings/general/general.component.scss` - Settings UI styles
