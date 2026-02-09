# Codebase Improvement Tasks

The AI agent will execute each unchecked task sequentially. Pick ONE unchecked task, make focused improvements, run lint and build, then commit. Do not try to do everything at once.

**Important:** Read `AGENTS.md` before making any changes. Follow all project conventions.

---

## 1. Migrate Legacy `@Input()` / `@Output()` to Signal APIs

Replace `@Input()` with `input()` and `@Output()` with `output()` per Angular 21+ conventions.

- [x] Migrate `@Input()` and `@Output()` in `src/app/components/rich-text-editor/rich-text-editor.component.ts` (lines 57-63) -- 2 inputs, 2 outputs with setter/EventEmitter patterns
- [x] Migrate `@Input()` in `src/app/components/content/content.component.ts` (line 107) -- setter-based input
- [x] Migrate `@Input()` in `src/app/components/audio-player/audio-player.component.ts` (lines 18-20) -- 3 simple inputs
- [ ] Migrate `@Input()` in `src/app/components/social-preview/social-preview.component.ts` (line 29) -- setter-based input
- [ ] Migrate `@Input()` in `src/app/pages/profile/profile-reads/profile-reads.component.ts` (line 53)
- [ ] Migrate `@Output()` in `src/app/pages/badges/badge/badge.component.ts` (lines 54-56) -- 3 EventEmitter outputs

---

## 2. Replace Constructor Injection with `inject()`

These Angular components use constructor-based DI instead of `inject()`.

- [ ] Refactor `src/app/pages/calendar/event-details-dialog/event-details-dialog.component.ts` (lines 295-298) -- `MatDialogRef` + `MAT_DIALOG_DATA` constructor injection
- [ ] Refactor `src/app/pages/bookmarks/bookmark-category-dialog/bookmark-category-dialog.component.ts` (lines 68-71) -- `MAT_DIALOG_DATA` + `MatDialogRef` constructor injection
- [ ] Refactor `src/app/pages/media-queue/add-media-dialog/add-media-dialog.ts` (lines 35-38) -- `MatDialogRef` + `MAT_DIALOG_DATA` constructor injection

---

## 3. Replace `[ngClass]` with Native Class Bindings

The codebase has migrated away from `*ngIf`, `*ngFor`, `*ngSwitch`, and `[ngStyle]`, but `[ngClass]` remains in 9 files.

- [ ] Replace `[ngClass]` in `src/app/app.html` (line 36) with `[class]` binding
- [ ] Replace `[ngClass]` in `src/app/components/user-profile/user-profile.component.html` (lines 9, 44, 144, 174, 203, 232) -- 6 occurrences, uses array syntax
- [ ] Replace `[ngClass]` in `src/app/pages/feeds/feeds.component.html` (line 1)
- [ ] Replace `[ngClass]` in `src/app/pages/people/people.component.html` (line 242)
- [ ] Replace `[ngClass]` in `src/app/pages/settings/relays/relays.component.html` (lines 348, 488)
- [ ] Replace `[ngClass]` in `src/app/components/publish-dialog/publish-dialog.component.html` (line 120)
- [ ] Replace `[ngClass]` in `src/app/components/video-player/video-player.component.html` (line 2)
- [ ] Replace `[ngClass]` in `src/app/components/event/repost-button/repost-button.component.html` (line 3)
- [ ] Replace `[ngClass]` in `src/app/components/report-dialog/report-dialog.component.html` (line 122)
- [ ] Replace `[ngClass]` in `src/app/components/confirm-dialog/confirm-dialog.component.html` (line 9)

---

## 4. Replace `@HostListener` with `host: {}` in Component Decorator

- [ ] Replace `@HostListener` in `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` (lines 672, 1924) -- `document:mousedown` and `document:keydown`
- [ ] Replace `@HostListener` in `src/app/components/inline-reply-editor/inline-reply-editor.component.ts` (line 226) -- `document:mousedown`
- [ ] Replace `@HostListener` in `src/app/pages/music/music.component.ts` (line 122) -- `window:resize`
- [ ] Replace `@HostListener` in `src/app/components/video-controls/video-controls.component.ts` (line 317) -- `document:keydown`
- [ ] Replace `@HostListener` in `src/app/components/user-profile/hover-card/profile-hover-card.component.ts` (line 486) -- `click`
- [ ] Replace `@HostListener` in `src/app/components/media-preview-dialog/media-preview.component.ts` (line 166) -- `window:keydown`

---

## 5. Remove Explicit `standalone: true`

Default in Angular 21+, should not be set explicitly.

- [ ] Remove `standalone: true` from `src/app/components/login-dialog/login-dialog.component.ts` (line 45)

---

## 6. Add `ChangeDetectionStrategy.OnPush` to Components

210 out of 329 components are missing OnPush. Fix in batches by directory.

- [ ] Add OnPush to all components in `src/app/components/event-types/` (~12 files: article-event, audio-event, emoji-set-event, live-event, music-event, people-set-event, photo-event, playlist-event, poll-event, profile-update-event, starter-pack-event, video-event)
- [ ] Add OnPush to all components in `src/app/components/event/` (~4 files: header, reply-button, repost-button, translate-dialog)
- [ ] Add OnPush to all components in `src/app/components/media-player/` (~4 files: media-player, live-stream-player, video-player, youtube-player)
- [ ] Add OnPush to all components in `src/app/components/user-profile/` (~3 files: user-profile, display-name, hover-card)
- [ ] Add OnPush to dialog components in `src/app/components/` (~15 files: confirm-dialog, custom-dialog, database-error-dialog, image-url-dialog, install-dialog, login-dialog, model-load-dialog, pin-prompt-dialog, publish-dialog, qrcode-scan-dialog, reactions-dialog, report-dialog, reports-dialog, signing-dialog, text-input-dialog)
- [ ] Add OnPush to remaining components in `src/app/components/` (~30+ files: article, article-display, article-editor-dialog, blocked-content, bolt11-invoice, bolt12-offer, bookmark-list-selector, cashu-token, command-palette-dialog, comment, comment-editor-dialog, comments-list, content-warning, create-list-dialog, create-menu, create-options-sheet, credentials-backup-prompt, date-toggle, debug-panel, emoji-set-mention, empty, favorites-overlay, floating-toolbar, followset, game-hover-card, media-preview, media-with-comments-dialog, music-embed, music-playlist-card, music-track-menu, navigation-context-menu, playlist-embed, poll-card, poll-details-dialog, push-notification-prompt, qr-code, relay-diagnostics, relay-publish-selector, search-results, setup-new-account-dialog, share-article-dialog, shoutout-overlay, sleep-mode-overlay, standalone-login-dialog, standalone-terms-dialog, start-chat-dialog, storage-debug, storage-stats, stream-info-bar, terms-of-use-dialog, timeline-hover-card, video-player, welcome, whats-new-dialog, zap-dialog, zap-display, zap-history)
- [ ] Add OnPush to all page components in `src/app/pages/badges/` (~4 files)
- [ ] Add OnPush to all page components in `src/app/pages/bookmarks/` (~4 files)
- [ ] Add OnPush to all page components in `src/app/pages/calendar/` (~2 dialog files)
- [ ] Add OnPush to all page components in `src/app/pages/collections/` (~5 files)
- [ ] Add OnPush to all page components in `src/app/pages/media/` (~7 files)
- [ ] Add OnPush to all page components in `src/app/pages/messages/` (~1 file)
- [ ] Add OnPush to all page components in `src/app/pages/music/` (~9 files)
- [ ] Add OnPush to all page components in `src/app/pages/notifications/` (~3 files)
- [ ] Add OnPush to all page components in `src/app/pages/people/` (~8 files)
- [ ] Add OnPush to all page components in `src/app/pages/playlists/` (~4 files)
- [ ] Add OnPush to all page components in `src/app/pages/premium/` (~4 files)
- [ ] Add OnPush to all page components in `src/app/pages/profile/` (~12 files)
- [ ] Add OnPush to all page components in `src/app/pages/settings/` (~10 files)
- [ ] Add OnPush to remaining page components (article, articles, delete-account, delete-event, event, invite, lists, memos, polls, stream-viewer, streams, youtube, zap-detail)
- [ ] Add OnPush to non-`.component.ts` files: `app.ts`, `introduction.ts`, `link.ts`, `navigation.ts`, `ai.ts`, `add-media-dialog.ts`, `list.ts`, `main.ts`, `settings.ts`, `algorithm.ts`

---

## 7. Type Safety -- Replace `any` with Proper Types

~520 occurrences of `any` across 62 files. Fix in batches by severity.

- [ ] Replace `any` types in `src/app/pages/feeds/feeds.component.ts` (~18 occurrences) -- event parameter types should use `NostrEvent` interface
- [ ] Replace `any` types in `src/app/services/nostr.service.ts` (~12 occurrences) -- event templates, info objects, publish queue
- [ ] Replace `any` types in `src/app/services/messaging.service.ts` (~8 occurrences) -- message types, subscription types
- [ ] Replace `any` types in `src/app/services/layout.service.ts` (~6 occurrences) -- dialog refs, timer, clipboard, search input
- [ ] Replace `any` types in `src/app/services/feed.service.ts` (~4 occurrences) -- filter types, migration types
- [ ] Replace `any` types in `src/app/services/bookmark.service.ts` (~7 occurrences) -- bookmark computed signals should have proper types
- [ ] Replace `any` types in `src/app/pages/profile/details/details.component.ts` (~4 occurrences) -- followingList, mutualConnectionsList, userProfile, info signals
- [ ] Replace `any` types in `src/app/pages/messages/messages.component.ts` (~4 occurrences) -- subscription and timer types should use `ReturnType<typeof setTimeout>`
- [ ] Replace `any` types in `src/app/services/badge.service.ts` (~4 occurrences) -- badge issuer/recipient record types
- [ ] Replace `any` types in `src/app/services/meta.service.ts` (~4 occurrences) -- tags parameter should use `string[][]`
- [ ] Replace `any` types in `src/app/services/parsing.service.ts` (~7 occurrences) -- parsed result types
- [ ] Replace `any` types in `src/app/services/route-data.service.ts` (~4 occurrences) -- route data, flatten routes
- [ ] Replace `any` types in `src/app/services/url-update.service.ts` (~4 occurrences) -- commands, extras, query params
- [ ] Replace `any` types in `src/app/services/relays/shared-relay.ts` (~8 occurrences) -- filter and cache types
- [ ] Replace `any` types in `src/app/services/relays/relay.ts`, `relay-pool.ts` (~6 occurrences) -- lazy service references
- [ ] Replace `any` types in `src/app/services/publish-queue.ts` (~3 occurrences) -- nostr and event queue types
- [ ] Replace `any` types in `src/app/services/deletion-filter.service.ts` (~3 occurrences) -- lazy service ref pattern
- [ ] Replace `any` types in `src/app/services/web-request.ts` (line 29) -- `fetchJson` return type
- [ ] Replace `any` types in `src/app/services/utilities.service.ts` (~2 occurrences) -- parseContent, decode
- [ ] Replace `any` types in `src/app/data-resolver.ts` (~5 occurrences) -- state key, WebSocket, event/metadata types
- [ ] Replace `any` types in `src/app/interfaces.ts` (~2 occurrences) -- `data: any` and `load(): Promise<any>`
- [ ] Replace `any` types in `src/app/pipes/name.pipe.ts` (line 8) -- transform parameter
- [ ] Replace `any` types in `src/app/workers/ai.worker.ts` (~16 occurrences) -- ML model types, payload types
- [ ] Replace `any` types in remaining components: user-profile, profile-display-name, note-content, right-panel-container, music-playlist-card, navigation, about, logs-settings, relay-info-dialog, relays, share-target, upgrade, audio-record-dialog, create-event-dialog, edit-music-playlist-dialog
- [ ] Replace `any` types in remaining services: cache.ts, favorites.service.ts, format/markdownRenderer.ts, game-hover-card.service.ts, badge-hover-card.service.ts, timeline-hover-card.service.ts, profile-hover-card.service.ts, profile-tracking.service.ts, right-panel.service.ts, media-player.service.ts, nostr-protocol.service.ts, webpush.service.ts

---

## 8. Error Handling Improvements

### Unprotected fetch/await calls

- [ ] Wrap `await fetch()` in try-catch in `src/app/services/webpush.service.ts` (line 296) -- fetch before try block
- [ ] Add try-catch to `updateMetadata()` in `src/app/services/media.service.ts` (lines 134-151) -- entire async method unprotected
- [ ] Fix nested throw in catch block of `src/app/services/cors-proxy.service.ts` (line 45) -- fallback fetch in catch can throw

### `.then()` without `.catch()`

- [ ] Add `.catch()` to `navigator.clipboard.writeText().then()` in `src/app/components/debug-panel/debug-panel.component.ts` (line 335)
- [ ] Add `.catch()` to `navigator.clipboard.writeText().then()` in `src/app/components/share-article-dialog/share-article-dialog.component.ts` (line 944)
- [ ] Add `.catch()` to `this.uploadFiles().then()` in `src/app/components/rich-text-editor/rich-text-editor.component.ts` (line 674)
- [ ] Add `.catch()` to `this.loadZaps().then()` in `src/app/pages/music/song-detail/song-detail.component.ts` (line 695)
- [ ] Add `.catch()` to `this.loadOlderMessages().then()` in `src/app/components/live-chat/live-chat.component.ts` (line 278)
- [ ] Add `.catch()` to `this.loadMoreNotes().then()` in `src/app/pages/profile/profile-notes/profile-notes.component.ts` (line 224)
- [ ] Add `.catch()` to dynamic `import().then()` calls in: `message-content.component.ts` (line 865), `trust.service.ts` (line 226), `login-dialog.component.ts` (line 672)
- [ ] Add `.catch()` to `router.navigateByUrl().then()` in `src/app/services/route-data.service.ts` (lines 325, 362)

### Silent catch blocks -- add debug logging

- [ ] Add debug logging to silent `.catch(() => null)` in `src/app/services/following.service.ts` (lines 220-222, 372-374, 418-421, 814-816) -- 13 instances
- [ ] Add debug logging to silent `.catch(() => null)` in `src/app/data-resolver.ts` (lines 272-273)
- [ ] Add debug logging to silent `.catch(() => null)` in `src/app/services/data.service.ts` (line 809) and `src/app/services/user-data.service.ts` (line 431)

---

## 9. SSR Safety -- Guard Browser API Usage

Many files use `window`, `document`, `navigator`, `localStorage` without `isPlatformBrowser` guards.

### High priority -- class field initializers that run during SSR

- [ ] Guard `window.innerWidth` in class field initializer in `src/app/pages/feeds/feeds.component.ts` (line 193)

### Medium priority -- services without guards

- [ ] Add platform guards to `src/app/services/profile-hover-card.service.ts` (~18 unguarded `window.*` calls)
- [ ] Add platform guards to `src/app/services/layout.service.ts` (lines 2182, 2240, 2253-2265, 2464, 2481, 782) -- `window.innerWidth`, `scrollTo`, `document.querySelector`, `navigator.share/clipboard`
- [ ] Add platform guards to `src/app/services/media-player.service.ts` (lines 1565-1618) -- `document.pictureInPictureEnabled`, `document.querySelector`
- [ ] Add platform guards to `src/app/services/global-error-handler.service.ts` (lines 71, 78-79, 90)
- [ ] Add platform guards to `src/app/services/pwa-update.service.ts` (lines 141, 156, 161) -- `navigator.serviceWorker`, `window.location.reload()`

### Medium priority -- components without guards

- [ ] Add platform guards to `src/app/components/event/event.component.ts` (lines 1232-1234, 1665) -- `window.innerHeight/Width`, `window.location.href`
- [ ] Add platform guards to `src/app/components/user-profile/user-profile.component.ts` (lines 335, 345) and `display-name/profile-display-name.component.ts` (lines 261, 271) -- `window.setTimeout/clearTimeout`
- [ ] Add platform guards to `src/app/components/note-content/note-content.component.ts` (lines 1268, 1308) and `bio-content/bio-content.component.ts` (lines 319, 349, 379, 464)
- [ ] Add platform guards to `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` (lines 682, 1817, 2043, 2062-2105) and `inline-reply-editor.component.ts` (lines 234, 257)
- [ ] Add platform guards to `src/app/pages/messages/messages.component.ts` (lines 1284, 1456, 1523, 1781)
- [ ] Add platform guards to `src/app/pages/profile/profile-header/profile-header.component.ts` (lines 873, 876, 930, 932)
- [ ] Add platform guards to `src/app/pages/article/article.component.ts` (lines 637, 661, 685, 921, 932, 962, 978)
- [ ] Add platform guards to `src/app/pages/media/media-details/media-details.component.ts` (lines 221-279)
- [ ] Add platform guards to `src/app/components/media-player/video-player/video-player.component.ts` (lines 114, 125, 197, 210)
- [ ] Add platform guards to `src/app/components/media-player/live-stream-player/live-stream-player.component.ts` (lines 152, 159, 222-223, 320-321, 343, 354, 400)
- [ ] Add platform guards to `src/app/components/share-article-dialog/share-article-dialog.component.ts` (lines 879, 890, 897, 903, 938, 944)
- [ ] Add platform guards to `src/app/pages/premium/renew/renew.component.ts` (lines 247, 257, 381) and `upgrade/upgrade.component.ts` (line 435)
- [ ] Add platform guards to `src/app/pages/bookmarks/bookmarks.component.ts` (line 394)
- [ ] Add platform guards to `src/app/pages/music/music-artist/music-artist.component.ts` (lines 540-545)

### Lower priority -- navigator.clipboard (consider using ClipboardService instead)

- [ ] Replace direct `navigator.clipboard` usage with `ClipboardService` in: `profile-about.component.ts`, `contact-monetary.component.ts`, `contact-overview.component.ts`, `contact-info.component.ts`, `accounts.component.ts`, `credentials.component.ts`, `profile-connection.component.ts`, `debug-panel.component.ts`, `zap-dialog.component.ts`, `zap-history.component.ts`, `login-dialog.component.ts`, `external-signer-dialog.component.ts`, `event-details-dialog.component.ts`, `bolt11-invoice.component.ts`, `bolt12-offer.component.ts`, `emoji-set-event.component.ts`, `people-set-event.component.ts`, `gift-premium-dialog.component.ts`, `playlists-tab.component.ts`, `emoji-sets.component.ts`

---

## 10. Suboptimal `track $index` in `@for` Loops

36 `@for` loops use `track $index` where items have natural unique identifiers.

- [ ] Fix `track $index` in `src/app/app.html` (line 180) -- `navigationItems()` should track by `item.path` or `item.id`
- [ ] Fix `track $index` in `src/app/pages/feeds/feeds.component.html` (line 306) -- `availableTags()` should track by tag string value
- [ ] Fix `track $index` in `src/app/pages/profile/profile-header/profile-header.component.html` (line 37) -- `topBadges()` should track by badge id
- [ ] Fix `track $index` in `src/app/pages/profile/profile-edit/profile-edit.component.html` (lines 147, 173, 209) -- track by string value or identity property
- [ ] Fix `track $index` in `src/app/pages/collections/boards/board-detail/board-detail.component.html` (lines 92, 128) -- track by ref id
- [ ] Fix `track $index` in `src/app/pages/collections/emoji-sets/emoji-sets.component.html` (lines 85, 163) -- track by `emoji.shortcode`
- [ ] Fix `track $index` in `src/app/components/event-types/emoji-set-event.component.html` (line 37) -- track by `emoji.shortcode`
- [ ] Fix `track $index` in `src/app/components/media-player/audio-player/playlist-drawer/playlist-drawer.component.html` (line 27) -- track by track id
- [ ] Fix `track $index` in `src/app/components/publish-dialog/publish-dialog.component.html` (lines 98, 151) and `report-dialog/report-dialog.component.html` (lines 99, 146) -- track by relay URL
- [ ] Fix `track $index` in remaining templates: event-image (line 14), welcome (line 56), articles-list (lines 24, 105), privacy-settings (lines 117, 149, 170), media-details (line 138), live-event (line 149), premium upgrade/renew (lines 111, 62), poll-editor (line 51), media-server-dialog (line 19), list-editor-dialog (lines 148, 204), event-details-dialog (lines 155, 161), create-event-dialog (line 141), bio-content (line 35), chat-content (line 19)

---

## 11. Duplicate Code Elimination

### Clipboard copy duplication

- [ ] Consolidate 10+ independent `copyToClipboard()` implementations to use `ClipboardService` -- files: `profile.component.ts`, `accounts.component.ts`, `credentials.component.ts`, `wallet.component.ts`, `renew.component.ts`, `upgrade.component.ts`, `contact-overview.component.ts`, `contact-monetary.component.ts`, `profile-connection.component.ts`, `layout.service.ts`
- [ ] Replace 22+ inline `navigator.clipboard.writeText() + snackBar.open('copied')` patterns with `ClipboardService` calls

### Utility function duplication

- [ ] Extract shared `isNostrEntity()` from 4 duplicate implementations into `UtilitiesService` -- files: `layout.service.ts` (line 1147), `app.ts` (line 1283), `search.service.ts` (line 745), `qrcode-scan-dialog.component.ts` (line 297)
- [ ] Remove duplicate `getTags()` from `nostr.service.ts` (line 1943) -- identical to `utilities.service.ts` (line 907). Consolidate into one location
- [ ] Consolidate 6+ `formatTimestamp()` / relative time implementations into `UtilitiesService.getRelativeTime()` -- files: `notifications.component.ts` (line 490), `live-chat.component.ts` (line 779), `relays.component.ts` (line 820), `details.component.ts` (line 224), `debug-panel.component.ts` (line 357), `relay-diagnostics.component.ts` (line 340)
- [ ] Extract shared `getArticleTitle()` utility -- 4 duplicate implementations vs unused `UtilitiesService.getTitleTag()` -- files: `profile-reads.component.ts`, `search-results.component.ts`, `search.component.ts`, `summary.component.ts`
- [ ] Extract shared `getValidRelayHints()` -- copy-pasted 3 times in: `article.component.ts` (line 130), `playlist-embed.component.ts` (line 289), `music-embed.component.ts` (line 401)
- [ ] Extract relay URL conversion (`wss://` to `https://`) into utility -- duplicated in: `relays.ts` (line 655), `relay-info-dialog.component.ts` (line 458), `logs-settings.component.ts` (line 130)
- [ ] Extract display name resolution pattern (`profile?.data?.name || profile?.data?.display_name || fallback`) into utility -- duplicated 10+ times across music and profile components

### Code clones between components

- [ ] Consolidate `loadNsec()`, `getDecryptedNsecWithPrompt()`, `downloadCredentials()` between `accounts.component.ts` and `credentials.component.ts` -- nearly identical implementations
- [ ] Extract shared article tag extraction computed signals (title, image, summary, hashtags, publishedAt) from `article/article.component.ts` and `components/article/article.component.ts` into a shared utility
- [ ] Extract music track/playlist tag extraction logic from 8+ music components into a shared `MusicDataExtractor` utility

### Pervasive patterns to standardize

- [ ] Replace 83+ inline `sort((a, b) => b.created_at - a.created_at)` calls with `UtilitiesService.sortEventsByCreatedAt()`
- [ ] Replace 82+ inline `event.tags.find(t => t[0] === 'X')` calls with `UtilitiesService.getTagValue()`
- [ ] Consolidate 15+ files with `isPlatformBrowser(inject(PLATFORM_ID))` boilerplate -- use `ApplicationService.isBrowser` signal instead

---

## 12. Dead Code Removal

### Unused files/components

- [ ] Delete `src/app/utils/debug-utils.ts` -- never imported anywhere
- [ ] Delete `src/app/components/video-player/` (duplicate of `media-player/video-player/`)
- [ ] Delete `src/app/components/relay-diagnostics/` -- selector never used, never imported
- [ ] Evaluate `src/app/pages/credentials/` -- route redirects away, component may never load
- [ ] Evaluate `src/app/pages/premium/premium.component.*` (not subfolders) -- route redirects away
- [ ] Delete `src/app/components/login-wrapper/login-wrapper.component.ts` -- never imported, selector never used

### Unused SCSS classes

- [ ] Remove dead CSS rules from `src/app/app.scss`: `.toolbar-spacer`, `.premium-label`, `.premium-expires`, `.sidenav-profile-header`, `.sidenav-profile-avatar`, `.profile-button-avatar`, `.desktop-create-fab`, bare `nav` selector, `.active` rule

### Commented-out code blocks

- [ ] Remove ~100 lines of commented methods in `src/app/pages/feeds/feeds.component.ts` (~lines 1396-1493)
- [ ] Remove ~53 lines of empty `reportFile()` in `src/app/services/media.service.ts` (~lines 1043-1096)
- [ ] Remove ~25 lines of empty `deleteChat()` in `src/app/pages/messages/messages.component.ts` (~lines 1663-1687)
- [ ] Remove ~22 lines of commented `finalize()` in `src/app/pages/premium/upgrade/upgrade.component.ts` (~lines 289-311)
- [ ] Remove ~21 lines of commented `getAccountProfile()` in `src/app/services/account-state.service.ts` (~lines 991-1012)
- [ ] Remove ~18 lines of commented load method in `src/app/pages/profile/profile-reads/profile-reads.component.ts` (~lines 169-187)

### Console.log cleanup

- [ ] Replace debug `console.log` statements in `src/app/services/media-player.service.ts` (50+ instances) with `LoggerService`
- [ ] Replace debug `console.log` statements in `src/app/components/content/note-content/note-content.component.ts` (7+ instances) with `LoggerService`
- [ ] Remove request logging in `src/app/services/web-request.ts` (line 70) -- logs every HTTP request URL

---

## 13. Remove `font-weight` Usage

The current font doesn't support font-weight variations. ~230+ occurrences across 68+ SCSS files.

- [ ] Remove all `font-weight` properties from `src/styles.scss` (lines 257, 393, 405, 561, 568, 860, 943, 953)
- [ ] Remove all `font-weight` properties from `src/app/app.scss` (lines 719, 2418)
- [ ] Remove all `font-weight` properties from `src/app/pages/feeds/feeds.component.scss` (~14 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/pages/settings/relays/relays.component.scss` (~17 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/pages/calendar/calendar.scss` (~14 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/live-chat/live-chat.component.scss` (~11 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/login-dialog/login-dialog.component.scss` (~9 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/note-editor-dialog/note-editor-dialog.component.scss` (~7 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/debug-panel/debug-panel.component.scss` (~8 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/zap-dialog/zap-dialog.component.scss` (~7 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/user-profile/user-profile.component.scss` (~6 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/content/note-content/note-content.component.scss` (~5 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/pages/people/people.component.scss` (~6 occurrences)
- [ ] Remove all `font-weight` properties from `src/app/components/favorites-overlay/favorites-overlay.component.scss` (~4 occurrences)
- [ ] Remove all `font-weight` properties from remaining files (~60+ files with 1-5 occurrences each)

---

## 14. Remove `color="primary"` from Buttons

Material 3 doesn't support `color="primary"` on buttons. ~118 occurrences across 47+ files.

- [ ] Remove `color="primary"` from buttons in `src/app/components/note-editor-dialog/note-editor-dialog.component.html` (lines 81, 153, 165, 178, 239, 260)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/feeds/feeds.component.html` (lines 294, 307, 328, 456, 467)
- [ ] Remove `color="primary"` from buttons in `src/app/components/user-profile/user-profile.component.html` (lines 34, 134, 164, 193, 222)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/settings/relays/relays.component.html` (lines 31, 70, 90, 129, 243, 272, 400)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/profile/profile-edit/profile-edit.component.html` (lines 18, 29, 71, 82, 282, 306)
- [ ] Remove `color="primary"` from buttons in `src/app/components/zap-dialog/zap-dialog.component.html` (lines 332, 373, 432, 448)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/invite/invite.component.html` (lines 12, 46, 61, 76, 91, 101)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/settings/algorithm/algorithm.html` (lines 102, 201, 298, 401)
- [ ] Remove `color="primary"` from buttons in `src/app/components/article-display/article-display.component.html` (lines 149, 159, 163, 167)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/messages/messages.component.html` (lines 23, 84, 208, 296)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/collections/relay-sets/relay-sets.component.html` (lines 28, 51, 80, 111)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/calendar/calendar.html` (lines 278, 289, 317, 411)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/badges/badge-editor/badge-editor.component.html` (lines 51, 120, 191)
- [ ] Remove `color="primary"` from buttons in `src/app/pages/playlists/playlist-editor/playlist-editor.component.html` (lines 21, 117, 129)
- [ ] Remove `color="primary"` from buttons in remaining files (~25 files with 1-3 occurrences each)

---

## 15. Add `field-sizing: content` to Auto-Growing Textareas

~23 textarea elements lack `field-sizing: content` for auto-growing.

- [ ] Add `field-sizing: content` to textarea in `src/app/pages/messages/messages.component.scss`
- [ ] Add `field-sizing: content` to textarea in `src/app/pages/profile/profile-edit/profile-edit.component.scss`
- [ ] Add `field-sizing: content` to textarea in `src/app/components/zap-dialog/zap-dialog.component.scss`
- [ ] Add `field-sizing: content` to textarea in `src/app/components/note-editor-dialog/note-editor-dialog.component.scss`
- [ ] Add `field-sizing: content` to textarea in `src/app/components/publish-dialog/publish-dialog.component.scss`
- [ ] Add `field-sizing: content` to textarea in `src/app/components/report-dialog/report-dialog.component.scss`
- [ ] Add `field-sizing: content` to textarea in `src/app/components/article-editor-dialog/article-editor-dialog.component.scss`
- [ ] Add `field-sizing: content` to textareas in remaining files: ai.scss, badge-editor, badge-details, music-track-dialog, edit-music-playlist-dialog, create-music-playlist-dialog, import-rss-dialog, delete-event, create-event-dialog, add-bookmark-dialog, media-publish-dialog, media-server-dialog, list-editor-dialog, poll-editor, playlist-editor, create-playlist-dialog

---

## 16. Accessibility Improvements

- [ ] Audit and add missing `aria-label` attributes to icon-only buttons across components
- [ ] Add missing `alt` attributes to images that lack them
- [ ] Add `role` attributes to `(click)` handlers on non-interactive elements (`div`, `span`)
- [ ] Add missing form input labels and `aria-describedby` attributes
- [ ] Ensure all custom interactive components have appropriate ARIA roles

---

## 17. Hardcoded Colors -- Replace with Material 3 CSS Variables

~1,100+ hardcoded color occurrences across ~95 SCSS files. Fix by category.

- [ ] Define new semantic CSS variables for common custom colors: `--nostria-reaction-color` (#e91e63), `--nostria-overlay-bg`, `--nostria-overlay-light`, `--youtube-brand-color` (#ff0000)
- [ ] Replace hardcoded colors in `src/app/pages/home/home.component.scss` (~100+ occurrences)
- [ ] Replace hardcoded colors in `src/app/pages/messages/messages.component.scss` (~80+ rgba glass effects)
- [ ] Replace hardcoded colors in `src/styles.scss` (~60+ occurrences)
- [ ] Replace hardcoded colors in `src/app/app.scss` (~60+ occurrences)
- [ ] Replace hardcoded colors in `src/app/components/content/note-content/note-content.component.scss` (~50+)
- [ ] Replace hardcoded colors in `src/app/pages/notifications/notifications.component.scss` (~45+)
- [ ] Replace hardcoded colors in `src/app/components/debug-panel/debug-panel.component.scss` (~55+)
- [ ] Replace hardcoded colors in remaining high-count files (~80 files with 5-30 occurrences each)
- [ ] Note: `winamp-player-view.component.scss` uses ~100 hardcoded colors for intentional retro styling -- exempt from this task

---

## Notes

- Tasks are marked complete automatically when the AI agent finishes them
- Completed tasks show as `- [x] Task description`
- Tasks are executed in order from top to bottom
- Each run should focus on ONE task, run `npm run lint` and `npm run build`, then commit
- Do NOT modify files in `src/app/api/` (generated code)
- Do NOT modify `package-lock.json` or lock files
