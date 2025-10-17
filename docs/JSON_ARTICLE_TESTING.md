# Testing JSON Article Rendering

## Test Cases

### Test 1: Simple Object
**Article Content:**
```json
{
  "title": "My First JSON Article",
  "author": "Alice",
  "version": "1.0",
  "published": true
}
```

**Expected Result:**
- Each key-value pair displayed in a clean grid
- Primitive values shown inline
- Proper color coding for keys

### Test 2: Nested Object
**Article Content:**
```json
{
  "user": {
    "name": "Bob",
    "email": "bob@nostr.com"
  },
  "settings": {
    "theme": "dark",
    "notifications": true
  }
}
```

**Expected Result:**
- Top-level keys shown
- Nested objects displayed in formatted code blocks
- Proper indentation for readability

### Test 3: Array Values
**Article Content:**
```json
{
  "tags": ["nostr", "bitcoin", "freedom"],
  "relays": [
    "wss://relay1.example.com",
    "wss://relay2.example.com"
  ],
  "count": 42
}
```

**Expected Result:**
- Array values shown in formatted JSON blocks
- Proper indentation for multi-line arrays
- Primitive value (count) shown inline

### Test 4: Mixed Complex Data
**Article Content:**
```json
{
  "profile": {
    "npub": "npub1...",
    "displayName": "Charlie",
    "bio": "Nostr enthusiast"
  },
  "stats": {
    "followers": 1234,
    "following": 567,
    "posts": 890
  },
  "metadata": {
    "client": "nostria",
    "version": "1.0.7",
    "features": ["lists", "media", "bookmarks"]
  },
  "isActive": true,
  "lastSeen": 1697500000
}
```

**Expected Result:**
- All nested objects shown in formatted blocks
- Primitive values at top level shown inline
- Arrays within nested objects formatted properly
- Responsive layout adjusts on mobile

### Test 5: Pure Array
**Article Content:**
```json
[
  {
    "id": 1,
    "name": "Item 1"
  },
  {
    "id": 2,
    "name": "Item 2"
  }
]
```

**Expected Result:**
- Entire array shown in formatted JSON block
- Proper indentation for nested objects

### Test 6: Invalid JSON (Fallback)
**Article Content:**
```
This is not JSON, just regular markdown content.

# Header
Some text here.
```

**Expected Result:**
- Renders as normal markdown
- No JSON formatting applied
- Headers and text styled normally

### Test 7: Edge Cases

#### Empty Object
```json
{}
```

**Expected Result:**
- Shows formatted empty object

#### Null Values
```json
{
  "name": "Test",
  "value": null,
  "active": true
}
```

**Expected Result:**
- Null displayed as "null" string
- Other values shown normally

#### Special Characters
```json
{
  "description": "Special chars: <>&\"'",
  "emoji": "🚀🌟💜",
  "url": "https://example.com/path?query=value"
}
```

**Expected Result:**
- Special characters properly escaped and displayed
- Emoji rendered correctly
- URLs shown as text (not clickable in JSON context)

## Manual Testing Steps

1. **Create Test Articles:**
   - Create kind 30023 events with JSON content
   - Add appropriate tags (title, published_at, etc.)
   - Publish to relays

2. **View in Feed:**
   - Check that JSON is detected and rendered
   - Verify color coding and formatting
   - Test expand/collapse if article is long

3. **Test Responsive:**
   - View on desktop (grid layout)
   - View on mobile (stacked layout)
   - Verify separator visibility changes

4. **Test Interactions:**
   - Hover over properties (should highlight)
   - Click "Open Article" button
   - Verify scrolling works for long JSON

5. **Test Fallback:**
   - Create article with markdown content
   - Verify normal rendering still works
   - Mix JSON and non-JSON articles in feed

## Visual Verification

### Check These Elements:
- [ ] JSON container has subtle background
- [ ] Keys are in primary color and bold
- [ ] Values are readable and properly formatted
- [ ] Complex values have code block styling
- [ ] Hover effects work smoothly
- [ ] Mobile layout stacks properly
- [ ] Color contrast is sufficient
- [ ] Font is monospace for JSON content

## Performance Testing

### Large JSON Objects:
```json
{
  "item1": { /* 50+ nested properties */ },
  "item2": { /* 50+ nested properties */ },
  // ... repeat for 100+ items
}
```

**Expected Result:**
- Renders without lag
- Scrolling is smooth
- No memory issues

## Integration Testing

1. Test with other article features:
   - Content warnings
   - Article tags
   - Summary display
   - Author information

2. Test with article actions:
   - "Read More" button
   - "Open Article" navigation
   - External links (if any)

3. Test in different contexts:
   - Feed view
   - Full article page
   - Profile page (if showing articles)
   - Search results
