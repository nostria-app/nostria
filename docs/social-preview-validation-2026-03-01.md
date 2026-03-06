# Social Preview Validation - 2026-03-01

## Scope

Production social preview validation for bot user agents against known event routes:

- `Discordbot/2.0`
- `Twitterbot/1.0`
- `facebookexternalhit/1.1`

Validated URLs:

1. `/e/nevent1qvzqqqqqqypzpm0sm29mm0s3r90m3psed2a07kr2jzfvmnyuqqtmww7enzex2tarqy88wumn8ghj7mn0wvhxcmmv9uqzqt33ge82hpgzlan47n583kj8559hhtxlggurk4lt4s0zfvzaqs4ytjdzsj`
2. `/e/nevent1qvzqqqqqqypzp42ptgcn6wzxrlun4rqhp72pktx55e49eldmpy6qd9s0dje30pylqythwumn8ghj7un9d3shjtnswf5k6ctv9ehx2ap0qqs04r5xcnh792uckhzgypn0kav6vzsff4d79d6nq7dhm4ayg8j6seg67dxm8`
3. `/e/nevent1qvzqqqqqqypzq9lz3z0m5qgzr5zg5ylapwss3tf3cwpjv225vrppu6wy8750heg4qy88wumn8ghj7mn0wvhxcmmv9uqzqqqqxztt8tft7pq3ttk3qkdn4j5galmduuvj7vmm72z3k0ju98alq9wfvz`

Each URL was tested in two passes:

- warmup
- second

Total checks: `3 URLs x 3 bots x 2 passes = 18`.

## Result

All checks healthy:

- `18/18` returned `status=200`
- `18/18` returned `quality=healthy`
- `18/18` returned `reason=ok`
- no `ERROR=` lines

Cache behavior was correct:

- warmup: first request per URL was `cache=MISS`, then subsequent requests were `cache=HIT`
- second pass: all requests were `cache=HIT`

## Artifacts

- Raw run report: `test-results/prod-social-preview-check.txt`

## Repeatable Commands

Run beta validation:

```bash
npm run check:social-preview:beta
```

Run production validation:

```bash
npm run check:social-preview:prod
```

## Notes

This check verifies social-preview bot responses and metadata quality signals via SSR response headers (`X-SSR-Cache`, `X-SSR-Preview-Quality`, `X-SSR-Preview-Reason`) and extracted `og:title` / `twitter:title` tags.
