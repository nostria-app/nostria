# Build Information Display in About Dialog

## Overview
This document describes the implementation of displaying build information (commit SHA and build date) in the About dialog. This enhancement allows users to see exactly which version of the code is running and when it was built, making it easier to track deployments and troubleshoot issues.

## Changes Made

### 1. GitHub Actions Workflow Update
**File:** `.github/workflows/deploy.yml`

Added a new step that updates the `manifest.webmanifest` file with build information before the Docker build:

```yaml
- name: Update manifest with build info
  run: |
    BUILD_DATE=$(date -u +"%Y-%m-%d")
    COMMIT_SHA="${{ github.sha }}"
    COMMIT_SHORT="${COMMIT_SHA:0:7}"
    
    # Update manifest.webmanifest with commit and build date
    jq --arg commit "$COMMIT_SHA" --arg commitShort "$COMMIT_SHORT" --arg buildDate "$BUILD_DATE" \
      '. + {commitSha: $commit, commitShort: $commitShort, buildDate: $buildDate}' \
      public/manifest.webmanifest > public/manifest.webmanifest.tmp
    mv public/manifest.webmanifest.tmp public/manifest.webmanifest
    
    echo "Updated manifest with commit $COMMIT_SHORT and build date $BUILD_DATE"
```

This step:
- Captures the current UTC date in YYYY-MM-DD format
- Extracts the full commit SHA from GitHub context
- Creates a short commit SHA (first 7 characters)
- Uses `jq` to add these fields to the manifest file

### 2. About Component TypeScript
**File:** `src/app/pages/settings/about/about.component.ts`

#### Interface Update
Extended the `WebManifest` interface to include the new build information fields:

```typescript
interface WebManifest {
  version?: string;
  commitSha?: string;
  commitShort?: string;
  buildDate?: string;
  name: string;
  short_name: string;
  [key: string]: any;
}
```

#### Component Properties
Added three new signals to store the build information:

```typescript
commitSha = signal<string | undefined>(undefined);
commitShort = signal<string | undefined>(undefined);
buildDate = signal<string | undefined>(undefined);
```

#### Data Fetching
Updated `fetchManifestVersion()` method to read and store the new fields from the manifest:

```typescript
// Set commit and build date information
if (manifestData.commitSha) {
  this.commitSha.set(manifestData.commitSha);
}
if (manifestData.commitShort) {
  this.commitShort.set(manifestData.commitShort);
}
if (manifestData.buildDate) {
  this.buildDate.set(manifestData.buildDate);
}
```

### 3. About Component Template
**File:** `src/app/pages/settings/about/about.component.html`

Added conditional display of build information after the version heading:

```html
@if (buildDate()) {
  <p class="build-info">Built on: {{ buildDate() }}</p>
}
@if (commitShort() && commitSha()) {
  <p class="build-info">
    Commit:&nbsp;<a 
      [href]="'https://github.com/nostria-app/nostria/commit/' + commitSha()" 
      target="_blank" 
      rel="noopener noreferrer"
    >{{ commitShort() }}</a>
  </p>
}
```

The commit link uses:
- The short SHA for display (7 characters)
- The full SHA for the GitHub commit URL
- Opens in a new tab with security attributes

### 4. About Component Styles
**File:** `src/app/pages/settings/about/about.component.scss`

Added styling for the build information:

```scss
.build-info {
  font-size: 0.9rem;
  color: var(--mdc-theme-text-secondary-on-background, rgba(0, 0, 0, 0.6));
  margin: 0.25rem 0;

  a {
    color: var(--mdc-theme-primary, #5953a9);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
```

This provides:
- Slightly smaller font size than regular text
- Secondary text color for subtle appearance
- Themed primary color for links
- Hover effect for better UX

## User Experience

### What Users See
In the About dialog, users will now see:

1. **Version**: The application version (e.g., "1.0.7")
2. **Built on**: The date the deployed version was built (e.g., "2025-10-23")
3. **Commit**: A clickable link showing the short commit SHA (e.g., "a1b2c3d")

### Benefits
- **Transparency**: Users can see exactly which code version they're running
- **Troubleshooting**: Support can quickly identify which commit is deployed
- **Verification**: Users can verify they're running the latest version
- **Trust**: Shows active development and recent builds

## Technical Notes

### Deployment Flow
1. Code is pushed to the `main` branch
2. GitHub Actions workflow triggers
3. Workflow injects commit SHA and build date into `manifest.webmanifest`
4. Application is built with the updated manifest
5. Docker image is created and pushed
6. Azure Web App is deployed with the new image

### Data Flow
1. Manifest file is updated during CI/CD build process
2. Angular application fetches manifest at runtime
3. About component reads and displays the information
4. Information is conditionally displayed only when available

### Local Development
During local development:
- The build information fields won't be present in the manifest
- The conditional rendering ensures no errors occur
- Only the version number will be displayed

### Fallback Behavior
If the manifest fetch fails or build info is missing:
- The component gracefully handles undefined values
- Version defaults to "1.0.0"
- Build info simply doesn't display
- No errors are thrown to the user

## Future Enhancements

Potential improvements could include:
- Adding build timestamp (not just date)
- Including branch name for non-main deployments
- Showing CI/CD workflow run number
- Adding "copy to clipboard" functionality
- Displaying environment name (staging/production)
