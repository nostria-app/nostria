# SSR Debugging Guide for Dynamic Meta Tags

This guide helps you debug Server-Side Rendering (SSR) issues with dynamic social media meta tags in the Angular Nostria application.

## Overview

The application uses Angular Universal for SSR with the following flow:
1. User/bot requests a URL (e.g., `/e/{neventId}` or `/a/{narticleid}`)
2. Express server (`server.ts`) handles the request
3. Route resolvers (`DataResolver`, `ArticleResolver`) execute server-side
4. Meta tags are set via `MetaService.updateSocialMetadata()`
5. HTML is rendered with meta tags and sent to client

## Common Issues

### 1. **Meta Tags Not Being Set**
- Resolver not executing server-side
- API calls failing silently
- Platform detection issues

### 2. **Meta Tags Not Appearing in HTML**
- Angular not rendering tags before send
- Timing issues with async data
- TransferState not working properly

### 3. **Wrong Meta Tags Being Shown**
- Client-side hydration overwriting SSR tags
- Cache issues
- Race conditions

## Debugging Steps

### Step 1: Verify SSR is Running

Test if your page is being server-side rendered:

```powershell
# Build for production (SSR is only configured for production builds)
npm run build

# Start the SSR server
node dist/app/server/server.mjs

# Test with Node.js inspector (in separate terminal)
node inspect-ssr.js /e/nevent1...
```

Look for:
- ✅ `<title>` tag in HTML (not just "Nostria")
- ✅ `<meta property="og:title">` tags
- ✅ `<meta name="twitter:title">` tags

### Step 2: Check Server Logs

With the logging we added, you'll see:

```
[SSR] Rendered: /e/nevent1...
```

**What to look for:**
- ✅ Successfully rendered message
- ❌ `[SSR] Error:` messages → SSR failed
- ❌ `[SSR] Failed to load metadata:` → API call failures

### Step 3: Test with Social Media Debuggers

Use these tools to verify meta tags:

1. **Facebook Sharing Debugger**
   - URL: https://developers.facebook.com/tools/debug/
   - Tests: og:title, og:description, og:image

2. **Twitter Card Validator**
   - URL: https://cards-dev.twitter.com/validator
   - Tests: twitter:card, twitter:title, twitter:image

3. **LinkedIn Post Inspector**
   - URL: https://www.linkedin.com/post-inspector/
   - Tests: og:title, og:description, og:image

### Step 4: View Raw HTML Response

```powershell
# Get the raw HTML
curl http://localhost:4000/e/nevent1... > output.html

# Or use the inspector
node inspect-ssr.js /e/nevent1...
```

Search for these tags:
```html
<title>Expected Title Here</title>
<meta property="og:title" content="Expected Title Here">
<meta property="og:description" content="Expected Description">
<meta property="og:image" content="https://...">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Expected Title Here">
```

### Step 5: Check for Platform Detection Issues

The `LayoutService.isBrowser()` check determines if code runs server-side. Verify it's working:

```typescript
// In data-resolver.ts - already added logging
console.log('[DataResolver] Is browser?', this.layout.isBrowser());
```

Should output `false` during SSR, `true` in browser.

### Step 6: Verify API Endpoints

Test that the metadata API is reachable from the server:

```powershell
# Test from server environment
curl https://metadata.nostria.app/e/nevent1...
```

Should return JSON with author, content, tags, etc.

### Step 7: Check TransferState

Verify data is being transferred from server to client:

```typescript
// In browser console after page loads:
const state = document.querySelector('script[id="transfer-state"]');
console.log(state?.textContent);
```

Should see the event data stored for hydration.

## Advanced Debugging Techniques

### 1. **Add Response Interceptor**

See the final HTML before it's sent:

```typescript
// In server.ts
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then(response => {
      if (response) {
        // Read the response body
        response.text().then(html => {
          console.log('[SSR] HTML Preview (first 500 chars):', html.substring(0, 500));
        });
        return writeResponseToNodeResponse(response, res);
      }
      return next();
    })
    .catch(next);
});
```

### 2. **Test Specific Routes**

```powershell
# Test event page
curl http://localhost:4000/e/nevent1... | grep -i "og:title"

# Test article page
curl http://localhost:4000/a/naddr1... | grep -i "og:title"

# Test profile page
curl http://localhost:4000/p/npub1... | grep -i "og:title"
```

### 3. **Monitor Resolver Execution**

Add breakpoints or detailed logging in:
- `data-resolver.ts` → `resolve()` method
- `meta.service.ts` → `updateSocialMetadata()` method
- `meta.service.ts` → `loadSocialMetadata()` method

### 4. **Check for Timing Issues**

If resolvers complete but tags don't appear:

```typescript
// In DataResolver
async resolve(route: ActivatedRouteSnapshot): Promise<EventData | null> {
  // ... existing code ...
  
  // Add a small delay to ensure tags are set
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return data;
}
```

## Common Fixes

### Fix 1: Meta Tags Not Set Because of Platform Check

**Problem:** Resolver exits early because `isBrowser()` returns true on server.

**Solution:** Check `PLATFORM_ID` directly:

```typescript
import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';

// In resolver
private platformId = inject(PLATFORM_ID);

async resolve(route: ActivatedRouteSnapshot): Promise<EventData | null> {
  if (!isPlatformServer(this.platformId)) {
    return null;
  }
  // ... rest of code
}
```

### Fix 2: Async API Calls Not Completing

**Problem:** HTTP calls timeout or fail server-side.

**Solution:** Add timeout and retry logic:

```typescript
async loadSocialMetadata(addr: string): Promise<MetadataResponse> {
  const url = `${this.#metadataUrl}e/${addr}`;
  
  try {
    const data = await firstValueFrom(
      this.http.get<MetadataResponse>(url).pipe(
        timeout(5000), // 5 second timeout
        retry(2) // Retry twice
      )
    );
    return data;
  } catch (error) {
    console.error('[MetaService] Failed to load metadata:', error);
    throw error;
  }
}
```

### Fix 3: Missing Meta Tags in HTML

**Problem:** Tags are set but not in rendered HTML.

**Solution:** Ensure tags are set in the `<head>` using `Meta.addTags()` for multiple tags:

```typescript
updateSocialMetadata(config: SocialMetadataConfig): void {
  const tags = [
    { property: 'og:title', content: config.title },
    { property: 'og:description', content: config.description },
    { property: 'og:image', content: config.image },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: config.title },
    { name: 'twitter:description', content: config.description },
    { name: 'twitter:image', content: config.image },
  ];
  
  this.meta.addTags(tags.filter(tag => tag.content));
}
```

### Fix 4: Client Overwriting Server Tags

**Problem:** Client-side hydration replaces SSR meta tags.

**Solution:** Use TransferState to prevent re-fetching:

```typescript
// In component using metadata
private readonly transferState = inject(TransferState);
private readonly STATE_KEY = makeStateKey<EventData>('event-data');

ngOnInit() {
  // Check if we have server-rendered data first
  const cachedData = this.transferState.get(this.STATE_KEY, null);
  
  if (cachedData) {
    // Use server data, don't re-fetch
    this.loadFromCache(cachedData);
  } else if (isPlatformBrowser(this.platformId)) {
    // Only fetch if in browser and no cached data
    this.fetchData();
  }
}
```

## Testing Checklist

- [ ] Server logs show resolver executing
- [ ] API calls completing successfully
- [ ] Meta tags visible in curl response
- [ ] Facebook debugger shows correct tags
- [ ] Twitter validator shows correct card
- [ ] No console errors in server logs
- [ ] TransferState contains event data
- [ ] Client doesn't overwrite server tags

## Production Testing

Before deploying:

```powershell
# Build production
npm run build

# Test SSR production build
node dist/app/server/server.mjs

# Test a few URLs
curl http://localhost:4000/e/{test-event}
curl http://localhost:4000/a/{test-article}
curl http://localhost:4000/p/{test-profile}
```

Verify each returns proper meta tags in HTML.

## Additional Resources

- [Angular Universal Docs](https://angular.dev/guide/ssr)
- [Meta Service Docs](https://angular.dev/api/platform-browser/Meta)
- [TransferState Docs](https://angular.dev/api/core/TransferState)
- [Open Graph Protocol](https://ogp.me/)
- [Twitter Card Docs](https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/abouts-cards)
