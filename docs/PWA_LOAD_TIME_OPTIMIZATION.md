# PWA Initial Load Time Optimization Guide

## Problem Analysis

Your current build produces:
- **Initial bundle: ~5.4MB** (exceeds 5MB budget)
- **Main chunk: 1.93MB** (compressed: ~302KB)
- **~50 initial chunk files** that must all load before app becomes interactive
- Service worker prefetches ALL JS files on first visit

For new users on slower connections, this means downloading **all** JavaScript before the app works.

## Optimization Strategies

### 1. ✅ Convert to Lazy-Loaded Routes (HIGHEST IMPACT)

**Current problem:** Most routes eagerly import components at the top of `app.routes.ts`, adding them to the initial bundle.

**Solution:** Use `loadComponent()` for ALL routes except the home page.

See `app.routes.optimized.ts` for the fully lazy-loaded version.

**Expected impact:** Reduce initial bundle by 40-60%

```typescript
// BEFORE (adds to initial bundle)
import { ProfileComponent } from './pages/profile/profile.component';
{ path: 'p/:id', component: ProfileComponent }

// AFTER (loaded only when visited)
{ 
  path: 'p/:id', 
  loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent)
}
```

### 2. ✅ Optimize Service Worker Caching Strategy

**Current problem:** `ngsw-config.json` uses `"installMode": "prefetch"` for ALL JS files, downloading everything on first visit.

**Solution:** Use `"installMode": "lazy"` for chunk files.

See `ngsw-config.optimized.json`:
- `app-shell`: Prefetch only `main*.js`, `polyfills*.js`, and CSS
- `app-chunks`: Lazy load chunk files (downloaded as needed)
- `assets`: Lazy load images/fonts

**Expected impact:** First visit downloads only ~500KB instead of 5MB+

### 3. Dynamic Imports for Heavy Libraries

**Problem:** `nostr-tools` is imported at top-level in many services.

**Solution:** Use dynamic imports for heavy operations:

```typescript
// BEFORE
import { SimplePool } from 'nostr-tools';

// AFTER  
async function getPool() {
  const { SimplePool } = await import('nostr-tools/pool');
  return new SimplePool();
}
```

Already partially done in `stream-resolver.ts`. Apply to other services.

### 4. Preload Critical Routes

After implementing lazy loading, preload likely-needed routes:

```typescript
// app.config.ts
import { provideRouter, withPreloading, PreloadAllModules } from '@angular/router';

// Or create a custom preloading strategy
import { PreloadingStrategy, Route } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class SelectivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<any>): Observable<any> {
    // Preload routes marked with data: { preload: true }
    return route.data?.['preload'] ? load() : of(null);
  }
}

// In routes:
{ path: 'messages', loadComponent: ..., data: { preload: true } }
```

### 5. Code Splitting for Large Components

For the `App` component (1591 lines), consider:
- Moving dialog components to lazy-loaded modules
- Using `@defer` blocks for below-fold content

```html
<!-- In app.html -->
@defer (on viewport) {
  <app-favorites-overlay></app-favorites-overlay>
}

@defer (on idle) {
  <app-media-player></app-media-player>
}
```

### 6. Build Configuration Optimizations

Update `angular.json`:

```json
{
  "configurations": {
    "production": {
      "optimization": {
        "scripts": true,
        "styles": {
          "minify": true,
          "inlineCritical": true
        },
        "fonts": {
          "inline": false
        }
      },
      "budgets": [
        {
          "type": "initial",
          "maximumWarning": "2MB",
          "maximumError": "3MB"
        }
      ]
    }
  }
}
```

### 7. Consider Tree-Shakeable Imports

For `nostr-tools`, use subpath imports:

```typescript
// Instead of
import { nip19, kinds, SimplePool } from 'nostr-tools';

// Use specific subpaths
import { nip19 } from 'nostr-tools/nip19';
import { kinds } from 'nostr-tools/kinds';
import { SimplePool } from 'nostr-tools/pool';
```

### 8. Implement App Shell Pattern

For PWAs, render a minimal shell immediately:

1. The current loading spinner in `index.html` is good
2. Consider pre-rendering a static app shell with key UI elements
3. Use `@angular/ssr` to pre-render the home page

## Implementation Priority

1. **HIGH:** Replace `app.routes.ts` with lazy-loaded version
2. **HIGH:** Update `ngsw-config.json` to lazy-load chunks
3. **MEDIUM:** Add `@defer` blocks in `app.html`
4. **MEDIUM:** Convert nostr-tools imports to subpaths
5. **LOW:** Implement selective preloading strategy

## Testing the Improvements

```bash
# Build and analyze
npm run build -- --stats-json
npx webpack-bundle-analyzer dist/app/browser/stats.json

# Test first-load performance
# Use Chrome DevTools > Network > Slow 3G
# Check "Initial bundle generation" in build output
```

## Actual Results

After implementing lazy-loaded routes:

| Metric | Before | After |
|--------|--------|-------|
| Main chunk | 1.93 MB | **494 KB** (75% reduction) |
| Initial bundle total | ~5.4 MB | **~3.5 MB** (35% reduction) |
| Budget warning | YES (exceeded 5MB) | **NO** (passes budget) |
| Critical path (main+polyfills+CSS) | N/A | **~514 KB** |
| Lazy chunks | 15 files | **77+ files** (more granular loading) |

### What This Means for Users

**Before optimization:**
- Service worker downloads ~5.4MB on first visit
- User waits for ALL chunks before app becomes interactive
- On slow 3G (~50KB/s): ~2 minutes to download

**After optimization:**
- Critical path: ~514KB (main, polyfills, CSS)
- Service worker only prefetches critical files
- Lazy chunks loaded on-demand as user navigates
- On slow 3G (~50KB/s): ~10 seconds to first interaction

### Service Worker Strategy Change

The updated `ngsw-config.json` now:
1. **Prefetches** only: `main*.js`, `polyfills*.js`, `*.css`, `index.html`
2. **Lazy loads** all `chunk*.js` files (downloaded as user navigates)

This means first-time visitors only download what's needed for the home page, and additional features load progressively.

## Files Changed

- `app.routes.ts` - All routes now use `loadComponent()` for lazy loading
- `ngsw-config.json` - Service worker now lazy-loads chunk files
- Backup files saved as `*.old.ts` and `*.old.json`
