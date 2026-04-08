import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  TemplateRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { nip19, Event } from 'nostr-tools';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { ChroniaCalendarService } from '../../../services/chronia-calendar.service';
import { EthiopianCalendarService } from '../../../services/ethiopian-calendar.service';
import { AccountStateService } from '../../../services/account-state.service';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { UtilitiesService } from '../../../services/utilities.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { RightPanelHeaderService } from '../../../services/right-panel-header.service';
import { LeftPanelHeaderService } from '../../../services/left-panel-header.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { NostrService } from '../../../services/nostr.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../../components/share-article-dialog/share-article-dialog.component';

@Component({
  selector: 'app-calendar-event-detail',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
    MatMenuModule,
    MatDividerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
  ],
  templateUrl: './calendar-event-detail.component.html',
  styleUrl: './calendar-event-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarEventDetailComponent implements AfterViewInit, OnDestroy {
  @ViewChild('headerTemplate', { static: true }) headerTemplateRef!: TemplateRef<unknown>;

  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);
  private localSettings = inject(LocalSettingsService);
  private chroniaCalendar = inject(ChroniaCalendarService);
  private ethiopianCalendar = inject(EthiopianCalendarService);
  private accountState = inject(AccountStateService);
  private relayPool = inject(RelayPoolService);
  private utilities = inject(UtilitiesService);
  private logger = inject(LoggerService);
  private layout = inject(LayoutService);
  private panelNav = inject(PanelNavigationService);
  private rightPanelHeader = inject(RightPanelHeaderService);
  private leftPanelHeader = inject(LeftPanelHeaderService);
  private accountRelay = inject(AccountRelayService);
  private nostrService = inject(NostrService);
  private customDialog = inject(CustomDialogService);
  private userRelaysService = inject(UserRelaysService);

  event = signal<Event | null>(null);
  isLoading = signal(true);
  error = signal<string | null>(null);
  currentRsvpStatus = signal<'accepted' | 'declined' | 'tentative' | null>(null);

  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.getTagValue('title', ev.tags) || this.getTagValue('name', ev.tags) || 'Untitled Event';
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.getTagValue('summary', ev.tags) || '';
  });

  image = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.getTagValue('image', ev.tags) || '';
  });

  location = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.getTagValue('location', ev.tags) || '';
  });

  startDate = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const start = this.getTagValue('start', ev.tags);
    if (!start) return null;
    const timestamp = parseInt(start, 10);
    return new Date(timestamp * 1000);
  });

  endDate = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const end = this.getTagValue('end', ev.tags);
    if (!end) return null;
    const timestamp = parseInt(end, 10);
    return new Date(timestamp * 1000);
  });

  isAllDay = computed(() => {
    const ev = this.event();
    if (!ev) return false;
    return ev.kind === 31922;
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return ev.tags.filter(t => t[0] === 't').map(t => t[1]);
  });

  participants = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return ev.tags.filter(t => t[0] === 'p').map(t => t[1]);
  });

  geohash = computed(() => {
    const ev = this.event();
    if (!ev?.tags) return '';
    const tag = ev.tags.find(t => t[0] === 'g');
    return tag?.[1] || '';
  });

  geohashUrl = computed(() => {
    const hash = this.geohash();
    return hash ? `https://geohash.softeng.co/${hash}` : '';
  });

  authorPubkey = computed(() => this.event()?.pubkey || '');

  isOwnEvent = computed(() => {
    const pubkey = this.accountState.pubkey();
    return pubkey === this.authorPubkey();
  });

  description = computed(() => this.utilities.normalizeRenderedEventContent(this.event()?.content || ''));

  constructor() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        void this.loadEvent(id);
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.headerTemplateRef) {
      if (this.isInRightPanel()) {
        this.rightPanelHeader.setHeaderTemplate(this.headerTemplateRef);
      } else {
        this.leftPanelHeader.setHeaderTemplate(this.headerTemplateRef);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.isInRightPanel()) {
      this.rightPanelHeader.clear();
    } else {
      this.leftPanelHeader.clear();
    }
  }

  isInRightPanel(): boolean {
    return this.route.outlet === 'right';
  }

  goBack(): void {
    if (this.isInRightPanel()) {
      this.panelNav.goBackRight();
    } else {
      this.panelNav.goBackLeft();
    }
  }

  private async loadEvent(naddr: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    // Check if event data was passed via navigation state
    const stateEvent = history.state?.calendarEvent as Event | undefined;
    if (stateEvent) {
      this.event.set(stateEvent);
      this.isLoading.set(false);
      void this.loadMyRsvp(stateEvent);
      return;
    }

    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== 'naddr') {
        this.error.set('Invalid calendar event address');
        this.isLoading.set(false);
        return;
      }

      const { pubkey, identifier, kind, relays } = decoded.data;

      // Try relay hints first
      if (relays && relays.length > 0) {
        try {
          const relayEvent = await this.relayPool.get(
            relays,
            {
              authors: [pubkey],
              kinds: [kind],
              '#d': [identifier],
            },
            3000,
          );

          if (relayEvent) {
            this.event.set(relayEvent);
            this.isLoading.set(false);
            void this.loadMyRsvp(relayEvent);
            return;
          }
        } catch {
          // Continue with account relay fallback
        }
      }

      // Fallback to account relay
      this.accountRelay.subscribe(
        {
          kinds: [kind],
          authors: [pubkey],
          limit: 10,
        },
        (event: Event) => {
          const eventDTag = event.tags.find(t => t[0] === 'd')?.[1];
          if (eventDTag === identifier) {
            this.event.set(event);
            this.isLoading.set(false);
            void this.loadMyRsvp(event);
          }
        },
      );

      // Timeout fallback
      setTimeout(() => {
        if (this.isLoading()) {
          this.isLoading.set(false);
          if (!this.event()) {
            this.error.set('Could not load calendar event. It may have been deleted or the relay is unavailable.');
          }
        }
      }, 8000);
    } catch (err) {
      this.logger.error('Error loading calendar event', err);
      this.error.set('Failed to decode calendar event address');
      this.isLoading.set(false);
    }
  }

  private getTagValue(tagName: string, tags: string[][]): string {
    const tag = tags.find(t => t[0] === tagName);
    return tag ? tag[1] : '';
  }

  private async loadMyRsvp(calendarEvent: Event): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return;

    const dTag = this.getTagValue('d', calendarEvent.tags);
    const aCoord = `${calendarEvent.kind}:${calendarEvent.pubkey}:${dTag}`;

    this.accountRelay.subscribe(
      {
        kinds: [31925],
        authors: [myPubkey],
        limit: 20,
      },
      (rsvpEvent: Event) => {
        const aCoordTag = rsvpEvent.tags.find(t => t[0] === 'a')?.[1];
        if (!aCoordTag || aCoordTag !== aCoord) return;
        const status = rsvpEvent.tags.find(t => t[0] === 'status')?.[1] as
          | 'accepted'
          | 'declined'
          | 'tentative'
          | undefined;
        if (status) {
          this.currentRsvpStatus.set(status);
        }
      },
    );
  }

  isLocationUrl(location: string): boolean {
    try {
      const url = new URL(location);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  formatDate(date: Date): string {
    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      const chroniaDate = this.chroniaCalendar.fromDate(date);
      return this.chroniaCalendar.format(chroniaDate, 'full');
    }

    if (calendarType === 'ethiopian') {
      const ethiopianDate = this.ethiopianCalendar.fromDate(date);
      return this.ethiopianCalendar.format(ethiopianDate, 'full');
    }

    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  async respondToEvent(status: 'accepted' | 'declined' | 'tentative'): Promise<void> {
    const ev = this.event();
    if (!ev) return;

    try {
      const dTag = this.getTagValue('d', ev.tags);
      const tags: string[][] = [
        ['a', `${ev.kind}:${ev.pubkey}:${dTag}`],
        ['d', Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)],
        ['status', status],
        ['p', ev.pubkey],
      ];

      if (status !== 'declined') {
        tags.push(['fb', 'busy']);
      }

      const unsigned = this.nostrService.createEvent(31925, '', tags);
      const signed = await this.nostrService.signEvent(unsigned);
      await this.accountRelay.publish(signed);

      this.currentRsvpStatus.set(status);
      this.snackBar.open(`RSVP sent: ${status}`, 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('Error sending RSVP', error);
      this.snackBar.open('Failed to send RSVP', 'Close', { duration: 3000 });
    }
  }

  async shareEvent(): Promise<void> {
    const ev = this.event();
    if (!ev) return;

    const dTag = this.getTagValue('d', ev.tags);

    try {
      await this.userRelaysService.ensureRelaysForPubkey(ev.pubkey);
      const authorRelays = this.userRelaysService.getRelaysForPubkey(ev.pubkey);

      const naddr = nip19.naddrEncode({
        identifier: dTag,
        pubkey: ev.pubkey,
        kind: ev.kind,
        relays: authorRelays?.length ? authorRelays : undefined,
      });

      const shareUrl = `https://nostria.app/a/${naddr}`;

      const dialogData: ShareArticleDialogData = {
        title: this.title(),
        summary: this.summary() || this.description() || undefined,
        image: this.image() || undefined,
        url: shareUrl,
        eventId: ev.id,
        pubkey: ev.pubkey,
        identifier: dTag,
        kind: ev.kind,
        encodedId: naddr,
        naddr,
        event: ev,
      };

      this.customDialog.open(ShareArticleDialogComponent, {
        title: 'Share',
        showCloseButton: true,
        data: dialogData,
        width: '560px',
        maxWidth: 'min(560px, calc(100vw - 24px))',
      });
    } catch {
      this.snackBar.open('Failed to generate share link', 'Close', { duration: 3000 });
    }
  }

  copyEventData(): void {
    const ev = this.event();
    if (!ev) return;

    const eventData = {
      id: ev.id,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      kind: ev.kind,
      content: ev.content,
      tags: ev.tags,
    };

    navigator.clipboard.writeText(JSON.stringify(eventData, null, 2)).then(() => {
      this.snackBar.open('Event data copied to clipboard', 'Close', { duration: 3000 });
    }).catch(() => {
      this.snackBar.open('Failed to copy event data', 'Close', { duration: 3000 });
    });
  }

  openAuthorProfile(): void {
    const pubkey = this.authorPubkey();
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      this.layout.openProfile(npub);
    }
  }

  private copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      this.snackBar.open('Link copied to clipboard', 'Close', { duration: 3000 });
    }).catch(() => {
      this.snackBar.open('Failed to copy link', 'Close', { duration: 3000 });
    });
  }

  onImageError(event: globalThis.Event): void {
    const imgElement = event.target as HTMLImageElement;
    imgElement.style.display = 'none';
  }
}
