# Nostria Article Import Protocol (`.zip` + folder)

This document describes the import package format used by this repository for Nostria article imports.

## 1) Scope

The protocol here targets long-form Nostr articles (kind `30023`) imported into Nostria.

Two equivalent forms are supported by workflow:

- **Folder import**: an unpacked directory containing `event.json` + media files.
- **Zip import**: a `.zip` whose root contains exactly the same import payload.

Think of zip import as "folder import, compressed".

## 2) Canonical import payload

At import root (folder root or zip root):

- `event.json` (required)
- zero or more media files (optional, but usually needed)

### Required root file

- The importer payload file name is **exactly** `event.json`.

### Optional root files

- Any local media referenced by the event (usually from markdown/images).
- Keep media in the root of the payload (flat structure), not nested folders.

## 3) Event JSON requirements

`event.json` should be a valid Nostr event object for kind `30023`.

Minimum practical shape:

```json
{
  "kind": 30023,
  "pubkey": "<32-byte hex pubkey>",
  "created_at": 1772046067,
  "tags": [
    ["d", "your-article-identifier"],
    ["title", "Your title"],
    ["summary", "Short summary"],
    ["published_at", "1772046067"]
  ],
  "content": "Markdown body"
}
```

Common tags used by this repo:

- `d` (identifier)
- `title`
- `summary`
- `published_at`
- `image` (for featured image file name)
- `t` tags (topic tags)
- optional reference tags such as `a` and `p`

## 4) Media resolution rules

When using local files:

- Use **file names** in tags/content (example: `feature-article.png`), not absolute disk paths.
- Ensure each referenced file exists in the import payload root.
- Use forward-friendly file names (ASCII-safe, no path traversal, no control chars).

## 5) Zip import format

For zip import, zip **the payload root contents** so that `event.json` is at zip root:

```text
my-article.zip
  event.json
  feature-article.png
  reniboka-player.png
  ...other media
```

Do not place files under an extra top-level folder inside the zip if you want maximum compatibility.

## 6) Compatibility checklist (copy/paste)

Before importing:

- [ ] `event.json` exists at payload root.
- [ ] `event.json.kind === 30023`.
- [ ] `tags` contains at least `d`, `title`, `summary`, `published_at` for good UX.
- [ ] Any `image` tag file exists in payload root.
- [ ] Any markdown media references point to files included in payload root.
- [ ] Zip contains root files directly (no extra wrapper directory).
