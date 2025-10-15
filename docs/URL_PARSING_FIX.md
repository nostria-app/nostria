# URL Parsing Fix - Fragment URLs Breaking Issue

## Problem
URLs containing fragments (hash symbols `#`) and certain punctuation were being incorrectly parsed and split into multiple tokens. For example, the URL:

```
https://hzrd149.github.io/applesauce/examples/#outbox/relay-selection
```

Was being split after "github" and displayed as:
```
https://hzrd149.github  .io/applesauce/examples/#outbox/relay-selection
```

## Root Cause
The URL parsing regex in `parsing.service.ts` had two issues:

1. **Negative character class too restrictive**: The pattern `[^\s##)\]\}>]+` was excluding `#` characters, preventing URLs with fragments from being matched completely.

2. **Lookahead pattern too aggressive**: The lookahead pattern `(?=\s|##LINEBREAK##|$|[),.;!?:])` included `.` and `:` as URL terminators, causing the regex to stop matching when encountering these characters that are valid in URLs.

## Solution
Updated the URL regex pattern in `parsing.service.ts` (line ~276):

### Before:
```typescript
const urlRegex = /(https?:\/\/[^\s##)\]\}>]+)(?=\s|##LINEBREAK##|$|[),.;!?:])/g;
```

### After:
```typescript
const urlRegex = /(https?:\/\/[^\s)}\]>]+?)(?=\s|##LINEBREAK##|$|[),;!?]\s|[),;!?]$)/g;
```

### Key Changes:
1. **Removed `#` from exclusion**: Changed `[^\s##)\]\}>]` to `[^\s)}\]>]` to allow hash symbols in URLs
2. **Removed `.` and `:` from terminators**: These are valid URL characters (in paths, query strings, and fragments)
3. **Made pattern lazy**: Added `?` after `+` to make the match non-greedy
4. **Improved terminator lookahead**: Changed `[),.;!?:]` to `[),;!?]\s|[),;!?]$` to only stop at punctuation followed by whitespace or at end of string

## Additional Enhancement
Added CSS class `.url-link` to improve URL display in `note-content.component.scss`:

```scss
.url-link {
  overflow-wrap: break-word;
  word-break: break-word;
}
```

This ensures that very long URLs wrap properly within their container without breaking the layout.

## Test Cases
The fix now correctly handles:
- ✅ URLs with fragments: `https://example.com/path#section`
- ✅ URLs with ports: `https://example.com:8080/path`
- ✅ URLs with multiple dots: `https://sub.domain.example.com/path`
- ✅ URLs with query parameters: `https://example.com?foo=bar&baz=qux`
- ✅ URLs followed by punctuation: `https://example.com, more text`
- ✅ URLs in parentheses: `(https://example.com)`

## Files Modified
1. `src/app/services/parsing.service.ts` - Updated URL regex pattern
2. `src/app/components/content/note-content/note-content.component.html` - Added `url-link` class
3. `src/app/components/content/note-content/note-content.component.scss` - Added URL styling
