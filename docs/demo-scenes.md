# Demo Scenes

Edit this table to control which demo videos are generated.

- `mode`: `feature` or `showcase`
- `feature`: one of `summary`, `music`, `articles`, `search`, `streams`, `discover`, `profile`, `collections`, `notifications`, `messages`, `article-editor`, `all`, `auth`
- `device`: `desktop`, `mobile`, or `both`
- `enabled`: `true` or `false`
- `compose`: only for `feature` mode (`true`/`false`)
- `rerun`: only for `showcase` mode (`true`/`false`)
- `intro` / `outro`: optional paths relative to repo root

| scene                 | mode     | feature  | device  | enabled | compose | rerun | intro | outro |
| --------------------- | -------- | -------- | ------- | ------- | ------- | ----- | ----- | ----- |
| Summary Both          | feature  | summary  | both    | true    | true    | true  |       |       |
| Music Both            | feature  | music    | both    | true    | true    | true  |       |       |
| Articles Both         | feature  | articles | both    | true    | true    | true  |       |       |
| Search Both           | feature  | search   | both    | true    | true    | true  |       |       |
| Streams Both          | feature  | streams  | both    | true    | true    | true  |       |       |
| Discover Both         | feature  | discover | both    | true    | true    | true  |       |       |
| Profile Both          | feature  | profile  | both    | true    | true    | true  |       |       |
| Auth Features Both    | feature  | auth     | both    | true    | true    | true  |       |       |
| Full Showcase Desktop | showcase |          | desktop | true    | true    | true  |       |       |
| Full Showcase Mobile  | showcase |          | mobile  | true    | true    | true  |       |       |
