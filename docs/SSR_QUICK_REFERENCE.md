# SSR Debugging Quick Reference

## Quick Start

```powershell
# 1. Build the app (production - SSR is only in production config)
npm run build

# 2. Start SSR server
node dist/app/server/server.mjs

# 3. In another terminal, test with debugging script
.\debug-ssr.ps1 "/e/nevent1..."

# Or use Node.js inspector
node inspect-ssr.js /e/nevent1...

# Or test manually
curl http://localhost:4000/e/nevent1... | Select-String "og:title"
```

## What to Look For

### ✓ Working SSR
- Custom `<title>` tag (not just "Nostria")
- `<meta property="og:title">` with dynamic content
- `<meta name="twitter:card">` present
- Server logs show "[SSR] Rendering..."
- Server logs show "[DataResolver] Loading social metadata..."

### ✗ Broken SSR
- Generic "Nostria" title only
- No Open Graph tags
- Server logs show "[DataResolver] Skipping - running in browser"
- Errors in server console

## Common Issues & Fixes

| Issue | Symptom | Fix |
|-------|---------|-----|
| Platform detection | Resolver skips on server | Use `isPlatformServer(PLATFORM_ID)` |
| API timeout | No metadata loaded | Add timeout/retry to HTTP calls |
| Async not completing | Tags missing from HTML | Use `await` in resolver |
| Client overwriting | Tags disappear after load | Use TransferState properly |
| CORS errors | Server can't fetch metadata | Check API CORS configuration |

## Key Files

- `src/server.ts` - Express SSR server
- `src/app/data-resolver.ts` - Server-side route resolver
- `src/app/services/meta.service.ts` - Meta tag management
- `src/app/app.routes.ts` - Route configuration with resolvers

## Log Messages

### Good Signs
```
[SSR] Rendering: GET /e/nevent1...
[DataResolver] Resolving route: e/nevent1...
[DataResolver] Is browser? false
[DataResolver] Loading social metadata for: nevent1...
[MetaService] Updating social metadata: { title: '...', ... }
[SSR] Successfully rendered: /e/nevent1...
```

### Warning Signs
```
[DataResolver] Is browser? true  ← Shouldn't happen on server
[DataResolver] Skipping - running in browser  ← Platform detection issue
[SSR] Error rendering  ← Something failed
```

## Testing Commands

```powershell
# Test specific route
curl http://localhost:4000/e/nevent1... -o test.html

# Check for meta tags
curl http://localhost:4000/e/nevent1... | Select-String "og:"

# View full response
curl http://localhost:4000/e/nevent1... -v

# Test with different user agent (like social media bot)
curl http://localhost:4000/e/nevent1... -H "User-Agent: facebookexternalhit/1.1"
```

## Social Media Testing Tools

1. **Facebook**: https://developers.facebook.com/tools/debug/
2. **Twitter**: https://cards-dev.twitter.com/validator  
3. **LinkedIn**: https://www.linkedin.com/post-inspector/

## Next Steps

1. Check server console for error messages
2. Verify resolver is configured for the route
3. Test metadata API endpoint directly
4. Review `docs/SSR_DEBUGGING_GUIDE.md` for detailed troubleshooting
