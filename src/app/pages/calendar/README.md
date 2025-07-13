# Calendar Component

## Overview

This innovative calendar component implements support for Nostr calendar events according to **NIP-52** (Calendar Events) and **NIP-09** (Event Deletion). It provides a beautiful, user-friendly interface for viewing, creating, responding to, and managing calendar events on the Nostr network.

## Features

### 🎨 **Beautiful UI Design**
- **Material Design 3**: Full Angular Material integration with proper theming
- **Responsive Design**: Adapts seamlessly to desktop, tablet, and mobile devices
- **Dark/Light Theme**: Automatic theme support with proper color variables
- **Smooth Animations**: Elegant transitions and hover effects

### 📅 **Multiple View Modes**
1. **Month View**: Traditional calendar grid with event indicators
2. **Week View**: Time-slot based weekly schedule
3. **Agenda View**: Linear list of upcoming events with full details

### ⚡ **Modern Angular**
- **Signals & Effects**: Reactive state management using Angular's latest features
- **New Control Flow**: Uses `@if`, `@for`, `@let` instead of legacy directives
- **Standalone Components**: No module dependencies
- **TypeScript**: Full type safety with modern async/await patterns

### 🔗 **Nostr Integration**

#### NIP-52 Calendar Events Support
- **Date-based Events** (Kind 31922): All-day and multi-day events
- **Time-based Events** (Kind 31923): Specific time slots with timezone support
- **Event Metadata**: Title, summary, location, participants, hashtags
- **RSVP Support** (Kind 31925): Accept, decline, or tentative responses

#### NIP-09 Event Deletion
- **Secure Deletion**: Only event creators can delete their events
- **Proper Deletion Requests**: Following NIP-09 specification
- **Local State Updates**: Immediate UI updates after deletion

### 🛠 **Event Management**

#### Creating Events
- **Rich Event Dialog**: Beautiful form for creating new events
- **All-day Toggle**: Switch between date-based and time-based events
- **Smart Validation**: Form validation with helpful error messages
- **Hashtag Support**: Add categorization tags
- **Location Support**: Physical or virtual event locations

#### Viewing Events
- **Event Cards**: Rich display with all event details
- **Time Formatting**: Smart time display (12/24 hour, all-day indicators)
- **Status Indicators**: Visual RSVP status display
- **Participant Count**: Display number of attendees

#### Responding to Events
- **Quick RSVP**: One-click accept/decline/tentative responses
- **Context Menus**: Easy access to event actions
- **Status Persistence**: RSVP status saved and displayed

## Technical Implementation

### State Management
```typescript
// Reactive signals for state
events = signal<CalendarEvent[]>([]);
selectedDate = signal<Date>(new Date());
viewMode = signal<'month' | 'week' | 'agenda'>('month');

// Computed values for derived state
currentMonth = computed(() => { /* month calculations */ });
calendarGrid = computed(() => { /* calendar grid generation */ });
agendaEvents = computed(() => { /* grouped events by date */ });
```

### Event Loading
- **Relay Integration**: Uses `AccountRelayService` for Nostr communication
- **Subscription-based**: Real-time event updates through Nostr subscriptions
- **Date Range Filtering**: Efficient loading of events for visible date ranges
- **Fallback Handling**: Graceful handling of relay connection issues

### Accessibility
- **ARIA Labels**: Proper accessibility labels for screen readers
- **Keyboard Navigation**: Full keyboard support for all interactions
- **Color Contrast**: Material Design ensures proper contrast ratios
- **Focus Management**: Logical tab order and focus indicators

## Usage

### Basic Navigation
```html
<!-- Calendar is automatically routed at /calendar -->
<app-calendar></app-calendar>
```

### Event Creation
1. Click the "New Event" floating action button
2. Fill in the event details form
3. Choose between all-day or timed events
4. Add optional location, description, and hashtags
5. Click "Create Event" to publish to Nostr

### RSVP to Events
1. Find an event in any view mode
2. Click the three-dot menu on the event card
3. Select "Accept", "Maybe", or "Decline"
4. Your RSVP is published as a Kind 31925 event

### Event Deletion
1. Only your own events show the delete option
2. Click the three-dot menu on your event
3. Select "Delete Event"
4. A NIP-09 deletion request is published

## Demo Events

The component includes demo events for testing and demonstration:
- **Community Call**: Today at 2:00 PM (time-based)
- **Nostr Conference 2025**: Tomorrow all-day (date-based)
- **Team Retrospective**: Next week (time-based)

## Browser Support

- **Modern Browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Mobile Support**: iOS Safari, Chrome Mobile, Samsung Internet
- **PWA Ready**: Works in Progressive Web App environments

## Dependencies

- **Angular 20**: Latest Angular with signals and new control flow
- **Angular Material**: Complete Material Design component library
- **nostr-tools**: Nostr protocol implementation
- **date-fns**: Optional for advanced date formatting

## Future Enhancements

- [ ] **Recurring Events**: Support for recurring calendar events
- [ ] **Calendar Sync**: Import/export with external calendar systems
- [ ] **Timezone Support**: Advanced timezone handling for global events
- [ ] **Event Attachments**: Support for file attachments in events
- [ ] **Calendar Sharing**: Share calendar views with others
- [ ] **Advanced Filtering**: Filter events by hashtags, participants, etc.
- [ ] **Offline Support**: Cache events for offline viewing

## Contributing

This component follows the project's coding standards:
- Use signals and effects for state management
- Follow Angular Material design patterns
- Implement proper TypeScript typing
- Use new Angular control flow syntax
- Ensure responsive design and accessibility
