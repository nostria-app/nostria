# Demo Video Brief (Human Language)

This brief defines exactly what demo videos should be generated for Nostria and how they should look.

When this brief is updated, ask Copilot:

Generate demo scenes and commands from docs/demo-video-brief.md.

Copilot should convert this brief into `docs/demo-scenes.md` and run the scene pipeline.

## 1) Goal

Create high-quality, social-ready demo videos that show Nostria as a fast, modern Nostr client for both discovery and daily usage.

These videos are intended for product marketing, release notes, and feature announcements.

Primary audience:

- New users who are curious about Nostr but unfamiliar with terminology.
- Existing Nostr users evaluating Nostria UX.
- Creators and music/article consumers on mobile.

## 2) Output requirements

Generate the following outputs:

- Feature videos: one video per feature for both desktop and mobile.
- Showcase videos: one all-in-one showcase for desktop and one for mobile.
- Include intro and outro on all final videos.
- Keep raw recordings and final composed outputs.

Expected output locations:

- Raw recordings in `test-results/demo-videos/raw`.
- Final composed videos in `test-results/demo-videos/final`.

## 3) Features to include

Must include these feature flows:

- Summary
- Music
- Articles
- Search
- Streams
- Discover
- Profile
- Collections (authenticated)
- Notifications (authenticated)
- Messages (authenticated)
- Article Editor (authenticated, no publishing)

Priority order for social snippets:

1. Music
2. Summary
3. Articles
4. Discover
5. Search

## 4) Features to avoid

Do not include:

- Settings-heavy deep configuration flows.
- Debug/internal tools.
- Any flow that risks accidental publishing.
- Broken or empty sections if data is unavailable.
- Long loading waits or visual stalls unless unavoidable.

## 5) Authentication and safety

Use authenticated context for collections, notifications, messages, and article editor demonstrations.

Safety rules are strict:

- Recording mode is read-only from a publishing perspective.
- Never publish, sign, or create outbound events as part of demo behavior.
- Never click publish/post/save actions that submit content.
- Preserve deterministic account loading for profile/relay context.

Warmup policy before showcase:

- Authenticate.
- Load app and wait 5 seconds.
- Reload once.
- Start recording only after warmup completes.

## 6) Style and pacing

The recordings should feel like a real person using the app confidently and calmly.

Style requirements:

- Human pace with intentional pauses after navigation.
- Smooth scrolling and deliberate clicks.
- No frantic cursor movement.
- No abrupt jump cuts inside a scene.
- Clean start and clean exit for each flow.

Timing guidance:

- Most feature clips should stay around 10–25 seconds before intro/outro.
- Showcase can be longer, but should remain concise and focused.

## 7) Device targets

Device output requirements:

- Desktop final videos: 1920x1080.
- Mobile final videos: 1080x1920.
- Mobile footage must be correctly centered and scaled, not top-left anchored.

Target channels:

- Desktop for YouTube/product pages.
- Mobile for Shorts/Reels/TikTok style publishing.

## 8) Intro/outro

Branding policy:

- Prefer custom intro and outro assets when provided.
- If custom assets are missing, use auto-generated logo intro/outro.
- Intro/outro should be short, clean, and consistent across all videos.

Default behavior:

- Use logo-based intro/outro fallback automatically.

## 9) Scene ideas (optional free-form)

Summary scene:

- Open summary feed, wait for content, smooth scroll through events, open one item briefly, and return.

Music scene:

- Open music section, preview playback interaction, scroll through items, and briefly switch subsection (tracks/playlists/artists).

Articles scene:

- Open articles, scroll, open one article preview, and return to list.

Search scene:

- Open search, enter a simple query, submit, and scroll results.

Discover scene:

- Open discover, switch category focus, and scroll recommended content.

Profile scene:

- Open a known profile, scroll, and switch to one profile tab (articles/media).

Authenticated utility scenes:

- Collections: open bookmarks/list view and scroll.
- Notifications: open notifications, briefly visit settings subview, return.
- Messages: open inbox and one conversation preview.
- Article editor: open editor layout only, demonstrate fields/UI presence, no writing or publishing.

Showcase scene:

- Single-session journey through major public features, then authenticated utility views, ending cleanly.

## 10) Final constraints

Must-follow constraints:

- No publishing/signing side effects.
- Always include intro and outro in final outputs.
- Always run showcase warmup before recording.
- Keep motion readable and smooth.
- Prefer reliability and consistency over flashy transitions.
- Fail fast on missing auth requirements for auth scenes.
- Re-runnable generation: results should be reproducible after code changes.
