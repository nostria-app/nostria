# Nostria - Software Architecture Document

> **Nostria** - Your Social Network
>
> A beautiful, feature-rich Nostr client that puts control back where it belongs: with you.

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Application Architecture](#application-architecture)
4. [Nostr Protocol Implementation](#nostr-protocol-implementation)
5. [Backend Services](#backend-services)
6. [UI/UX Architecture](#uiux-architecture)
7. [State Management](#state-management)
8. [Navigation & Layout System](#navigation--layout-system)
9. [Media Player System](#media-player-system)
10. [Authentication & Account Management](#authentication--account-management)
11. [Relay Architecture](#relay-architecture)
12. [Encryption & Privacy](#encryption--privacy)
13. [Performance Optimization](#performance-optimization)
14. [Server-Side Rendering (SSR)](#server-side-rendering-ssr)
15. [Platform Support](#platform-support)
16. [Content Creation](#content-creation)
17. [Command Palette](#command-palette)
18. [AI Features](#ai-features)
19. [Key Design Decisions](#key-design-decisions)
20. [Development Guidelines](#development-guidelines)

---

## Overview

Nostria is a decentralized social media client built on the Nostr protocol. It provides a beautiful, responsive user experience across all platforms while maintaining the core principles of decentralization, user sovereignty, and censorship resistance.

### Core Principles

- **Decentralization**: No central server dependency; users control their data and relay connections
- **User Sovereignty**: Full control over identity, data, and social graph
- **Performance First**: Optimized rendering, lazy loading, and efficient resource management, including local database caching and retrieval.
- **Universal Access**: Works on web, desktop (Tauri), and mobile (PWA/Bubblewrap)
- **Beautiful Design**: Glass-effect UI with modern Material 3 theming

### Key Features

- **Feeds**: Customizable content feeds with multiple sources (following, public, trending, search)
- **Summary**: Content summarization for quick overview
- **Messages**: Encrypted direct messaging (NIP-04, NIP-17, NIP-44)
- **Articles**: Long-form content support (NIP-23)
- **Discover**: Content discovery and exploration
- **People**: Profile management and social connections
- **Collections**: Follow sets and content organization
- **Music**: Integrated music player with offline support
- **Streams**: Live streaming viewer
- **Notifications**: Real-time activity notifications
- **Push Notifications**: Some notifications via web push, such as Zaps, Follows and more. This is handled by separate service hosted by Nostria.
- **Zaps**: Bitcoin Lightning payments (NIP-57)

---

## Technology Stack

### Frontend

| Technology             | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| **Angular 21+**        | Core framework with standalone components |
| **Angular Material 3** | UI component library                      |
| **TypeScript**         | Type-safe development                     |
| **Signals**            | Reactive state management                 |
| **nostr-tools**        | Nostr protocol implementation             |
| **@getalby/sdk**       | Lightning/NWC wallet integration          |

### Backend Services (Nostria-Provided)

| Service              | URL Pattern                                 | Purpose                              |
| -------------------- | ------------------------------------------- | ------------------------------------ |
| **Image Proxy**      | `proxy.{region}.nostria.app`                | Optimized image delivery and caching |
| **Metadata Service** | `metadata.nostria.app`                      | OpenGraph/social preview fetching    |
| **Discovery Relay**  | `discovery.{region}.nostria.app`            | Relay discovery and bootstrapping    |
| **CORS Proxy**       | `proxy.{region}.nostria.app/api/cors-proxy` | Cross-origin resource fetching       |

### Desktop/Mobile

| Technology     | Purpose                       |
| -------------- | ----------------------------- |
| **Tauri**      | Desktop application packaging |
| **Bubblewrap** | Android TWA packaging         |
| **PWA**        | Progressive Web App support   |

---

## Application Architecture

### Project Structure

```
src/
├── app/
│   ├── api/              # Generated API clients
│   ├── components/       # Reusable UI components
│   ├── directives/       # Angular directives
│   ├── interfaces/       # TypeScript interfaces
│   ├── models/           # Data models
│   ├── pages/            # Route-level page components
│   ├── pipes/            # Angular pipes
│   ├── services/         # Business logic and data services
│   ├── utils/            # Utility functions
│   └── workers/          # Web workers
├── environments/         # Environment configurations
├── locale/               # i18n translation files
└── types/                # TypeScript type definitions
```

### Component Architecture

All components follow these patterns:

- **Standalone Components**: No NgModules; each component is self-contained
- **OnPush Change Detection**: `changeDetection: ChangeDetectionStrategy.OnPush`
- **Signal-Based State**: Using `signal()`, `computed()`, and `effect()`
- **Input/Output Functions**: `input()` and `output()` instead of decorators
- **Native Control Flow**: `@if`, `@for`, `@switch` instead of structural directives

```typescript
@Component({
  selector: "app-example",
  templateUrl: "./example.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExampleComponent {
  // Inputs using signal-based input()
  data = input.required<DataType>();
  optional = input<string>();

  // Outputs using output()
  selected = output<Item>();

  // Services using inject()
  private readonly service = inject(ExampleService);

  // Local state with signals
  items = signal<Item[]>([]);
  loading = signal(false);

  // Derived state with computed
  filteredItems = computed(() => this.items().filter((item) => item.active));
}
```

### Service Architecture

Services follow single-responsibility principle:

- **`providedIn: 'root'`**: Singleton services for global state
- **`inject()` Function**: Constructor injection via inject function
- **Signal-Based State**: Reactive state with signals
- **Lazy Loading**: On-demand service initialization where appropriate

---

## Nostr Protocol Implementation

### Supported NIPs

Nostria implements the following Nostr Implementation Possibilities (NIPs):

| NIP          | Name                              | Status         |
| ------------ | --------------------------------- | -------------- |
| NIP-01       | Basic protocol flow               | ✅ Implemented |
| NIP-02       | Contact List and Petnames         | ✅ Implemented |
| NIP-04       | Encrypted Direct Message (Legacy) | ✅ Implemented |
| NIP-05       | DNS-based identifiers             | ✅ Implemented |
| NIP-07       | Browser extension signing         | ✅ Implemented |
| NIP-09       | Event Deletion                    | ✅ Implemented |
| NIP-10       | Text Notes and Threads            | ✅ Implemented |
| NIP-11       | Relay Information                 | ✅ Implemented |
| NIP-17       | Private Direct Messages           | ✅ Implemented |
| NIP-18       | Reposts                           | ✅ Implemented |
| NIP-19       | bech32-encoded entities           | ✅ Implemented |
| NIP-21       | `nostr:` URL scheme               | ✅ Implemented |
| NIP-22       | Comments                          | ✅ Implemented |
| NIP-23       | Long-form Content (Articles)      | ✅ Implemented |
| NIP-25       | Reactions                         | ✅ Implemented |
| NIP-27       | Text Note References              | ✅ Implemented |
| NIP-30       | Custom Emoji                      | ✅ Implemented |
| NIP-36       | Sensitive Content                 | ✅ Implemented |
| NIP-42       | Relay Authentication              | ✅ Implemented |
| NIP-44       | Encrypted Payloads (Gift Wrap)    | ✅ Implemented |
| NIP-46       | Nostr Remote Signing              | ✅ Implemented |
| NIP-47       | Nostr Wallet Connect              | ✅ Implemented |
| NIP-50       | Keywords filter (Search)          | ✅ Implemented |
| NIP-51       | Lists (Bookmarks, Mutes)          | ✅ Implemented |
| NIP-52       | Calendar Events                   | ✅ Implemented |
| NIP-55       | Android Signer                    | ✅ Implemented |
| NIP-57       | Lightning Zaps                    | ✅ Implemented |
| NIP-58       | Badges                            | ✅ Implemented |
| NIP-65       | Relay List Metadata               | ✅ Implemented |
| NIP-68       | Picture-first feeds               | ✅ Implemented |
| NIP-71       | Video Events                      | ✅ Implemented |
| NIP-75       | Zap Goals                         | ✅ Implemented |
| NIP-98       | HTTP Auth                         | ✅ Implemented |
| NIP-A0       | Voice Messages                    | ✅ Implemented |
| BUD-01/02/03 | Blossom file storage              | ✅ Implemented |

### Opinionated Decisions

Nostria makes specific protocol decisions:

1. **NIP-65 Relay Flags**: READ/WRITE flags are ignored; all relays are both read and write.
2. **NIP-96**: Not implemented; Blossom is preferred for file storage
3. **NIP-58 Badges**: Both badge definition and badge claim are published to user's relays for self-contained data

### Timestamp Convention

**IMPORTANT**: Nostr uses Unix timestamps in **seconds**, not milliseconds:

```typescript
// Correct
const timestamp = Math.floor(Date.now() / 1000);

// Incorrect
const timestamp = Date.now(); // This is milliseconds!
```

---

## Backend Services

### Image Proxy Service

Used for all profile images **except** the profile details page (where full resolution is needed).

```typescript
// ImageCacheService usage
const optimizedUrl = imageCacheService.getOptimizedImageUrl(originalUrl);
// Returns: https://proxy.{region}.nostria.app/api/ImageOptimizeProxy?w=96&h=96&url=...
```

**Features:**

- Region-based routing (EU, US, etc.)
- Size optimization (default 96x96 for profiles)
- Caching headers for performance
- Configurable per user settings

### Metadata Service

Fetches OpenGraph metadata for URL previews:

```typescript
// OpenGraphService usage
const metadata = await opengraphService.getOpenGraphData(url);
// Fetches from: https://metadata.nostria.app/og?url=...
```

### CORS Proxy Service

For fetching cross-origin resources:

```typescript
// CorsProxyService usage
const proxyUrl = corsProxyService.getProxyUrl(targetUrl);
const response = await corsProxyService.fetch(url);
```

---

## UI/UX Architecture

### Design System

- **Material 3**: Full Angular Material 3 theming
- **Glass Effect**: Translucent toolbars and menus with blur effects
- **Dark/Light Mode**: System-aware with manual override
- **RTL Support**: Arabic and Persian locale support

### CSS Variables (Material 3)

## TODO: These are out of date, the colors. New color scheme to be added.

```scss
// Primary colors
--mat-sys-primary: #c5c0ff;
--mat-sys-on-primary: #2a2278;
--mat-sys-primary-container: #413b8f;

// Surface colors
--mat-sys-surface: #18111b;
--mat-sys-surface-container: #241d27;
--mat-sys-on-surface: #ecdeed;

// Semantic colors
--mat-sys-error: #ffb4ab;
--mat-success-color: #66bb6a;
--nostria-bitcoin: #ff6b1a;

// Elevation
--mat-sys-level0 through --mat-sys-level5

// Corner radius
--mat-sys-corner-small: 8px;
--mat-sys-corner-medium: 12px;
--mat-sys-corner-large: 16px;
```

### Dark Mode Styling

```scss
// Use :host-context for dark mode styles
:host-context(.dark) .your-class {
  background-color: var(--mat-sys-surface-container);
  color: var(--mat-sys-on-surface);
}
```

### Custom Dialog System

Nostria uses `CustomDialogComponent` instead of Angular Material dialogs for better mobile support:

```typescript
// CustomDialogService usage
const ref = customDialog.open(MyDialogComponent, {
  title: "Dialog Title",
  data: {
    /* ... */
  },
});

const result = await ref.closed.toPromise();
```

**Features:**

- Responsive: floating on desktop, full-screen on mobile
- Keyboard-aware: adjusts for mobile keyboard
- Enter key support for primary action
- Backdrop click to close

---

## State Management

### Signal-Based Architecture

```typescript
@Injectable({ providedIn: "root" })
export class StateService {
  // Writable signals for state
  private readonly _items = signal<Item[]>([]);

  // Read-only public access
  readonly items = this._items.asReadonly();

  // Computed derived state
  readonly activeItems = computed(() => this._items().filter((i) => i.active));

  // Effects for side effects
  constructor() {
    effect(() => {
      const items = this.items();
      this.persistToStorage(items);
    });
  }
}
```

### Key State Services

| Service                    | Purpose                       |
| -------------------------- | ----------------------------- |
| `AccountStateService`      | Current user account state    |
| `AccountLocalStateService` | Per-account local preferences |
| `ApplicationStateService`  | Global app state              |
| `ProfileStateService`      | Profile data management       |
| `FeedService`              | Feed configuration and data   |
| `SettingsService`          | User settings                 |
| `LocalSettingsService`     | Device-local settings         |

### AccountLocalStateService vs LocalSettingsService

These two services serve different purposes for local storage:

#### AccountLocalStateService

**Purpose**: Per-account UI preferences and caching metadata stored locally.

**When to use**: Settings that should be different for each Nostr account on the same device.

**Storage key**: `nostria-account-states` (stores a map keyed by pubkey)

**Examples**:

- `notificationLastCheck`: Timestamp of last notification check (per-account)
- `messagesLastCheck`: Timestamp of last messages check (per-account)
- `zapHistoryLastTimestamp`: Most recent zap timestamp for incremental fetching
- `activeFeed`: The currently selected feed for that account
- `favorites`: User's favorite items
- `musicYoursSectionCollapsed`: UI collapse state for music section
- `trustedMediaAuthors`: Authors whose media is auto-loaded

```typescript
// Usage
private accountLocalState = inject(AccountLocalStateService);

// Get per-account timestamp
const lastZapTimestamp = this.accountLocalState.getZapHistoryLastTimestamp(pubkey);

// Set per-account timestamp
this.accountLocalState.setZapHistoryLastTimestamp(pubkey, timestamp);
```

#### LocalSettingsService

**Purpose**: Technical/global settings that apply across all accounts on the device.

**When to use**: Device-level preferences that don't change based on which account is logged in.

**Storage key**: `nostria-local-settings`

**Examples**:

- `useProxy`: Whether to use the image proxy (network optimization)
- `proxyRegion`: Which regional proxy server to use
- `mediaServer`: Preferred media upload server
- `aiEnabled`: Whether AI features are enabled on this device
- `virtualKeyboardHeight`: Cached keyboard height for mobile

```typescript
// Usage
private localSettings = inject(LocalSettingsService);

// Get global setting
const useProxy = this.localSettings.settings().useProxy;

// Update global setting
this.localSettings.update({ useProxy: true });
```

#### Decision Guide

| Scenario                                    | Service to Use             |
| ------------------------------------------- | -------------------------- |
| "Remember my last feed selection"           | `AccountLocalStateService` |
| "Remember the proxy region for this device" | `LocalSettingsService`     |
| "Track when I last checked notifications"   | `AccountLocalStateService` |
| "Enable AI features on this device"         | `LocalSettingsService`     |
| "Cache timestamp for incremental fetching"  | `AccountLocalStateService` |
| "Store mobile keyboard height"              | `LocalSettingsService`     |

### Data Flow

```
User Action
    ↓
Component (handles UI event)
    ↓
Service (business logic, signal updates)
    ↓
Effect (side effects: persistence, API calls)
    ↓
Signal Update
    ↓
Computed Signals (derived state)
    ↓
Component Template (re-renders via OnPush)
```

---

## Navigation & Layout System

### Unified Menu System

The app uses a single unified menu that slides out from the left side. The menu button in the toolbar displays the user's profile image (or a generic icon if not authenticated).

**Key elements:**

- **Profile Button** (top-left toolbar): Shows user's profile picture, opens the unified left sidenav
- **Left Sidenav**: Contains user profile section with account switcher, navigation items, and settings
- **Right Toolbar Section**: Contains search, notifications, and right panel actions

The profile section at the top of the sidenav includes:

- User avatar and name
- Premium badge (if subscribed)
- Expandable account list for switching between accounts
- Quick action buttons (profile, credentials, settings, theme toggle)

### Two-Column Layout

The app uses a sophisticated two-column layout system:

```
┌──────────────────────────────────────────────────┐
│                    Toolbar                       │
├──────────────────────┬───────────────────────────┤
│                      │                           │
│    Left Panel        │     Right Panel           │
│    (700px)           │     (700px)               │
│                      │                           │
│    - Feeds           │    - Event details        │
│    - Music list      │    - Article content      │
│    - Activity        │    - Profile details      │
│                      │                           │
└──────────────────────┴───────────────────────────┘
```

**Responsive Behavior:**

- **Desktop (>1440px)**: Full two-column (700px + 700px)
- **Tablet (1024-1440px)**: Narrower columns (600px + 600px)
- **Mobile (<1024px)**: Right panel overlays left panel

### Key Navigation Services

| Service                  | Purpose                                  |
| ------------------------ | ---------------------------------------- |
| `RightPanelService`      | Manages right panel content stack        |
| `PanelNavigationService` | Coordinates left/right panel navigation  |
| `NavigationStackService` | Manages navigation history within panels |
| `TwoColumnLayoutService` | Column width and visibility              |
| `LayoutService`          | Screen size detection, dialog management |

### Right Panel Navigation

The right panel uses a component-based approach (not routing):

```typescript
// Open detail in right panel
rightPanelService.open(
  {
    component: EventPageComponent,
    inputs: { dialogEventId: eventId },
    title: "Thread",
  },
  `/e/${eventId}`,
);

// Navigate back
rightPanelService.goBack();

// Close panel
rightPanelService.close();
```

**Benefits:**

- Left panel state is preserved
- Clean URLs for sharing
- Independent navigation history
- No router-outlet conflicts

### Customizable Navigation Menu

The hamburger menu supports:

- Adding/removing items
- Drag-and-drop reordering
- Works on both desktop and mobile
- Persisted per-account

---

## Media Player System

### MediaPlayerService

Integrated media player supporting multiple formats:

```typescript
interface MediaItem {
  artwork: string;
  title: string;
  artist: string;
  source: string;
  type: "Music" | "Podcast" | "YouTube" | "Video" | "HLS" | "LiveKit" | "External";
  isLiveStream?: boolean;
  lyrics?: string;
}
```

**Features:**

- Shuffle and repeat modes
- Queue management with drag-and-drop
- Podcast progress tracking
- Offline music support
- YouTube integration
- Live stream viewer with full-screen mode
- Wake lock to prevent screen sleep
- Expandable player UI

### Playback Modes

- **Minimized**: Small bar at bottom of screen
- **Expanded**: Larger view with artwork and controls
- **Full-screen**: For video/live streams

---

## Authentication & Account Management

### Multi-Account Support

Users can manage multiple Nostr identities:

```typescript
interface NostrUser {
  pubkey: string;
  privkey?: string; // Plain hex or encrypted
  mnemonic?: string; // BIP39 phrase (encrypted)
  source: "extension" | "nsec" | "preview" | "remote" | "external";
  bunker?: BunkerPointer; // For NIP-46 remote signing
  isEncrypted?: boolean; // PIN protection flag
  preferredSigningMethod?: "local" | "remote";
}
```

### Authentication Methods

| Method                | NIP    | Description                               |
| --------------------- | ------ | ----------------------------------------- |
| **nsec**              | -      | Direct private key (can be PIN-encrypted) |
| **Browser Extension** | NIP-07 | window.nostr interface                    |
| **Remote Signer**     | NIP-46 | Bunker/NIP-46 protocol                    |
| **Android Signer**    | NIP-55 | Android intent-based signing              |

### PIN Protection

Private keys can be encrypted with a user PIN:

```typescript
// CryptoEncryptionService
const encrypted = await cryptoEncryption.encrypt(privateKey, pin);
const decrypted = await cryptoEncryption.decrypt(encrypted, pin);
```

---

## Relay Architecture

### Service Hierarchy

```
RelayServiceBase (relay.ts)
├── AccountRelayService    - User's personal relays
├── SharedRelayService     - Other users' relay discovery
└── DiscoveryRelayService  - Bootstrap/discovery relays

RelayPoolService           - Shared connection pool
SubscriptionManagerService - Global subscription coordination
RelaysService              - Relay statistics and configuration
```

### AccountRelayService

Manages the authenticated user's relay connections:

```typescript
// Initialization
await accountRelay.setAccount(pubkey);

// Usage
const event = await accountRelay.get(filter);
const subscription = accountRelay.subscribe(filter, onEvent, onEose);
await accountRelay.publish(event);
```

### SharedRelayService

For querying other users' content:

```typescript
// Automatically discovers user's relays
const profile = await sharedRelay.getUserProfile(pubkey);
```

### Subscription Limits

- **Maximum 50** total subscriptions
- **Maximum 10** subscriptions per relay
- Automatic deduplication
- Lifecycle tracking

---

## Encryption & Privacy

### Encryption Service

Supports both legacy and modern encryption:

| Protocol | NIP       | Use Case               |
| -------- | --------- | ---------------------- |
| NIP-04   | Legacy    | Old DM compatibility   |
| NIP-44   | Modern    | New encrypted messages |
| NIP-17   | Gift Wrap | Private DMs            |

```typescript
// EncryptionService usage
const encrypted = await encryption.encrypt(content, recipientPubkey);
const decrypted = await encryption.decrypt(content, senderPubkey);
```

### Bunker Queue Management

For remote signers, operations are queued to prevent overwhelming:

```typescript
// Operations queued with 100ms delay between
pendingBunkerOperations = signal(0);
isBunkerConnecting = signal(false);
```

---

## Performance Optimization

### Virtualization Principles

**Critical Rule**: Don't render all items even if available in memory:

```typescript
// Feed rendering with virtual scrolling
displayedItems = computed(() =>
  this.allItems().slice(0, this.visibleCount())
);

// Load more on scroll
onScroll(event: Event) {
  if (this.isNearBottom(event)) {
    this.visibleCount.update(n => n + 20);
  }
}
```

### CDK Virtual Scrolling

If an component already uses Virtual Scrolling, don't automatically change to a different architecture unless explicitly told to do so.

For lists with fixed-height items, use Angular CDK's `ScrollingModule`:

```typescript
import { ScrollingModule } from '@angular/cdk/scrolling';

@Component({
  imports: [ScrollingModule],
  template: `
    <cdk-virtual-scroll-viewport
      [itemSize]="72"
      [minBufferPx]="400"
      [maxBufferPx]="800"
      class="virtual-viewport">
      @for (item of items(); track item.id) {
        <div class="fixed-height-item">{{ item.name }}</div>
      }
    </cdk-virtual-scroll-viewport>
  `,
  styles: [`
    .virtual-viewport {
      height: 100%;
      /* or a fixed height like 500px */
    }
    .fixed-height-item {
      height: 72px; /* Must match itemSize */
    }
  `]
})
```

**When to use CDK Virtual Scrolling:**

- Lists with **fixed-height items** (notifications, zap history, following lists)
- Data sets with 100+ items
- Items that don't need dynamic resizing

**When NOT to use CDK Virtual Scrolling:**

- **Feeds with variable content** (notes with images, articles, reposts)
- Lists where items need to expand/collapse
- Content with unknown height until rendered

**Configuration Parameters:**
| Parameter | Purpose | Typical Value |
|-----------|---------|---------------|
| `itemSize` | Height of each item in pixels | 48-96 |
| `minBufferPx` | Minimum buffer of content to render | 400 |
| `maxBufferPx` | Maximum buffer of content to render | 800 |

**Fixed-Height Layout Strategies:**

For items with optional content (comments, metadata), use these techniques to maintain fixed height:

1. **Truncation with ellipsis**: Show first line with `...`
2. **Inline layout**: Move optional content to same row
3. **Tooltip for overflow**: Full content on hover
4. **Expandable rows**: Click to expand (use manual virtualization instead)

### Image Optimization

- **Profile images**: Always through image proxy (96x96)
- **Profile details page**: Original source (full resolution)
- **Lazy loading**: Images load as they enter viewport
- **Preloading**: Critical images preloaded in background

### Route Reuse Strategy

Custom `RouteReuseStrategy` preserves component state:

```typescript
@Injectable()
export class CustomReuseStrategy implements RouteReuseStrategy {
  // Preserves feed scroll position
  // Caches heavy components
  // Clears on major navigation changes
}
```

### Change Detection

- **OnPush everywhere**: Components only update on input changes
- **Signal-based**: Fine-grained reactivity
- **Computed caching**: Derived values cached until dependencies change

---

## Server-Side Rendering (SSR)

### SSR-Enabled Routes

```typescript
// app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  { path: "e/**", renderMode: RenderMode.Server }, // Events
  { path: "p/**", renderMode: RenderMode.Server }, // Profiles
  { path: "u/**", renderMode: RenderMode.Server }, // Usernames
  { path: "a/**", renderMode: RenderMode.Server }, // Articles
  { path: "stream/**", renderMode: RenderMode.Server },
  { path: "music/**", renderMode: RenderMode.Server },
  { path: "**", renderMode: RenderMode.Client }, // Everything else
];
```

### SSR Safety Rules

**CRITICAL**: Never access browser APIs directly:

```typescript
// ❌ WRONG - Will crash SSR
const width = window.innerWidth;

// ✅ CORRECT - Check platform first
import { isPlatformBrowser, PLATFORM_ID } from '@angular/common';

private platformId = inject(PLATFORM_ID);
private isBrowser = isPlatformBrowser(this.platformId);

if (this.isBrowser) {
  const width = window.innerWidth;
}
```

**Forbidden in SSR context:**

- `window`, `document`, `localStorage`
- `navigator`, `location`
- Any DOM manipulation

### MetaService

For social sharing previews:

```typescript
// MetaService usage for SSR
metaService.updateSocialMetadata({
  title: "Event Title",
  description: "Event content...",
  image: "https://...",
  url: "https://nostria.app/e/...",
  twitterCard: "summary_large_image",
});
```

---

## Platform Support

### Web (Primary)

- **URL**: https://nostria.app
- **PWA**: Installable with offline support
- **Service Worker**: Caching and background sync

### Desktop (Tauri)

```bash
npm run tauri dev      # Development
npm run tauri build    # Production build
```

**Features:**

- Native window management
- System tray integration
- Auto-updates

### Mobile

**Android TWA (Bubblewrap):**

```bash
bubblewrap init --manifest https://nostria.app/manifest.webmanifest
bubblewrap build
```

**Android Tauri:**

```bash
npm run tauri android init
npm run tauri android dev
```

---

## Content Creation

### Editors

| Type           | Component                      | Event Kind                  |
| -------------- | ------------------------------ | --------------------------- |
| **Note**       | `NoteEditorDialogComponent`    | 1                           |
| **Article**    | `ArticleEditorDialogComponent` | 30023                       |
| **Media**      | `MediaCreatorDialogComponent`  | Varies                      |
| **Video Clip** | `VideoRecordDialogComponent`   | 1063                        |
| **Audio Clip** | `AudioRecordDialogComponent`   | 1222 (root), 1244 (replies) |

### Publishing Flow

```
Content Creation
    ↓
NoteEditorDialog / ArticleEditor
    ↓
Event Construction (nostr-tools)
    ↓
Signing (local, extension, or remote)
    ↓
PublishService
    ↓
AccountRelayService.publish()
    ↓
Multiple relays (user's relay list)
```

### Media Upload

Uses Blossom protocol (BUD-01/02/03):

```typescript
// Upload to user's media servers
const uploadResult = await mediaService.uploadFile(file);
// Returns Blossom URL for inclusion in event
```

---

## Command Palette

### Overview

The Command Palette provides quick keyboard-driven access to all app features. It's opened with `Ctrl+K` (or `Cmd+K` on Mac) and supports both keyboard navigation and voice commands.

**Location**: `src/app/components/command-palette-dialog/`

### Features

- **Fuzzy Search**: Commands filtered by label and keywords
- **Keyboard Navigation**: Arrow keys, Enter to execute, Escape to close
- **Voice Commands**: Transcription via local AI (requires AI enabled)
- **Categorized Commands**: Navigation, actions, settings

### Command Structure

```typescript
interface Command {
  id: string; // Unique identifier (e.g., 'nav-music')
  label: string; // Display label (e.g., 'Open Music')
  icon: string; // Material icon name
  action: () => void; // Action to execute
  keywords?: string[]; // Search keywords for fuzzy matching
  description?: string; // Optional description
}
```

### Adding New Commands

**IMPORTANT**: When adding new features or routes to the app, always add corresponding commands to the Command Palette.

```typescript
// In command-palette-dialog.component.ts
commands: Command[] = [
  // ... existing commands
  {
    id: 'nav-newfeature',
    label: 'Open New Feature',
    icon: 'feature_icon',
    action: () => this.router.navigate(['/newfeature']),
    keywords: ['new feature', 'related', 'search', 'terms']
  },
];
```

### Command Categories

| Category                 | ID Prefix | Purpose                               |
| ------------------------ | --------- | ------------------------------------- |
| Navigation - Core        | `nav-`    | Home, Feeds, Messages, Notifications  |
| Navigation - Content     | `nav-`    | Articles, Music, Streams, Media       |
| Navigation - Collections | `nav-`    | Collections, Bookmarks, People, Lists |
| Navigation - Tools       | `nav-`    | Memos, Calendar, Polls, Analytics     |
| Navigation - Account     | `nav-`    | Profile, Settings, Accounts, Backup   |
| Actions                  | `act-`    | Create Note, Create Article, etc.     |

### Voice Commands

When AI transcription is enabled, users can speak commands:

- **Direct navigation**: "Open Music", "Go to Settings"
- **Search**: "Search <term>", "Find <term>"
- **Actions**: "Create Note", "Create Article"

---

## AI Features

### Overview

Nostria includes privacy-focused AI features powered by **Transformers.js**, which runs machine learning models entirely in the browser. No data is sent to external servers, ensuring complete privacy for users.

**Location**: `src/app/services/ai.service.ts` and `src/app/workers/ai.worker.ts`

### Architecture

```
User Request
    ↓
AiService (main thread)
    ↓
Web Worker (ai.worker.ts)
    ↓
Transformers.js (ONNX Runtime)
    ↓
Local ML Models (cached in browser)
```

### Supported Tasks

| Task                   | Model               | Use Case                            |
| ---------------------- | ------------------- | ----------------------------------- |
| **Summarization**      | distilbart-cnn-6-6  | Summarize long articles/threads     |
| **Translation**        | opus-mt-\*          | Translate content between languages |
| **Transcription**      | whisper-tiny        | Voice-to-text for command palette   |
| **Text-to-Speech**     | speecht5_tts        | Read content aloud                  |
| **Sentiment Analysis** | distilbert-sst-2    | Analyze content sentiment           |
| **Text Generation**    | LaMini-Flan-T5-783M | Generate text responses             |

### Privacy Model

**Key Principle**: All AI processing happens locally in the user's browser.

- Models are downloaded once and cached in IndexedDB
- No API calls to external AI services
- User content never leaves the device
- Full functionality works offline (after initial model download)

### Service Usage

```typescript
// AiService injection
private ai = inject(AiService);

// Check if AI is enabled in settings
if (this.settings.settings().aiEnabled) {
  // Summarize text
  const summary = await this.ai.summarizeText(longText);

  // Translate content
  const translated = await this.ai.translateText(
    text,
    'Xenova/opus-mt-es-en'  // Spanish to English
  );

  // Transcribe audio
  const transcript = await this.ai.transcribeAudio(audioData);
}
```

### Model Management

Models are managed through the AI Settings page (`/ai/settings`):

```typescript
// Load a model (downloads if not cached)
await ai.loadModel("summarization", ai.summarizationModelId, (progress) => {
  console.log("Download progress:", progress);
});

// Check if model is loaded/cached
const status = await ai.checkModel("summarization", modelId);
// { loaded: boolean, cached: boolean }

// Delete model from cache
await ai.deleteModelFromCache(modelId);

// Clear all cached models
await ai.clearAllCache();
```

### Settings Integration

AI features are controlled via user settings:

| Setting                  | Purpose                           |
| ------------------------ | --------------------------------- |
| `aiEnabled`              | Master toggle for all AI features |
| `aiSummarizationEnabled` | Enable content summarization      |
| `aiTranslationEnabled`   | Enable translation                |
| `aiTranscriptionEnabled` | Enable voice transcription        |
| `aiSpeechEnabled`        | Enable text-to-speech             |
| `aiSentimentEnabled`     | Enable sentiment analysis         |

### Web Worker Implementation

AI processing runs in a Web Worker to prevent UI blocking:

```typescript
// ai.worker.ts handles:
// - Model loading and caching
// - Inference execution
// - Progress reporting back to main thread

// Main thread receives:
// - 'progress' events during model download
// - 'error' events on failure
// - Result payload on success
```

### Available Translation Models

The app includes 50+ translation model pairs supporting languages including:

- European: English, Spanish, French, German, Italian, Portuguese, etc.
- Asian: Chinese, Japanese, Korean, Vietnamese, Thai, Hindi, etc.
- Other: Arabic, Russian, Ukrainian, Turkish, etc.

---

## Key Design Decisions

### 1. Standalone Components Over Modules

Every component is standalone to enable:

- Tree-shaking
- Faster compilation
- Clearer dependencies

### 2. Signals Over RxJS for State

Signals provide:

- Simpler mental model
- Automatic dependency tracking
- Better Angular integration
- Fine-grained reactivity

### 3. Custom Dialog Over Material Dialog

`CustomDialogComponent` provides:

- Better mobile keyboard handling
- Full-screen mobile mode
- Consistent styling
- Easier customization

### 4. Component-Based Right Panel

Instead of named router outlets:

- Preserves left panel state
- Simpler URL management
- Independent navigation stack
- Better performance

### 5. Region-Based Proxy Services

All backend services use regional routing:

- Lower latency
- Better reliability
- User proximity optimization

---

## Development Guidelines

### File Naming

- Components: `name.component.ts`
- Services: `name.service.ts`
- Interfaces: `name.interface.ts` or in `interfaces.ts`
- Tests: `name.spec.ts`

### Code Style

- **Prettier**: single quotes, CRLF
- **ESLint**: Angular ESLint rules
- **TypeScript**: Strict mode, no `any`

### Component Best Practices

```typescript
@Component({
  selector: "app-example",
  changeDetection: ChangeDetectionStrategy.OnPush,
  // No standalone: true needed (it's the default)
})
export class ExampleComponent {
  // ✅ Use input() and output()
  data = input.required<Data>();
  selected = output<Item>();

  // ✅ Use inject() for DI
  private service = inject(MyService);

  // ✅ Use signals for state
  items = signal<Item[]>([]);

  // ✅ Use computed for derived state
  activeCount = computed(() => this.items().filter((i) => i.active).length);

  // ❌ Don't use @HostBinding/@HostListener
  // ✅ Use host: {} in decorator instead
}
```

### Template Best Practices

```html
<!-- ✅ Use native control flow -->
@if (condition()) {
<div>Content</div>
} @for (item of items(); track item.id) {
<app-item [data]="item" />
}

<!-- ❌ Don't use structural directives -->
<div *ngIf="condition">...</div>
<div *ngFor="let item of items">...</div>

<!-- ❌ Don't use ngClass/ngStyle -->
<div [ngClass]="{'active': isActive}">...</div>

<!-- ✅ Use class/style bindings -->
<div [class.active]="isActive()">...</div>
```

### HTTP Requests

Always use `fetch` instead of `HttpClient`:

```typescript
// ✅ Correct
const response = await fetch(url);
const data = await response.json();

// ❌ Avoid
this.http.get(url).subscribe(data => ...);
```

### Testing

Nostria uses a comprehensive testing strategy with both unit tests (Karma/Jasmine) and end-to-end tests (Playwright).

**Unit Tests (Karma/Jasmine)**:

```bash
npm run test          # Run unit tests
```

**E2E Tests (Playwright)**:

```bash
npm run test:e2e          # Run all e2e tests
npm run test:e2e:ui       # Run with Playwright UI
npm run test:e2e:headed   # Run in headed browser mode
npm run test:e2e:debug    # Run in debug mode
npm run test:e2e:ai       # Run with AI-optimized settings (full artifacts)
npm run test:e2e:report   # View HTML test report
npm run test:e2e:codegen  # Generate tests via recording
```

**Other Tools**:

```bash
npm run lint          # Run linter
npm run format:check  # Check formatting
```

For complete E2E testing documentation, see [TESTING.md](TESTING.md).

---

## E2E Testing Architecture

### Overview

The E2E testing setup is designed for **AI/LLM-driven test automation**, with emphasis on:

- Structured output formats (JSON) for programmatic analysis
- Automatic screenshot and video capture
- Console log collection for debugging
- Semantic page analysis utilities

### Directory Structure

```
e2e/
├── fixtures.ts           # Extended test fixtures with AI utilities
├── global-setup.ts       # Pre-test setup (creates directories, metadata)
├── global-teardown.ts    # Post-test cleanup and summary generation
├── helpers/
│   └── ai-automation.ts  # AI-specific automation helpers
├── pages/
│   └── index.ts          # Page Object Models for all pages
└── tests/
    ├── home.spec.ts      # Home page tests
    ├── navigation.spec.ts # Navigation tests
    └── accessibility.spec.ts # Accessibility tests
```

### Test Artifacts

All test artifacts are stored in `test-results/`:

| Directory      | Contents                                 |
| -------------- | ---------------------------------------- |
| `screenshots/` | Named screenshots from tests             |
| `videos/`      | Video recordings (on failure by default) |
| `traces/`      | Playwright traces for debugging          |
| `logs/`        | Console log captures                     |
| `ai-states/`   | Page state snapshots for AI analysis     |
| `artifacts/`   | General test artifacts                   |

### AI Automation Features

The testing setup includes special utilities for AI-driven testing:

1. **Page State Capture**: Structured JSON containing all interactive elements, visible text, errors, and network requests
2. **Semantic Actions**: Natural language-like commands (`clickButton('Submit')`, `fillInput('Email', 'test@example.com')`)
3. **Console Log Collection**: Automatic capture of all console output for debugging
4. **Screenshot Helpers**: Named screenshots with timestamps

---

## Terminology

| Term        | Definition                                         |
| ----------- | -------------------------------------------------- |
| **Account** | User's identity within Nostria (can have multiple) |
| **User**    | Any Nostr user (not necessarily the current user)  |
| **Feed**    | Configured content stream with filters             |
| **Event**   | A Nostr protocol event (note, article, etc.)       |
| **Zap**     | Bitcoin Lightning payment via Nostr                |
| **Relay**   | WebSocket server for Nostr events                  |
| **Kind**    | Nostr event type number                            |

---

## References

- **Nostr Protocol**: https://github.com/nostr-protocol/nips
- **Angular**: https://angular.dev
- **Angular Material**: https://material.angular.io
- **Tauri**: https://tauri.app
- **Blossom**: https://github.com/hzrd149/blossom

---

_This document is the authoritative source for Nostria's architecture. AI assistants and developers should reference this when making changes to the codebase._
