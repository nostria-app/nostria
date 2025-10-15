# Client Tag Display Feature

## Overview
Implemented a client indicator in the event component that displays which client was used to publish an event. The indicator shows a client logo image before the bookmark button in the event footer.

## Changes Made

### 1. Event Component TypeScript (`event.component.ts`)

**Service Injection:**
```typescript
localSettings = inject(LocalSettingsService);
```

**Client Logo Mapping:**
Added a comprehensive mapping table that associates client names with logo image paths:

```typescript
private readonly CLIENT_LOGO_MAP: Record<string, string> = {
  'nostria': 'logos/clients/nostria.png',
  'nosotros': 'logos/clients/nosotros.png',
  'damus deck': 'logos/clients/damus.png',
  'damus': 'logos/clients/damus.png',
  'amethyst': 'logos/clients/amethyst.png',
  'primal': 'logos/clients/primal.png',
  'snort': 'logos/clients/snort.png',
  'iris': 'logos/clients/iris.png',
  'coracle': 'logos/clients/coracle.png',
  'nos': 'logos/clients/nos.png',
  'current': 'logos/clients/current.png',
  'satellite': 'logos/clients/satellite.png',
  'habla': 'logos/clients/habla.png',
  'gossip': 'logos/clients/gossip.png',
  'freefrom': 'logos/clients/freefrom.png',
  'habla.news': 'logos/clients/habla.png',
  'nostrudel': 'logos/clients/nostrudel.png',
  'yakihonne': 'logos/clients/yakihonne.png',
  'lume': 'logos/clients/lume.png',
  'nostur': 'logos/clients/nostur.png',
  'nostore': 'logos/clients/nostore.png',
};
```

**Helper Methods:**

1. **`getClientTag(event)`**: Extracts the client tag value from an event's tags array
   - Returns `null` if no client tag is found
   - Looks for tags with format `['client', 'value']`

2. **`getClientLogo(clientName)`**: Maps a client name to a logo image path
   - Case-insensitive matching
   - Returns `null` for unknown clients (logo won't be displayed)

3. **`getClientDisplayName(clientName)`**: Returns properly capitalized display name
   - Maintains consistent capitalization for known clients
   - Falls back to the original client name for unknown clients

4. **`shouldShowClientTag()`**: Checks user's preference
   - Returns the value from `localSettings.showClientTag()`
   - Allows users to hide client indicators globally

### 2. Event Component Template (`event.component.html`)

**Added Client Indicator:**
Placed between the reactions row and bookmark button:

```html
@if (shouldShowClientTag() && getClientTag(targetItem.event) && getClientLogo(getClientTag(targetItem.event))) {
  <div 
    class="note-footer-right hide-small client-indicator" 
    [matTooltip]="'Published with ' + getClientDisplayName(getClientTag(targetItem.event))" 
    matTooltipPosition="below"
  >
    <img 
      [src]="getClientLogo(getClientTag(targetItem.event))" 
      [alt]="getClientDisplayName(getClientTag(targetItem.event)) + ' logo'"
      title="Client logo"
      class="client-logo"
    />
  </div>
}
```

**Features:**
- Only visible when user has enabled "Show Client Tag" in settings
- Only displays if the event has a client tag AND a logo is available
- Shows a tooltip with the full client name
- Displays client logo image (20x20px)
- Non-interactive display element (div container)
- Hidden on small screens (same as bookmark button)
- Fully accessible with alt text

### 3. Event Component Styles (`event.component.scss`)

**Client Indicator Styling:**
```scss
.client-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  padding: 8px;

  .client-logo {
    width: 20px;
    height: 20px;
    object-fit: contain;
    display: block;
    border-radius: 2px;
  }
}
```

**Features:**
- Subtle opacity (0.6) to indicate it's informational, not interactive
- Fixed logo size (20x20px)
- `object-fit: contain` ensures logos aren't distorted
- Small border radius (2px) for aesthetic polish
- Padding (8px) matches Material button spacing
- Flexbox layout for proper centering

## Currently Mapped Clients

| Client Name | Logo Path | Display Name |
|------------|-----------|--------------|
| nostria | logos/clients/nostria.png | Nostria |
| nosotros | logos/clients/nosotros.png | Nosotros |
| damus deck | logos/clients/damus.png | Damus Deck |
| damus | logos/clients/damus.png | Damus |
| amethyst | logos/clients/amethyst.png | Amethyst |
| primal | logos/clients/primal.png | Primal |
| snort | logos/clients/snort.png | Snort |
| iris | logos/clients/iris.png | Iris |
| coracle | logos/clients/coracle.png | Coracle |
| nos | logos/clients/nos.png | Nos |
| current | logos/clients/current.png | Current |
| satellite | logos/clients/satellite.png | Satellite |
| habla | logos/clients/habla.png | Habla |
| gossip | logos/clients/gossip.png | Gossip |
| freefrom | logos/clients/freefrom.png | FreeFrom |
| habla.news | logos/clients/habla.png | Habla.news |
| nostrudel | logos/clients/nostrudel.png | NoStrudel |
| yakihonne | logos/clients/yakihonne.png | YakiHonne |
| lume | logos/clients/lume.png | Lume |
| nostur | logos/clients/nostur.png | Nostur |
| nostore | logos/clients/nostore.png | Nostore |

### Logo Requirements
- Format: PNG (transparent background recommended)
- Size: At least 40x40px (will be displayed at 20x20px for crisp display on retina screens)
- Location: `public/logos/clients/`
- Naming: lowercase client name with `.png` extension

### Fallback Behavior
- **Unknown clients**: No logo displayed (indicator hidden)
- **No client tag**: Hidden (not displayed)

## User Experience

### Visibility Control
Users can control whether client indicators are shown via Settings → General → Client Tags:
- Toggle "Show Client Tag" on/off
- Setting applies globally to all events
- Enabled by default

### Display Behavior
1. Logo appears in the event footer, to the left of the bookmark button
2. Tooltip shows "Published with [Client Name]" on hover
3. Logo is non-interactive (disabled button)
4. Hidden on small screens to save space
5. Only shown when:
   - User has enabled "Show Client Tag" in settings
   - Event has a `client` tag
   - A logo exists for that client

## Adding New Clients

To add support for a new client:

1. **Add logo image** to `public/logos/clients/`:
   - Format: PNG with transparent background
   - Size: At least 40x40px (square)
   - Name: `clientname.png` (lowercase)

2. **Add to Logo Map** in `event.component.ts`:
```typescript
private readonly CLIENT_LOGO_MAP: Record<string, string> = {
  // ... existing mappings
  'new-client': 'logos/clients/new-client.png', // Add new client here
};
```

3. **Add Display Name** in `getClientDisplayName()`:
```typescript
const displayNames: Record<string, string> = {
  // ... existing names
  'new-client': 'New Client', // Add display name here
};
```

4. All client names are normalized to lowercase for matching

## Technical Details

### Tag Format
The client tag follows the Nostr convention:
```typescript
['client', 'client-name']
```

### Case Insensitivity
Client name matching is case-insensitive, so `"Nostria"`, `"NOSTRIA"`, and `"nostria"` all map to the same logo and display name.

### Image Loading
- Images are loaded on-demand when events are displayed
- Browser caching applies for performance
- Missing images will cause the indicator to not display

### Performance
- Only renders when conditions are met (user setting + tag presence + logo availability)
- Uses computed values and Angular's reactivity
- No additional API calls or heavy processing
- Images are small and cached by the browser

## Accessibility
- Full aria-label support for screen readers
- Alt text on images describes the client
- Tooltip provides additional context
- Follows WCAG guidelines for interactive elements

## Related Files
- `src/app/components/event/event.component.ts` - Main logic
- `src/app/components/event/event.component.html` - Template
- `src/app/components/event/event.component.scss` - Styling
- `src/app/services/local-settings.service.ts` - User preference storage
- `public/logos/clients/` - Client logo images

## Future Enhancements
- Allow users to customize logo mappings
- Add click action to filter by client
- Show client statistics on profiles
- Support for client-specific features/badges
- Automatic logo fetching from client metadata
