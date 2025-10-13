# Fullscreen Media Player Z-Index Fix

## Issue
The mobile navigation menu was appearing above the fullscreen media player, blocking the resize/exit buttons and other controls. Even though the `.fullscreen-mode` class had `z-index: 10000`, which is higher than the mobile nav's `z-index: 1000`, the mobile menu was still rendering on top.

## Root Cause
The issue was caused by **CSS stacking contexts**. The media player component is nested inside the `mat-sidenav-content` element, while the mobile navigation is at the root level of the app. Each of these creates its own stacking context, and z-index values only work within the same stacking context.

### HTML Structure
```html
<mat-sidenav-container>
  <mat-sidenav-content>
    <router-outlet></router-outlet>
    <app-media-player [footer]="true"></app-media-player>  <!-- Inside sidenav -->
  </mat-sidenav-content>
</mat-sidenav-container>

<div class="mobile-nav">  <!-- At root level, outside sidenav -->
  <!-- Navigation buttons -->
</div>
```

Because the `app-media-player` component is nested inside `mat-sidenav-content`, its child elements (even with high z-index) cannot escape the stacking context created by the Material sidenav.

## Solution

### 1. Add Host Class Binding

**File:** `src/app/components/media-player/media-player.component.ts`

Added host bindings to apply classes directly to the `:host` element (the `app-media-player` component itself):

```typescript
@Component({
  selector: 'app-media-player',
  // ... other config
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.fullscreen-host]': 'layout.fullscreenMediaPlayer()',
  },
})
export class MediaPlayerComponent implements AfterViewInit, OnInit, OnDestroy {
  // ...
}
```

**How it works:**
- `[class.footer-mode]`: Applies when component is in footer mode
- `[class.fullscreen-host]`: Applies when fullscreen is active (reads from `layout.fullscreenMediaPlayer()` signal)
- These classes are applied to the `<app-media-player>` element itself, not just its children

### 2. Style the Host Element for Fullscreen

**File:** `src/app/components/media-player/media-player.component.scss`

Added styles to the `:host` selector to position the entire component above everything when fullscreen:

```scss
:host {
  // ... existing styles
  
  /* Fullscreen mode - ensure host element has highest z-index */
  &.fullscreen-host {
    z-index: 10000 !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
  }
}
```

**Why this works:**
- The `:host` selector styles the `<app-media-player>` custom element itself
- By making the entire component `position: fixed` with `z-index: 10000`, it breaks out of the sidenav's stacking context
- The component is now positioned at the document root level, same as the mobile nav
- `z-index: 10000` (fullscreen) > `z-index: 1000` (mobile nav), so fullscreen wins

## Technical Details

### CSS Stacking Contexts
A stacking context is created by:
- Root element of the document
- Elements with `position` values other than `static` and `z-index` values
- Elements with `opacity` less than 1
- Many other CSS properties (transforms, filters, etc.)

Within a stacking context, child elements' z-index values only compare against siblings within the same context. They cannot "break out" to compare with elements in a parent or different stacking context.

### Before the Fix
```
Document Root
├─ mat-sidenav-content (creates stacking context)
│  └─ app-media-player (z-index only works within sidenav context)
│     └─ .fullscreen-mode (z-index: 10000, but trapped in sidenav context)
└─ .mobile-nav (z-index: 1000, at root context) ← This rendered on top!
```

### After the Fix
```
Document Root
├─ mat-sidenav-content
│  └─ [collapsed or hidden by fullscreen]
├─ app-media-player.fullscreen-host (z-index: 10000, position: fixed)
│  └─ .fullscreen-mode ← Now properly positioned
└─ .mobile-nav (z-index: 1000) ← Now rendered behind fullscreen
```

## Z-Index Hierarchy

Current z-index values in the app:
- **10000**: Fullscreen media player (both `:host.fullscreen-host` and `.fullscreen-mode`)
- **1500**: Media player toolbar (default)
- **1001**: Profile sidenav
- **1000**: Mobile navigation

## Benefits

1. **Proper Layering**: Fullscreen media player now appears above all other UI elements
2. **No Stacking Context Issues**: The host-level positioning escapes the sidenav container
3. **Clean Solution**: Uses Angular's recommended `host` property instead of deprecated `@HostBinding`
4. **Future-Proof**: Works with any future UI elements at similar z-index levels

## Testing

### Test Scenarios

1. **Desktop Mode**: Fullscreen should work normally (no mobile nav visible)
2. **Mobile Mode**: 
   - Open fullscreen media player
   - Verify mobile nav is hidden behind the fullscreen player
   - Verify resize/exit buttons are clickable
   - Verify video/audio content is fully visible

3. **Exit Fullscreen**:
   - Click exit button
   - Verify smooth collapse animation
   - Verify mobile nav reappears normally

### Browser Testing
- Chrome/Edge (Chromium)
- Firefox
- Safari (iOS and macOS)
- Mobile browsers

## Related Files

- `src/app/components/media-player/media-player.component.ts` - Host class bindings
- `src/app/components/media-player/media-player.component.scss` - Host fullscreen styles
- `src/app/app.scss` - Mobile nav z-index definition
- `src/app/app.html` - HTML structure showing nesting

## Notes

- The `-webkit-app-region` CSS warnings are pre-existing and unrelated to this fix
- These properties are for PWA window controls overlay support on Chromium browsers
- They are safely ignored by browsers that don't support them

## Further Reading

- [MDN: CSS Stacking Context](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Understanding_z-index/Stacking_context)
- [Angular Host Element Styling](https://angular.io/guide/component-styles#host)
- [CSS Z-Index and Stacking](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Understanding_z-index)
