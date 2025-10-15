# Observed Relays Feature Redesign

## Overview
Updated the "Observed Relays" tab to use a cleaner, more compact list-based design inspired by a relay monitoring interface, replacing the previous card-based grid layout. Additionally, integrated NIP-11 relay information fetching to display detailed relay metadata when expanding relay details.

## Changes Made

### Template (relays.component.html)
- Replaced card-based grid with a table-like list layout
- Added collapsible row details with expand/collapse functionality
- Reorganized header to show sort controls and clear button together
- Implemented column-based layout showing:
  - Relay status icon and information
  - Event count
  - Connection attempts
  - Last connected time
  - Explore button
- Expandable details section showing:
  - **Statistics section**:
    - First observed timestamp
    - Last updated timestamp
    - Performance score with color-coded badge
  - **NIP-11 Relay Information section**:
    - Relay name and description
    - Software and version information
    - Supported NIPs (displayed as badges)
    - Limitations (payment required, auth required, etc.)
    - Contact information
    - Loading state while fetching
    - Error state if fetch fails
  - Remove from list action

### Component Logic (relays.component.ts)
Added new methods to support the redesigned interface:

1. **`toggleRelayDetails(url: string)`**: Toggle expanded state for a specific relay and trigger NIP-11 fetch
2. **`fetchNip11InfoForRelay(url: string)`**: Async method to fetch NIP-11 relay information document
3. **`isRelayExpanded(url: string)`**: Check if relay details are expanded
4. **`getNip11Info(url: string)`**: Get cached NIP-11 information for a relay
5. **`isNip11Loading(url: string)`**: Check if NIP-11 info is currently being fetched
6. **`getRelayDisplayName(url: string)`**: Extract and format a friendly display name from relay URL
7. **`getSignalClass(relay)`**: Determine CSS class for signal strength indicator
8. **`formatRelativeTime(timestamp: number)`**: Format timestamps as relative time (e.g., "2h ago", "3d ago")

Added signals for state management:
- **`expandedRelays`**: Tracks which relays have their details expanded
- **`nip11Info`**: Map of relay URL to NIP-11 information (cached)
- **`nip11Loading`**: Set of relay URLs currently fetching NIP-11 info

### Service Layer (relays.ts)
Added NIP-11 support to the RelaysService:

1. **`Nip11RelayInfo` interface**: Complete TypeScript interface matching NIP-11 specification including:
   - Basic info (name, description, icon, banner)
   - Administrative contacts (pubkey, contact)
   - Technical details (software, version, supported NIPs)
   - Server limitations (message length, subscriptions, auth requirements)
   - Content policies (retention, relay countries, language tags)
   - Payment information (fees, payment URL)

2. **`fetchNip11Info(relayUrl: string)`**: Async method to fetch NIP-11 information:
   - Converts WebSocket URL (wss://) to HTTP URL (https://)
   - Sends request with proper `Accept: application/nostr+json` header
   - Includes 10-second timeout to prevent hanging
   - Returns null on failure (gracefully handles errors)
   - Supports CORS as required by NIP-11 spec

### Styles (relays.component.scss)
- New list-based layout with header row and data rows
- Responsive grid system: 6 columns on desktop, collapsing to mobile-friendly layout
- Smooth expand/collapse animation for detail sections
- Status indicators with color coding (green for connected, yellow for disconnected, red for offline)
- Signal strength indicators with color gradients
- Performance badges with color-coded scoring
- **NIP-11 information styling**:
  - Organized sections with headers
  - NIP badges with primary color
  - Limitation badges with color coding (orange for payment, blue for auth, red for restricted)
  - Description text with proper wrapping
  - Links with hover effects
  - Loading/error states
- Mobile-responsive breakpoints at 1024px, 768px, and 480px

## Design Features

### Desktop Layout (>1024px)
- Full 6-column grid showing all information
- Header row with column labels
- Hover effects on rows
- Connected relays have subtle background highlight
- Expanded details show in two organized sections

### Tablet Layout (768px - 1024px)
- Reduced to 4 columns (hides "Connects" and "Last Connected")
- Most important info remains visible
- NIP-11 information fully visible

### Mobile Layout (<768px)
- Header hidden for cleaner appearance
- 2-column layout (expand button + relay info)
- Full-width "Explore" button
- All metrics moved to expanded details section
- NIP-11 information stacks vertically

## User Experience Improvements

1. **Better Information Density**: More relays visible at once in list format
2. **Quick Scanning**: Column-based layout makes it easy to compare metrics across relays
3. **Progressive Disclosure**: Details hidden by default, expandable on demand
4. **Visual Status Indicators**: Color-coded icons and signal strength for quick status checks
5. **Relative Time Display**: More intuitive "2h ago" format instead of full timestamps
6. **Responsive Design**: Optimized layouts for all screen sizes
7. **Rich Relay Metadata**: NIP-11 integration provides comprehensive relay information
8. **Async Loading**: NIP-11 data fetched on-demand without blocking UI
9. **Graceful Degradation**: Works even if relay doesn't support NIP-11
10. **Visual Feedback**: Loading spinner and error states for NIP-11 fetches

## NIP-11 Integration

### What is NIP-11?
NIP-11 (Relay Information Document) is a Nostr protocol standard that allows relays to expose metadata about themselves via HTTP. This includes:
- Relay name, description, and branding
- Software and version information
- Supported NIPs (protocol features)
- Server limitations and requirements
- Contact information
- Payment and authentication requirements
- Content policies

### Implementation Details
- **On-Demand Fetching**: NIP-11 info is only fetched when user expands relay details
- **Caching**: Results are cached in memory to avoid redundant requests
- **Timeout Protection**: 10-second timeout prevents hanging on unresponsive relays
- **Error Handling**: Gracefully handles relays that don't support NIP-11
- **Standard Compliant**: Sends proper `Accept: application/nostr+json` header as per spec
- **URL Conversion**: Automatically converts WebSocket URLs to HTTP for fetching

### Display Features
- **Organized Sections**: Statistics and NIP-11 info in separate, clearly labeled sections
- **Visual Hierarchy**: Important info highlighted with badges and colors
- **Supported NIPs**: Displayed as pill-shaped badges for easy scanning
- **Limitations**: Color-coded badges (payment, auth, restrictions) for quick identification
- **Links**: Clickable software URLs and contact information
- **Loading States**: Spinner indicates when fetch is in progress
- **Error States**: Clear message when NIP-11 unavailable

## Technical Notes

- Maintained backward compatibility with existing relay data structure
- All existing functionality preserved (view info, remove relay, clear all data)
- Animation uses CSS keyframes for smooth transitions
- Grid layout uses CSS Grid for flexible, responsive design
- Color scheme uses CSS custom properties for theme consistency
- NIP-11 fetching is non-blocking and doesn't impact performance
- Type-safe implementation with complete TypeScript interfaces
- Service layer handles all HTTP communication
- Component focuses on UI/UX concerns only

## Future Enhancements

Potential improvements for future iterations:
- Cache NIP-11 info to IndexedDB for persistence
- Add refresh button to re-fetch NIP-11 info
- Display relay icon/banner from NIP-11
- Filter relays by supported NIPs
- Show payment fees more prominently
- Highlight relays with specific features (paid, auth-required, etc.)
- Add relay comparison view
- Export relay information
