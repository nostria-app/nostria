# Demo Video Generation

This workflow generates reproducible demo videos from E2E tests for both desktop and mobile.

## What it does

- Runs dedicated demo E2E walkthroughs tagged by feature.
- Captures raw Playwright videos (`.webm`).
- Produces final shareable videos (`.mp4`) with intro + body + outro.
- Supports one feature at a time, or all features in batch.

## Feature IDs

- `summary`
- `music`
- `articles`
- `search`
- `streams`
- `discover`
- `profile`
- `collections` (auth)
- `notifications` (auth)
- `messages` (auth)
- `article-editor`

## Requirements

- Node.js + npm dependencies installed (`npm install`).
- `ffmpeg` and `ffprobe` available in your PATH (required for `.mp4` composition).

## Commands

- Single feature (desktop + mobile, with composition):

```bash
npm run demo:feature -- --feature music --device both
```

- Single feature desktop only:

```bash
npm run demo:feature -- --feature articles --device desktop
```

- Single feature mobile only:

```bash
npm run demo:feature -- --feature summary --device mobile
```

- Single feature raw only (no intro/outro composition):

```bash
npm run demo:feature -- --feature streams --device desktop --compose false
```

- Full batch (all features, desktop + mobile):

```bash
npm run demo:all
```

- Authenticated batch (all auth features, desktop + mobile):

```bash
npm run demo:auth-all
```

- Authenticated batch desktop only (no extra args):

```bash
npm run demo:auth-all:desktop
```

- Authenticated batch mobile only (no extra args):

```bash
npm run demo:auth-all:mobile
```

- One all-in-one showcase video (desktop, no extra args):

```bash
npm run demo:showcase
```

- One all-in-one showcase video (mobile, no extra args):

```bash
npm run demo:showcase:mobile
```

- Compose from already recorded Playwright artifacts:

```bash
npm run demo:compose -- --feature all --device both
```

`demo:showcase` re-runs all feature demos for the selected device, stitches the clips in feature order,
and then adds a single intro and outro so you get one complete demonstration video.

## Intro/Outro handling

By default, intro and outro clips are auto-generated from the app logo.

To use custom clips (for example AI-generated), pass paths to `--intro` and `--outro`:

```bash
npm run demo:feature -- --feature music --device desktop --intro path/to/intro.mp4 --outro path/to/outro.mp4
```

If custom clips are not provided, the generator creates logo-based intro/outro automatically.

## Output folders

- Raw videos: `test-results/demo-videos/raw`
- Final composed videos: `test-results/demo-videos/final`
- Temporary composition files: `test-results/demo-videos/temp`

## Authenticated demo flows

`collections`, `notifications`, `messages`, and `article-editor` use authenticated test context.

Use a fixed demo account key for deterministic outputs:

```bash
TEST_NSEC=nsec1... npm run demo:feature -- --feature article-editor --device desktop
```

On Windows PowerShell:

```powershell
$env:TEST_NSEC='nsec1...'; npm run demo:feature -- --feature article-editor --device desktop
```

The demo runner enforces this for auth features and fails fast if `TEST_NSEC` is missing.
