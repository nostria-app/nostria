# JSON Content Rendering in Articles

## Overview
Added support for automatically detecting and rendering JSON content in article events (kind 30023). When an article's content field contains valid JSON, it is now displayed in a structured, easy-to-read format instead of raw text.

**This feature works in both:**
- Article list views (event feed previews) via `article-event.component`
- Article detail/full view via the article page component

## Implementation

### Detection Logic
The article component now checks if the content is valid JSON during rendering:

1. Content is trimmed and checked for JSON object (`{`) or array (`[`) syntax
2. Attempts to parse the content with `JSON.parse()`
3. Only treats objects and arrays as JSON content (primitives are treated as regular text)
4. If parsing fails, falls back to normal markdown rendering

### Rendering Behavior

#### JSON Objects
For JSON objects, each key-value pair is displayed in a structured grid:
- **Keys**: Displayed in primary color with bold font
- **Primitive values**: Displayed inline (strings, numbers, booleans, null)
- **Complex values**: Objects and arrays are shown in an expandable code block with syntax highlighting

#### JSON Arrays
Arrays are displayed as formatted JSON with proper indentation.

### Visual Design

#### Desktop View
- Grid layout with three columns: key, separator (`:`) , value
- Hover effect on each property for better readability
- Monospace font for technical accuracy
- Color-coded elements using Material Design tokens

#### Mobile View
- Stacked layout for better mobile experience
- Key on top, value below
- Separator hidden for cleaner appearance
- Full-width complex values

### Styling Features
- Container with subtle background and border
- Syntax highlighting for different value types
- Code blocks for nested objects/arrays with left border accent
- Responsive design that adapts to screen size
- Smooth hover transitions

## Usage Example

### Input (Article Content)
```json
{
  "name": "John Doe",
  "age": 30,
  "email": "john@example.com",
  "address": {
    "street": "123 Main St",
    "city": "Anytown",
    "zip": "12345"
  },
  "tags": ["developer", "nostr", "web3"]
}
```

### Output
The article will display:
- **name**: John Doe
- **age**: 30
- **email**: john@example.com
- **address**: (formatted JSON block)
  ```json
  {
    "street": "123 Main St",
    "city": "Anytown",
    "zip": "12345"
  }
  ```
- **tags**: (formatted JSON array)
  ```json
  ["developer", "nostr", "web3"]
  ```

## Technical Details

### Component Methods
- `tryParseJson()`: Safely attempts to parse content as JSON
- `getObjectKeys()`: Returns keys for template iteration
- `getObjectValue()`: Retrieves value by key
- `formatJsonValue()`: Formats primitive values for display
- `isPrimitive()`: Checks if value is primitive type
- `stringifyValue()`: Formats complex values with indentation

### Type Safety
- JSON data is typed as `Record<string, unknown> | unknown[] | null`
- All helper methods handle edge cases and null values
- Template uses proper type checking for rendering decisions

## Use Cases

### Configuration Files
Articles containing JSON configuration can be displayed cleanly:
```json
{
  "relays": ["wss://relay.example.com"],
  "timeout": 5000,
  "autoConnect": true
}
```

### API Responses
Sharing API data structures:
```json
{
  "status": "success",
  "data": {...},
  "timestamp": 1697500000
}
```

### Structured Data
Any structured data that benefits from key-value display:
```json
{
  "title": "Event Details",
  "date": "2025-10-17",
  "location": "Online",
  "participants": 42
}
```

## Fallback Behavior
- If content is not valid JSON, renders as normal markdown
- No errors shown to users
- Seamless experience regardless of content type
- Non-object JSON (single strings, numbers) treated as regular text

## Accessibility
- Proper semantic HTML structure
- Readable color contrasts using Material Design tokens
- Keyboard navigation support inherited from parent component
- Screen reader friendly with clear key-value relationships

## Performance Notes
- JSON parsing happens once during effect execution
- Parsed data is cached in signals
- No re-parsing on template re-renders
- Large JSON objects handled efficiently with virtualization-friendly structure

## Files Modified
- `src/app/components/event-types/article-event.component.ts` - Added JSON detection and helper methods for article list view
- `src/app/components/event-types/article-event.component.html` - Added JSON rendering template for article list view
- `src/app/components/event-types/article-event.component.scss` - Added JSON styling with responsive design for article list view
- `src/app/pages/article/article.component.ts` - Added JSON detection and helper methods for article detail view
- `src/app/pages/article/article.component.html` - Added JSON rendering template for article detail view
- `src/app/pages/article/article.component.scss` - Added JSON styling with responsive design for article detail view

## Component Separation

### Article List View (`article-event.component`)
- Used in feeds and article listings
- Shows article preview with expand/collapse
- JSON content is rendered in compact preview mode
- Same JSON detection and rendering logic

### Article Detail View (`article.component` page)
- Full article page when clicking "Open Article"
- Shows complete article with full header, metadata, and actions
- JSON content is rendered with enhanced styling for better readability
- Larger fonts and more spacing for comfortable reading

Both components share the same:
- JSON detection logic (`tryParseJson`)
- Helper methods for rendering (getObjectKeys, isPrimitive, formatJsonValue, etc.)
- Visual styling approach (grid layout, color coding, responsive design)
- Fallback behavior for non-JSON content
