# Demo Intro/Outro Assets

Optional custom clips for demo composition.

- `intro.mp4`
- `outro.mp4`

Use them with:

```bash
npm run demo:feature -- --feature music --device both

npm run demo:feature -- --feature music --device desktop --intro e2e/assets/intro.mp4 --outro e2e/assets/outro.mp4

npm run demo:all
```

If not provided, the compose script auto-generates intro/outro from the app logo.
