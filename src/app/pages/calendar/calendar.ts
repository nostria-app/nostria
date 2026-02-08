import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
import { Router } from '@angular/router';
import { LoggerService } from '../../services/logger.service';
import { ApplicationService } from '../../services/application.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { ChroniaCalendarService } from '../../services/chronia-calendar.service';
import { GregorianCalendarService } from '../../services/gregorian-calendar.service';
import { EthiopianCalendarService } from '../../services/ethiopian-calendar.service';
import {
  CreateEventDialogComponent,
  CreateEventDialogData,
  CreateEventResult,
} from './create-event-dialog/create-event-dialog.component';
import {
  EventDetailsDialogComponent,
  EventDetailsDialogData,
  EventDetailsResult,
} from './event-details-dialog/event-details-dialog.component';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UtilitiesService } from '../../services/utilities.service';
import { UserRelaysService } from '../../services/relays/user-relays';

// Calendar event interfaces based on NIP-52
interface CalendarEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 31922 | 31923; // Date-based or time-based
  content: string;
  tags: string[][];
  // Parsed fields
  title: string;
  summary?: string;
  image?: string;
  location?: string;
  start: Date;
  end?: Date;
  participants: string[];
  hashtags: string[];
  isAllDay: boolean;
  status?: 'accepted' | 'declined' | 'tentative';
}

interface CalendarEventRSVP {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 31925;
  content: string;
  tags: string[][];
  // Parsed fields
  eventId: string;
  status: 'accepted' | 'declined' | 'tentative';
  freeBusy?: 'free' | 'busy';
}

interface CalendarCollection {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 31924;
  content: string;
  tags: string[][];
  title: string;
  events: string[]; // Array of event coordinates
}

@Component({
  selector: 'app-calendar',
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatInputModule,
    MatFormFieldModule,
    MatNativeDateModule,
    MatButtonToggleModule,
    MatChipsModule,
    MatMenuModule,
    MatDialogModule,
    MatTooltipModule,
    MatBadgeModule,
    MatProgressBarModule,
    MatDividerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './calendar.html',
  styleUrl: './calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Calendar {
  private accountRelay = inject(AccountRelayService);
  private utilities = inject(UtilitiesService);
  private userRelaysService = inject(UserRelaysService);
  private logger = inject(LoggerService);
  public app = inject(ApplicationService); // Made public for template access
  private dialog = inject(MatDialog);
  private router = inject(Router);
  public localSettings = inject(LocalSettingsService); // For calendar type
  private chroniaService = inject(ChroniaCalendarService);
  private gregorianService = inject(GregorianCalendarService);
  private ethiopianService = inject(EthiopianCalendarService);
  public accountState = inject(AccountStateService);
  private destroyRef = inject(DestroyRef);

  // Premium check
  isPremium = computed(() => {
    const subscription = this.accountState.subscription();
    return subscription?.expires && subscription.expires > Date.now();
  });

  // Current view state
  selectedDate = signal<Date>(new Date());
  viewMode = signal<'month' | 'week' | 'agenda'>('month');
  selectedDateControl = new FormControl(new Date());

  // Calendar events state
  events = signal<CalendarEvent[]>([]);
  rsvps = signal<CalendarEventRSVP[]>([]);
  isLoading = signal<boolean>(false);

  // Calendar collections state (kind 31924)
  calendars = signal<CalendarCollection[]>([]);
  enabledCalendars = signal<Set<string>>(new Set()); // Calendar IDs that are enabled
  isLoadingCalendars = signal<boolean>(false);

  // Helper arrays for template
  dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  hoursArray = Array.from({ length: 24 }, (_, i) => i);
  weekDaysArray = Array.from({ length: 7 }, (_, i) => i);

  // Computed values
  currentMonth = computed(() => {
    const date = this.selectedDate();
    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      const chroniaDate = this.chroniaService.fromDate(date);
      if (chroniaDate.isSolsticeDay) {
        return {
          year: chroniaDate.year,
          month: 0,
          name: `Solstice Day, Year ${chroniaDate.year}`,
        };
      }
      if (chroniaDate.isLeapDay) {
        return {
          year: chroniaDate.year,
          month: 0,
          name: `Leap Day, Year ${chroniaDate.year}`,
        };
      }
      const monthName = this.chroniaService.getMonthName(chroniaDate.month);
      return {
        year: chroniaDate.year,
        month: chroniaDate.month,
        name: `${monthName}, Year ${chroniaDate.year}`,
      };
    }

    if (calendarType === 'ethiopian') {
      const ethiopianDate = this.ethiopianService.fromDate(date);
      const monthName = this.ethiopianService.getMonthName(ethiopianDate.month);
      return {
        year: ethiopianDate.year,
        month: ethiopianDate.month,
        name: `${monthName}, ${ethiopianDate.year}`,
      };
    }

    // Use localized Gregorian month name
    const monthName = this.gregorianService.getMonthName(date.getMonth() + 1);
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      name: `${monthName} ${date.getFullYear()}`,
    };
  });

  // Calendar grid for month view
  calendarGrid = computed(() => {
    const date = this.selectedDate();
    const year = date.getFullYear();
    const month = date.getMonth();

    // Get first day of month and calculate starting point
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay()); // Start on Sunday

    const weeks: Date[][] = [];
    let currentWeek: Date[] = [];

    for (let i = 0; i < 42; i++) {
      // 6 weeks max
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);

      currentWeek.push(currentDate);

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }

      // Stop if we've gone past the month and filled a week
      if (currentDate > lastDay && currentWeek.length === 0) {
        break;
      }
    }

    return weeks;
  });

  // Week dates for week view
  weekDates = computed(() => {
    const selected = this.selectedDate();
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(
        selected.getFullYear(),
        selected.getMonth(),
        selected.getDate() - selected.getDay() + i
      );
      dates.push(date);
    }
    return dates;
  });

  // Events for selected date
  selectedDateEvents = computed(() => {
    const selected = this.selectedDate();
    return this.events().filter(event => {
      return (
        this.isSameDay(event.start, selected) ||
        (event.end && this.isDateInRange(selected, event.start, event.end))
      );
    });
  });

  // Events for the current week
  weekEvents = computed(() => {
    const weekDates = this.weekDates();
    return this.events().filter(event => {
      return weekDates.some(date => this.isSameDay(event.start, date));
    });
  });

  // Events grouped by date for agenda view
  agendaEvents = computed(() => {
    const events = this.events();
    const groupedEvents = new Map<string, CalendarEvent[]>();

    events.forEach(event => {
      const dateKey = event.start.toDateString();
      if (!groupedEvents.has(dateKey)) {
        groupedEvents.set(dateKey, []);
      }
      groupedEvents.get(dateKey)!.push(event);
    });

    // Convert to array and sort by date
    return Array.from(groupedEvents.entries())
      .map(([dateStr, events]) => ({
        date: new Date(dateStr),
        events: events.sort((a, b) => a.start.getTime() - b.start.getTime()),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  // Filtered events based on enabled calendars
  filteredEvents = computed(() => {
    const allEvents = this.events();
    const enabledCals = this.enabledCalendars();

    // If no calendars are specifically enabled, show all events
    if (enabledCals.size === 0) {
      return allEvents;
    }

    // Filter events based on enabled calendars
    return allEvents.filter(event => {
      // Check if event belongs to an enabled calendar
      const calendars = this.calendars();
      const eventCalendar = calendars.find(cal =>
        cal.events.some(eventCoord => eventCoord.includes(event.id))
      );

      return eventCalendar ? enabledCals.has(eventCalendar.id) : true;
    });
  });

  // Override existing computed values to use filtered events
  selectedDateEventsFiltered = computed(() => {
    const selected = this.selectedDate();
    return this.filteredEvents().filter(event => {
      return (
        this.isSameDay(event.start, selected) ||
        (event.end && this.isDateInRange(selected, event.start, event.end))
      );
    });
  });

  weekEventsFiltered = computed(() => {
    const weekDates = this.weekDates();
    return this.filteredEvents().filter(event => {
      return weekDates.some(date => this.isSameDay(event.start, date));
    });
  });

  agendaEventsFiltered = computed(() => {
    const events = this.filteredEvents();
    const groupedEvents = new Map<string, CalendarEvent[]>();

    events.forEach(event => {
      const dateKey = event.start.toDateString();
      if (!groupedEvents.has(dateKey)) {
        groupedEvents.set(dateKey, []);
      }
      groupedEvents.get(dateKey)!.push(event);
    });

    return Array.from(groupedEvents.entries())
      .map(([dateStr, events]) => ({
        date: new Date(dateStr),
        events: events.sort((a, b) => a.start.getTime() - b.start.getTime()),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  constructor() {
    // Effect to load events when date changes
    effect(async () => {
      const date = this.selectedDate();
      await this.loadEventsForMonth(date);
    });

    // Handle date picker changes with proper cleanup
    this.selectedDateControl.valueChanges.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(date => {
      if (date) {
        this.selectedDate.set(date);
      }
    });

    // Check for event parameter in URL on load
    this.checkForEventInUrl();

    // Initial load
    this.loadCurrentUserEvents();
    this.loadCalendars();

    // Add some demo events for testing
    // this.addDemoEvents();
  }

  // Check if there's an event parameter in the URL and open the event details
  private async checkForEventInUrl(): Promise<void> {
    const urlParams = new URLSearchParams(window.location.search);
    const eventParam = urlParams.get('event');

    if (eventParam) {
      try {
        const [kind, pubkey, dTag] = eventParam.split(':');

        // Wait a moment for events to load, then try to find and open the event
        setTimeout(() => {
          const event = this.events().find(
            e => e.kind.toString() === kind && e.pubkey === pubkey && this.getEventDTag(e) === dTag
          );

          if (event) {
            this.openEventDetails(event);
          } else {
            // If event not found, try to load it specifically
            this.loadSpecificEvent(kind, pubkey, dTag);
          }
        }, 1000);
      } catch (error) {
        this.logger.error('Error parsing event parameter from URL', error);
      }
    }
  }

  // Load a specific event by its coordinates
  private async loadSpecificEvent(kind: string, pubkey: string, dTag: string): Promise<void> {
    try {
      // Note: We need to use a more generic filter since the relay types may not support #d
      this.accountRelay.subscribe(
        {
          kinds: [parseInt(kind)],
          authors: [pubkey],
          limit: 10, // Get a few events and filter manually
        }
        ,
        (event: Event) => {
          // Check if this event has the matching d tag
          const eventDTag = event.tags.find(tag => tag[0] === 'd')?.[1];
          if (eventDTag === dTag) {
            const calendarEvent = this.parseCalendarEvent(event);
            if (calendarEvent) {
              this.addEvent(calendarEvent);
              this.openEventDetails(calendarEvent);
            }
          }
        }
      );
    } catch (error) {
      this.logger.error('Error loading specific event', error);
    }
  }

  // Calendar collection management methods
  async loadCalendars(): Promise<void> {
    if (!this.app.accountState.pubkey()) {
      this.logger.warn('No user logged in, cannot load calendars');
      return;
    }

    this.isLoadingCalendars.set(true);

    try {
      // Load calendars (kind 31924) for current user and followed users
      this.accountRelay.subscribe(
        {
          kinds: [31924], // Calendar collections
          // authors: [this.app.accountState.pubkey()!], // Start with user's own calendars
          limit: 50,
        },
        (event: Event) => {
          const calendar = this.parseCalendar(event);
          if (calendar) {
            this.addCalendar(calendar);
          }
        }
      );
    } catch (error) {
      this.logger.error('Error loading calendars', error);
    } finally {
      this.isLoadingCalendars.set(false);
    }
  }

  private parseCalendar(event: Event): CalendarCollection | null {
    try {
      const tags = new Map(event.tags.map(tag => [tag[0], tag.slice(1)]));
      const title = tags.get('title')?.[0] || 'Untitled Calendar';

      // Get event references (a tags)
      const events = event.tags.filter(tag => tag[0] === 'a').map(tag => tag[1]);

      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: 31924,
        content: event.content,
        tags: event.tags,
        title,
        events,
      };
    } catch (error) {
      this.logger.error('Error parsing calendar', error);
      return null;
    }
  }

  private addCalendar(calendar: CalendarCollection): void {
    const currentCalendars = this.calendars();
    const existingIndex = currentCalendars.findIndex(c => c.id === calendar.id);

    if (existingIndex >= 0) {
      // Update existing calendar
      const updatedCalendars = [...currentCalendars];
      updatedCalendars[existingIndex] = calendar;
      this.calendars.set(updatedCalendars);
    } else {
      // Add new calendar and enable it by default
      this.calendars.set([...currentCalendars, calendar]);
      this.enabledCalendars.update(enabled => new Set(enabled).add(calendar.id));
    }
  }

  toggleCalendar(calendarId: string): void {
    this.enabledCalendars.update(enabled => {
      const newEnabled = new Set(enabled);
      if (newEnabled.has(calendarId)) {
        newEnabled.delete(calendarId);
      } else {
        newEnabled.add(calendarId);
      }
      return newEnabled;
    });
  }

  isCalendarEnabled(calendarId: string): boolean {
    return this.enabledCalendars().has(calendarId);
  }

  // Demo events for testing the calendar UI
  private addDemoEvents(): void {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const demoEvents: CalendarEvent[] = [
      {
        id: 'demo-1',
        pubkey: this.app.accountState.pubkey() || 'demo-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 31923,
        content:
          'Join our weekly community call to discuss latest developments and upcoming features.',
        tags: [
          ['d', 'demo-1'],
          ['title', 'Community Call'],
          ['start', Math.floor(today.getTime() / 1000).toString()],
        ],
        title: 'Community Call',
        summary: 'Weekly sync with the development team',
        location: 'Virtual - Jitsi Meet',
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0),
        end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0),
        participants: [],
        hashtags: ['community', 'meeting'],
        isAllDay: false,
      },
      {
        id: 'demo-2',
        pubkey: this.app.accountState.pubkey() || 'demo-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 31922,
        content: 'Annual conference focusing on decentralized technologies and protocols.',
        tags: [
          ['d', 'demo-2'],
          ['title', 'Nostr Conference 2025'],
          ['start', tomorrow.toISOString().split('T')[0]],
        ],
        title: 'Nostr Conference 2025',
        summary: 'Annual gathering of the Nostr community',
        location: 'Austin, Texas',
        start: tomorrow,
        end: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 2),
        participants: [],
        hashtags: ['conference', 'nostr', 'decentralized'],
        isAllDay: true,
      },
      {
        id: 'demo-3',
        pubkey: this.app.accountState.pubkey() || 'demo-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 31923,
        content: 'Monthly retrospective to review progress and plan upcoming work.',
        tags: [
          ['d', 'demo-3'],
          ['title', 'Team Retrospective'],
          ['start', Math.floor(nextWeek.getTime() / 1000).toString()],
        ],
        title: 'Team Retrospective',
        summary: 'Monthly team meeting',
        location: 'Conference Room A',
        start: new Date(nextWeek.getFullYear(), nextWeek.getMonth(), nextWeek.getDate(), 10, 0),
        end: new Date(nextWeek.getFullYear(), nextWeek.getMonth(), nextWeek.getDate(), 11, 30),
        participants: [],
        hashtags: ['team', 'retrospective'],
        isAllDay: false,
      },
    ];

    this.events.set(demoEvents);
  }

  // Navigation methods
  previousMonth(): void {
    const current = this.selectedDate();
    const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    this.selectedDate.set(previous);
  }

  nextMonth(): void {
    const current = this.selectedDate();
    const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    this.selectedDate.set(next);
  }

  goToToday(): void {
    this.selectedDate.set(new Date());
  }

  selectDate(date: Date): void {
    this.selectedDate.set(date);
  }

  // View mode management
  onViewModeChange(mode: 'month' | 'week' | 'agenda'): void {
    this.logger.debug('View mode change requested:', mode);
    this.viewMode.set(mode);
  }

  // Event loading methods
  private async loadCurrentUserEvents(): Promise<void> {
    if (!this.app.accountState.pubkey()) {
      this.logger.warn('No user logged in, cannot load calendar events');
      return;
    }

    this.isLoading.set(true);

    try {
      // Load calendar events (both date and time based)
      await Promise.all([this.loadDateBasedEvents(), this.loadTimeBasedEvents(), this.loadRSVPs()]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadEventsForMonth(date: Date): Promise<void> {
    // Calculate month range
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    // Load events for the month range
    await this.loadEventsInRange(startOfMonth, endOfMonth);
  }

  private async loadEventsInRange(start: Date, end: Date): Promise<void> {
    if (!this.app.accountState.pubkey()) return;

    const since = Math.floor(start.getTime() / 1000);
    const until = Math.floor(end.getTime() / 1000);

    try {
      // Create subscription for events in date range
      this.accountRelay.subscribe(
        {
          kinds: [31922, 31923], // Date-based and time-based calendar events
          since,
          until,
          limit: 100,
        },
        (event: Event) => {
          const calendarEvent = this.parseCalendarEvent(event);
          if (calendarEvent) {
            this.addEvent(calendarEvent);
          }
        }
      );
    } catch (error) {
      this.logger.error('Error loading calendar events', error);
    }
  }

  private async loadDateBasedEvents(): Promise<void> {
    // Implementation for loading date-based events (kind 31922)
    // This would typically load events for the current user and followed users
  }

  private async loadTimeBasedEvents(): Promise<void> {
    // Implementation for loading time-based events (kind 31923)
  }

  private async loadRSVPs(): Promise<void> {
    // Implementation for loading RSVPs (kind 31925)
  }

  // Event parsing methods
  private parseCalendarEvent(event: Event): CalendarEvent | null {
    try {
      const tags = new Map(event.tags.map(tag => [tag[0], tag.slice(1)]));

      const title = tags.get('title')?.[0] || 'Untitled Event';
      const summary = tags.get('summary')?.[0];
      const image = tags.get('image')?.[0];
      const location = tags.get('location')?.[0];

      let start: Date;
      let end: Date | undefined;
      let isAllDay: boolean;

      if (event.kind === 31922) {
        // Date-based event
        const startDate = tags.get('start')?.[0];
        const endDate = tags.get('end')?.[0];

        if (!startDate) return null;

        start = new Date(startDate + 'T00:00:00');
        end = endDate ? new Date(endDate + 'T00:00:00') : undefined;
        isAllDay = true;
      } else {
        // Time-based event
        const startTimestamp = tags.get('start')?.[0];
        const endTimestamp = tags.get('end')?.[0];

        if (!startTimestamp) return null;

        start = new Date(parseInt(startTimestamp) * 1000);
        end = endTimestamp ? new Date(parseInt(endTimestamp) * 1000) : undefined;
        isAllDay = false;
      }

      const participants = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);

      const hashtags = event.tags.filter(tag => tag[0] === 't').map(tag => tag[1]);

      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind as 31922 | 31923,
        content: event.content,
        tags: event.tags,
        title,
        summary,
        image,
        location,
        start,
        end,
        participants,
        hashtags,
        isAllDay,
      };
    } catch (error) {
      this.logger.error('Error parsing calendar event', error);
      return null;
    }
  }

  // Event management methods
  private addEvent(event: CalendarEvent): void {
    const currentEvents = this.events();
    const existingIndex = currentEvents.findIndex(e => e.id === event.id);

    if (existingIndex >= 0) {
      // Update existing event
      const updatedEvents = [...currentEvents];
      updatedEvents[existingIndex] = event;
      this.events.set(updatedEvents);
    } else {
      // Add new event
      this.events.set([...currentEvents, event]);
    }
  }

  async createEvent(): Promise<void> {
    const dialogData: CreateEventDialogData = {
      selectedDate: this.selectedDate(),
    };

    const dialogRef = this.dialog.open(CreateEventDialogComponent, {
      data: dialogData,
      width: '600px',
      maxWidth: '90vw',
      maxHeight: '90vh',
      disableClose: false,
      autoFocus: true,
    });

    const result = (await dialogRef.afterClosed().toPromise()) as CreateEventResult | undefined;

    if (result?.event) {
      this.logger.info('New calendar event created:', result.event);

      // Parse and add the new event to our local signal
      const calendarEvent = this.parseCalendarEvent(result.event);
      if (calendarEvent) {
        this.addEvent(calendarEvent);
      }
    }
  }

  async respondToEvent(
    event: CalendarEvent,
    status: 'accepted' | 'declined' | 'tentative'
  ): Promise<void> {
    if (!this.app.accountState.pubkey()) {
      this.logger.error('User not logged in');
      return;
    }

    try {
      // Create RSVP event (kind 31925)
      const rsvpEvent = {
        kind: 31925,
        content: '',
        tags: [
          ['a', `${event.kind}:${event.pubkey}:${this.getEventDTag(event)}`],
          ['e', event.id],
          ['d', this.generateRandomId()],
          ['status', status],
          ['p', event.pubkey],
        ],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: this.app.accountState.pubkey()!,
      };

      // Sign and publish the RSVP
      // TODO: Implement signing with user's private key
    } catch (error) {
      this.logger.error('Error responding to event', error);
    }
  }

  async deleteEvent(event: CalendarEvent): Promise<void> {
    if (!this.app.accountState.pubkey() || event.pubkey !== this.app.accountState.pubkey()) {
      this.logger.error('Cannot delete event: not authorized');
      return;
    }

    try {
      // Create deletion request event (kind 5) according to NIP-09
      const deletionEvent = {
        kind: 5,
        content: 'Calendar event deleted',
        tags: [
          ['e', event.id],
          ['a', `${event.kind}:${event.pubkey}:${this.getEventDTag(event)}`],
          ['k', event.kind.toString()],
        ],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: this.app.accountState.pubkey()!,
      };

      // Sign and publish the deletion
      // TODO: Implement signing with user's private key

      // Remove from local state
      const updatedEvents = this.events().filter(e => e.id !== event.id);
      this.events.set(updatedEvents);
    } catch (error) {
      this.logger.error('Error deleting event', error);
    }
  }

  // Utility methods
  private getEventDTag(event: CalendarEvent): string {
    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag ? dTag[1] : '';
  }

  private generateRandomId(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }

  getEventsForDate(date: Date): CalendarEvent[] {
    return this.filteredEvents().filter(event => {
      return (
        this.isSameDay(event.start, date) ||
        (event.end && this.isDateInRange(date, event.start, event.end))
      );
    });
  }

  isCurrentMonth(date: Date): boolean {
    const current = this.selectedDate();
    return date.getMonth() === current.getMonth() && date.getFullYear() === current.getFullYear();
  }

  isToday(date: Date): boolean {
    const today = new Date();
    return this.isSameDay(date, today);
  }

  isSelectedDate(date: Date): boolean {
    return this.isSameDay(date, this.selectedDate());
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  }

  private isDateInRange(date: Date, start: Date, end: Date): boolean {
    const dateTime = date.getTime();
    return dateTime >= start.getTime() && dateTime < end.getTime();
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  formatDateShort(date: Date): string {
    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      const chroniaDate = this.chroniaService.fromDate(date);
      if (chroniaDate.isSolsticeDay) {
        return 'Solstice';
      }
      if (chroniaDate.isLeapDay) {
        return 'Leap Day';
      }
      const monthName = this.chroniaService.getMonthName(chroniaDate.month);
      return `${monthName.substring(0, 3)} ${chroniaDate.day}`;
    }

    if (calendarType === 'ethiopian') {
      const ethiopianDate = this.ethiopianService.fromDate(date);
      const shortMonthName = this.ethiopianService.getShortMonthName(ethiopianDate.month);
      return `${shortMonthName} ${ethiopianDate.day}`;
    }

    // Use localized Gregorian month names
    const shortMonthName = this.gregorianService.getShortMonthName(date.getMonth() + 1);
    return `${shortMonthName} ${date.getDate()}`;
  }

  formatDateFull(date: Date): string {
    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      const chroniaDate = this.chroniaService.fromDate(date);
      return this.chroniaService.format(chroniaDate, 'longDate');
    }

    if (calendarType === 'ethiopian') {
      const ethiopianDate = this.ethiopianService.fromDate(date);
      return this.ethiopianService.format(ethiopianDate, 'longDate');
    }

    // Use localized Gregorian month names
    const monthName = this.gregorianService.getMonthName(date.getMonth() + 1);
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekday = weekdays[date.getDay()];
    return `${weekday}, ${monthName} ${date.getDate()}, ${date.getFullYear()}`;
  }

  formatDateMedium(date: Date): string {
    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      const chroniaDate = this.chroniaService.fromDate(date);
      return this.chroniaService.format(chroniaDate, 'mediumDate');
    }

    if (calendarType === 'ethiopian') {
      const ethiopianDate = this.ethiopianService.fromDate(date);
      return this.ethiopianService.format(ethiopianDate, 'mediumDate');
    }

    // Use localized Gregorian month names
    const shortMonthName = this.gregorianService.getShortMonthName(date.getMonth() + 1);
    const shortWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekday = shortWeekdays[date.getDay()];
    return `${weekday}, ${shortMonthName} ${date.getDate()}`;
  }

  // Pre-computed week grid: Map<'dayIndex-hour', CalendarEvent[]> to avoid per-cell filtering in template
  weekEventGrid = computed(() => {
    const grid = new Map<string, CalendarEvent[]>();
    const weekDates = this.weekDates();
    const events = this.weekEventsFiltered();

    // Initialize grid
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        grid.set(`${day}-${hour}`, []);
      }
    }

    // Distribute events into grid cells
    for (const event of events) {
      for (let day = 0; day < weekDates.length; day++) {
        if (!this.isSameDay(event.start, weekDates[day])) continue;
        const hour = event.isAllDay ? 0 : event.start.getHours();
        const key = `${day}-${hour}`;
        grid.get(key)!.push(event);
      }
    }

    return grid;
  });

  // Get events for a specific hour and day in week view (uses pre-computed grid)
  getEventsForWeekHour(dayIndex: number, hour: number): CalendarEvent[] {
    return this.weekEventGrid().get(`${dayIndex}-${hour}`) || [];
  }

  selectWeekCell(dayIndex: number, hour: number): void {
    const weekDates = this.weekDates();
    const selectedDate = new Date(weekDates[dayIndex]);
    selectedDate.setHours(hour, 0, 0, 0);
    this.selectedDate.set(selectedDate);
  }

  async openEventDetails(event: CalendarEvent): Promise<void> {
    // Update URL to reflect the selected event
    const eventDTag = this.getEventDTag(event);
    this.router.navigate([], {
      queryParams: { event: `${event.kind}:${event.pubkey}:${eventDTag}` },
      queryParamsHandling: 'merge',
    });

    const dialogRef = this.dialog.open(EventDetailsDialogComponent, {
      data: {
        event,
        canEdit: event.pubkey === this.app.accountState.pubkey(),
        canDelete: event.pubkey === this.app.accountState.pubkey(),
        currentUserPubkey: this.app.accountState.pubkey(),
      } as EventDetailsDialogData,
      width: '600px',
      maxWidth: '90vw',
      autoFocus: false,
    });

    const result = (await dialogRef.afterClosed().toPromise()) as EventDetailsResult;

    // Clear event from URL when dialog closes
    this.router.navigate([], {
      queryParams: { event: null },
      queryParamsHandling: 'merge',
    });

    if (!result || result.action === 'close') {
      return;
    }

    switch (result.action) {
      case 'rsvp':
        if (result.rsvpStatus) {
          await this.respondToEvent(event, result.rsvpStatus);
        }
        break;
      case 'edit':
        // TODO: Implement edit functionality
        break;
      case 'delete':
        await this.deleteEvent(event);
        break;
      case 'share':
        this.shareEvent(event);
        break;
    }
  }

  async shareEvent(event: CalendarEvent): Promise<void> {
    const eventDTag = this.getEventDTag(event);
    await this.userRelaysService.ensureRelaysForPubkey(event.pubkey);
    const authorRelays = this.userRelaysService.getRelaysForPubkey(event.pubkey);
    const relayHint = authorRelays[0];
    const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
    const naddr = nip19.naddrEncode({
      identifier: eventDTag,
      pubkey: event.pubkey,
      kind: event.kind,
      relays: relayHints,
    });
    const shareUrl = `https://nostria.app/a/${naddr}`;

    if (navigator.share) {
      // Use native sharing if available
      navigator
        .share({
          title: event.title,
          text: event.summary || event.content,
          url: shareUrl,
        })
        .catch(error => {
          this.logger.error('Error sharing event', error);
          this.copyEventUrl(shareUrl);
        });
    } else {
      // Fallback to copying URL to clipboard
      this.copyEventUrl(shareUrl);
    }
  }

  private copyEventUrl(url: string): void {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        // Could show a snackbar here indicating the URL was copied
        this.logger.info('Event URL copied to clipboard');
      })
      .catch(error => {
        this.logger.error('Failed to copy URL to clipboard', error);
      });
  }

  onEventClick(event: CalendarEvent, clickEvent: MouseEvent): void {
    clickEvent.stopPropagation();
    this.openEventDetails(event);
  }
}
