# iOS Splash Regeneration

This project uses static iOS startup images (`apple-touch-startup-image`) in `src/index.html` and image assets in `public/splash`.

To regenerate all existing splash images with the current logo and centered large icon:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/gen-ios-splash.ps1
```

## Optional parameters

- `-LogoPath` default: `public/icons/nostria.png`
- `-SplashDir` default: `public/splash`
- `-LogoScale` default: `0.72` (larger icon, currently used)
- `-BackgroundHex` default: `#0a0a0a`

Example with explicit values:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/gen-ios-splash.ps1 -LogoPath public/icons/nostria.png -SplashDir public/splash -LogoScale 0.72 -BackgroundHex '#0a0a0a'
```

After regenerating, run:

```powershell
npm run build
```

to ensure assets are included and the app still builds successfully.
