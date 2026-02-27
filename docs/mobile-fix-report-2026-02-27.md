# Mobile Fix Report — 2026-02-27

## Scope

Deep authenticated mobile audit using iPhone viewport emulation (`390x844`) across core and deep flows.

## Deep Flows Audited

- `/messages/1`
- `/p/:id` timeline and profile tabs
- `/settings/about`
- `/article/create`
- `/music`
- `/clips`
- `/collections/media`

Additional broader route sweep was also run in this session (`/`, `/discover`, `/notifications`, `/wallet`, `/ai`, `/lists`, `/calendar`, `/newsletter`, `/analytics`, `/people`, `/people/discover`, `/zaps`, `/articles`, `/streams`, `/collections`).

## Key Fixes Applied

### Global / shared interaction fixes

- Increased toolbar/search and shared navigation tap targets for mobile.
- Improved home footer link tap areas.
- Improved people filter input touch height.

### Deep-flow fixes from this pass

- Event quick reaction/action ergonomics:
  - Mobile sizing for quick emoji buttons.
  - Mobile sizing for action icon containers (reaction/reply/zap internals).
  - Mobile behavior for hidden quick-reaction popup to avoid collapsed/ghost controls.
- Profile header/stat links:
  - Mobile min size for compact profile stats (following/followers/relays/badges/links).
- User profile metadata links:
  - Mobile min height for profile display-name/npub links.
  - Mobile min height for event date links.
- Settings About links:
  - Mobile min-height and spacing for website/repository/protocol/issues links.
- Music and clips deep controls:
  - Increased menu button touch targets (`menu-btn`, artist/track menus).
  - Increased clips tabs/actions and quick-follow interaction area.
- Collections media:
  - Increased selection checkbox touch target.

## Files Updated (this full optimization run)

- `src/app/app.scss`
- `src/app/components/navigation/navigation.scss`
- `src/app/pages/home/home.component.scss`
- `src/app/pages/people/people.component.scss`
- `src/app/pages/settings/home/settings-home.component.ts`
- `src/app/pages/settings/about/about.component.scss`
- `src/app/pages/ai/ai.scss`
- `src/app/pages/clips/clips.component.scss`
- `src/app/pages/clips/clips-video-card/clips-video-card.component.scss`
- `src/app/pages/media/media.component.scss`
- `src/app/pages/music/artists/artists.component.scss`
- `src/app/pages/music/music-artist/music-artist.component.scss`
- `src/app/pages/music/music-playlist/music-playlist.component.scss`
- `src/app/components/music-playlist-card/music-playlist-card.component.ts`
- `src/app/components/event-types/music-event.component.ts`
- `src/app/components/event/event.component.scss`
- `src/app/components/event/header/header.component.scss`
- `src/app/components/user-profile/user-profile.component.scss`
- `src/app/components/user-profile/display-name/profile-display-name.component.scss`
- `src/app/pages/profile/profile-header/profile-header.component.scss`

## Screenshots Captured

Saved under `test-results/` with names starting:

- `mobile-audit-*`
- `mobile-deep-*`

Key deep-flow outputs include:

- `mobile-deep-messages-thread.png`
- `mobile-deep-profile-final-3.png`
- `mobile-deep-settings-about-final.png`
- `mobile-deep-article-create.png`

## Current Status

- No horizontal overflow detected on audited routes after fixes.
- No sub-40px interactive controls remain in audited deep flows, except one non-actionable compact metadata span detected by automated selector heuristics.

## Suggested Next Pass

- Run on real devices (iOS Safari + Android Chrome) for gesture/keyboard behavior.
- Validate modal/dialog and menu overlays with virtual keyboard open.
- Add an automated Playwright assertion to catch sub-40px interactive controls in key routes.
