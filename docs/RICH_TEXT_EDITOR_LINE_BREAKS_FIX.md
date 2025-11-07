# Rich Text Editor Line Breaks, Blockquote, and Paragraph Fix

## Problems

### 1. Line Breaks Lost in Preview
When editing in the rich text editor, single line breaks were being lost in the preview. This was inconsistent with how Markdown should be formatted for articles.

### 2. Blockquotes Disappearing
When switching between rich text, markdown, and preview modes multiple times, blockquotes would disappear. The `>` character was being lost during conversion.

### 3. Double Line Breaks (Paragraphs) Disappearing
When creating paragraphs with double line breaks (`\n\n`) and toggling between editor modes, the paragraph breaks would collapse into single line breaks or disappear entirely.

## Root Cause

### Line Breaks Issue
The issue was caused by inconsistent Markdown parsing across different parts of the application:

1. **Format Service** (`format.service.ts`) used `marked.parse()` with `breaks: true` option, which treats single newlines as `<br>` tags (GitHub Flavored Markdown behavior)
2. **Rich Text Editor** (`rich-text-editor.component.ts`) used custom regex-based conversion that didn't properly handle line breaks
3. **Article Editor Preview** (`editor.component.ts`) used `marked.parse()` without any configuration, using default settings
4. When converting from rich text back to markdown, line breaks weren't being preserved correctly

### Blockquote Issue
The blockquote conversion had an order-of-operations problem:

1. `marked.parse()` converts `> text` to `<blockquote><p>text</p></blockquote>` (wrapping content in paragraph tags)
2. During HTML-to-markdown conversion, blockquotes were processed BEFORE removing internal `<p>` tags
3. This left the `>` character exposed to be stripped by the final HTML tag removal regex
4. The `>` character in the markdown syntax was lost, causing the blockquote to disappear

### Paragraph Break Issue
The paragraph handling had a browser compatibility problem:

1. Different browsers use different HTML elements in contenteditable:
   - Chrome/Edge create `<div>` elements when you press Enter
   - `marked.parse()` creates `<p>` elements from `\n\n` in markdown
2. The original code only converted `<div>` to single newlines, not double
3. When converting back to markdown, `<div>Para</div>` became `\nPara` instead of `Para\n\n`
4. Paragraph breaks were lost during mode switching

## Solution

### 1. Standardized Marked.js Configuration
All markdown parsing now uses the same `marked` configuration:

```typescript
marked.use({
  gfm: true,        // GitHub Flavored Markdown
  breaks: true,     // Single line breaks become <br>
  pedantic: false,  // Don't be overly strict
});
```

### 2. Updated Rich Text Editor Component

**File**: `src/app/components/rich-text-editor/rich-text-editor.component.ts`

**Changes**:
- Added `import { marked } from 'marked'`
- Replaced custom regex-based `renderMarkdownToEditor()` with `marked.parse()` for consistency
- Updated `convertMarkdownToHtml()` to use `marked.parse()` instead of regex
- **Normalized browser-specific paragraph handling**:
  - Added `<div>` to `<p>` normalization at the start of conversion
  - Chrome/Edge `<div>` elements are now treated as paragraphs
  - `<div><br></div>` (blank lines) converted to `<p><br></p>`
- **Fixed blockquote conversion order** in `convertRichTextToMarkdown()`:
  - Blockquotes are now processed BEFORE paragraph tags
  - Internal `<p>` and `<br>` tags within blockquotes are cleaned up first
  - Multi-line blockquotes are properly split and prefixed with `> ` on each line
- **Improved paragraph handling**:
  - Added `/s` flag (dotall) to `<p>` regex to match content with newlines
  - Trim whitespace from paragraph content before conversion
  - Empty paragraphs properly converted to blank lines
  - `<p>` tags now consistently convert to double newlines (`\n\n`)
- Improved `convertRichTextToMarkdown()` to better preserve line breaks:
  - `<br>` tags now convert to single newlines (`\n`)
  - `<p>` tags convert to double newlines (`\n\n`) for paragraph separation
  - Removed extra blank lines while preserving intentional line breaks

### 3. Updated Article Editor Component

**File**: `src/app/pages/article/editor/editor.component.ts`

**Changes**:
- Added `marked.use()` configuration to `markdownHtml` computed property
- Now uses the same settings as the rest of the application

## Benefits

1. **Consistency**: All markdown parsing uses the same library and configuration
2. **Predictability**: What you see in the rich text editor matches what appears in the preview
3. **Standards Compliance**: Uses GitHub Flavored Markdown (GFM) with proper line break handling
4. **Better Line Handling**: Single line breaks are preserved as `<br>` tags, double line breaks create new paragraphs
5. **Maintainability**: Less custom regex code, more reliance on the well-tested `marked` library
6. **Blockquote Preservation**: Blockquotes now survive multiple mode switches and maintain proper formatting
7. **Browser Compatibility**: Handles paragraph creation differences between Chrome/Edge (`<div>`) and Firefox (`<p>`)
8. **Paragraph Preservation**: Double line breaks (paragraph separators) are now preserved through mode switches

## How Line Breaks Work Now

### Single Line Break (One Enter)
```markdown
Line one
Line two
```

Renders as:
```html
<p>Line one<br>
Line two</p>
```

### Paragraph Break (Two Enters)
```markdown
Paragraph one

Paragraph two
```

Renders as:
```html
<p>Paragraph one</p>
<p>Paragraph two</p>
```

## How Blockquotes Work Now

### Single-line Blockquote
```markdown
> This is a quote
```

Renders as:
```html
<blockquote>
<p>This is a quote</p>
</blockquote>
```

### Multi-line Blockquote
```markdown
> Line one
> Line two
> Line three
```

Renders as:
```html
<blockquote>
<p>Line one<br>
Line two<br>
Line three</p>
</blockquote>
```

**Conversion Process**: When converting from HTML back to markdown, the component now:
1. Identifies `<blockquote>` tags
2. Removes internal `<p>` and `<br>` tags
3. Splits content by newlines
4. Prefixes each line with `> ` to maintain markdown syntax
5. This ensures blockquotes survive multiple mode switches

## Testing Recommendations

1. **Line Breaks Testing**:
   - Type text with single line breaks in the rich text editor
   - Toggle to markdown mode and verify line breaks are preserved as single `\n`
   - Toggle back to rich text and verify rendering matches
   - Switch to Preview tab and verify it renders identically
   - Publish the article and verify it displays correctly

2. **Blockquote Testing**:
   - Create a blockquote using the quote button in rich text mode
   - Add multiple lines of text within the blockquote
   - Toggle to markdown mode - should show each line prefixed with `> `
   - Toggle back to rich text mode - blockquote should still be visible
   - Repeat the toggle multiple times - blockquote should not disappear
   - Switch to Preview tab - blockquote should render correctly
   - Test with blockquotes containing bold, italic, and links

3. **Paragraph Break Testing**:
   - Type a paragraph in rich text or markdown mode
   - Press Enter twice to create a paragraph break
   - Type another paragraph
   - Toggle between rich text and markdown modes multiple times
   - Verify the double line break (blank line) between paragraphs is preserved
   - In markdown mode, should see `\n\n` between paragraphs
   - In rich text mode, should see visual spacing between paragraphs
   - Test in both Chrome/Edge and Firefox to verify browser compatibility

## Related Files
- `src/app/components/rich-text-editor/rich-text-editor.component.ts`
- `src/app/pages/article/editor/editor.component.ts`
- `src/app/services/format/format.service.ts`

## Notes on marked.js v17
The project recently upgraded to marked v17. The `breaks: true` option is part of GitHub Flavored Markdown spec and enables the expected behavior where single newlines create line breaks in the output. This is standard for modern markdown editors and matches user expectations.
