# How to Use External Link Handler

## Overview

The External Link Handler allows you to configure which external Nostr client domains should open within Nostria instead of opening in a new browser tab. This provides a seamless experience when navigating between different Nostr clients.

## Quick Start

1. Open Nostria app
2. Navigate to **Settings** → **General**
3. Scroll to the **External Links** section
4. View the list of default configured domains:
   - primal.net
   - snort.social
   - iris.to
   - coracle.social
   - nostur.com

## Adding a Domain

To add a new domain to handle internally:

1. In the **External Links** section, find the "Add Domain" input field
2. Type the domain name (e.g., `example.com`)
   - Don't include `http://` or `https://`
   - Don't include `www.`
   - Just the domain name
3. Click the **Add** button or press Enter
4. The domain will appear in the list above

## Removing a Domain

To stop handling a domain internally:

1. Find the domain in the list
2. Click the **X** button next to it
3. The domain will be removed from the list

## Resetting to Defaults

To restore the original default domains:

1. Click the **Reset to Defaults** button
2. All custom domains will be removed
3. The default domains will be restored

## How It Works

Once a domain is configured:

### Normal Click
- When you click a link to a configured domain (e.g., `https://primal.net/e/note1...`)
- The app will recognize it and route you to the equivalent internal page
- The content opens within Nostria (no new tab)

### Special Key Combinations
You can still open links in a new tab using:
- **Windows/Linux:** Ctrl + Click
- **Mac:** Cmd + Click
- **Any Platform:** Shift + Click

These browser conventions continue to work as expected.

## Supported URL Patterns

The handler recognizes these common Nostr URL patterns:

| Pattern | Internal Route | Example |
|---------|----------------|---------|
| `/p/{npub}` or `/profile/{npub}` | Profile page | `primal.net/p/npub1...` → `/p/npub1...` |
| `/e/{note}` or `/event/{note}` | Event/Note page | `iris.to/e/note1...` → `/e/note1...` |
| `/e/{nevent}` | Event page | `snort.social/e/nevent1...` → `/e/nevent1...` |
| `/a/{naddr}` or `/article/{naddr}` | Article page | `coracle.social/a/naddr1...` → `/a/naddr1...` |

## Examples

### Viewing a Profile
1. You see a link: `https://primal.net/p/npub1abc123...`
2. Click it normally
3. Opens in Nostria at `/p/npub1abc123...`
4. Shows the profile within your app

### Reading a Note
1. You see a link: `https://snort.social/e/note1xyz789...`
2. Click it normally
3. Opens in Nostria at `/e/note1xyz789...`
4. Shows the note within your app

### Opening in Browser (When Needed)
1. You see a link to any configured domain
2. Hold Ctrl (or Cmd on Mac) and click
3. Opens in a new browser tab
4. Useful when you want to compare or share

## Where It Works

The External Link Handler works in:
- ✅ Article content (long-form posts)
- ✅ Note content (short-form posts)
- ✅ Web browser (desktop and mobile)
- ✅ Progressive Web App (PWA)
- ✅ Desktop app (Tauri)

## Troubleshooting

### Link Doesn't Open in App

**Problem:** Clicked a link to a configured domain but it opened in browser

**Solutions:**
- Check that the domain is in your configured list
- Make sure you're not holding Ctrl/Cmd/Shift when clicking
- Verify the URL matches a supported pattern
- Try refreshing the page and clicking again

### Domain Won't Add

**Problem:** Typed a domain but can't add it

**Solutions:**
- Make sure you entered just the domain name (no protocol)
- Remove any trailing slashes
- Remove `www.` from the start
- Example: Use `example.com` not `https://www.example.com/`

### Want to Temporarily Disable

**Problem:** Want to open a link in browser without removing the domain

**Solution:**
- Hold Ctrl (Windows/Linux) or Cmd (Mac) while clicking
- This will open the link in a new tab without affecting your settings

## Privacy & Security

- Configuration is stored locally on your device only
- Not synced across devices (each device has its own settings)
- Links still use secure `rel="noopener noreferrer"` attributes
- No data is sent to external servers for link handling

## Tips

1. **Start with defaults:** The default domains cover most popular Nostr clients
2. **Add as needed:** Only add domains you frequently visit
3. **Clean up regularly:** Remove domains you no longer use
4. **Use modifier keys:** Remember Ctrl/Cmd+Click when you need a new tab
5. **Check the URL:** Make sure links follow the standard Nostr URL patterns

## Need Help?

If you encounter issues:
1. Check this guide for troubleshooting steps
2. Try resetting to defaults
3. Report issues on GitHub: https://github.com/nostria-app/nostria/issues

## Future Enhancements

Planned improvements include:
- Auto-detection of Nostr client domains
- Wildcard domain matching (e.g., `*.example.com`)
- Import/export configurations
- Sync settings via Nostr profile
- Support for more URL patterns
