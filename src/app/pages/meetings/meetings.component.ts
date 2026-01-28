import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ProfileDisplayNameComponent } from '../../components/user-profile/display-name/profile-display-name.component';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { LayoutService } from '../../services/layout.service';

interface MeetingSpace {
  event: Event;
  meetings: Event[];
}

@Component({
  selector: 'app-meetings',
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTabsModule,
    MatCardModule,
    MatExpansionModule,
    MatTooltipModule,
    ProfileDisplayNameComponent,
    TimestampPipe,
  ],
  templateUrl: './meetings.component.html',
  styleUrl: './meetings.component.scss',
})
export class MeetingsComponent {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);

  meetingSpaces = signal<MeetingSpace[]>([]);
  loading = signal(true);
  selectedTabIndex = signal(0);

  // Computed signals for filtering by status
  openSpaces = computed(() => {
    return this.meetingSpaces().filter(space => {
      const statusTag = space.event.tags.find((tag: string[]) => tag[0] === 'status');
      return statusTag?.[1] === 'open';
    });
  });

  privateSpaces = computed(() => {
    return this.meetingSpaces().filter(space => {
      const statusTag = space.event.tags.find((tag: string[]) => tag[0] === 'status');
      return statusTag?.[1] === 'private';
    });
  });

  currentSpaces = computed(() => {
    const index = this.selectedTabIndex();
    if (index === 0) return this.openSpaces();
    return this.privateSpaces();
  });

  hasSpaces = computed(() => this.meetingSpaces().length > 0);

  constructor() {
    this.loadMeetings();

    // Refresh meetings every 30 seconds
    setInterval(() => {
      this.loadMeetings();
    }, 30000);
  }

  async loadMeetings(): Promise<void> {
    this.loading.set(true);

    try {
      // Get relay URLs
      const relayUrls = this.relaysService.getOptimalRelays(
        this.utilities.preferredRelays
      );

      if (relayUrls.length === 0) {
        console.warn('No relays available for loading meetings');
        this.loading.set(false);
        return;
      }

      // Query for kind:30312 (Meeting Spaces) and kind:30313 (Meeting Room Events)
      const spacesFilter: Filter = {
        kinds: [30312],
        limit: 50,
      };

      const meetingsFilter: Filter = {
        kinds: [30313],
        limit: 200,
      };

      const [spaces, meetings] = await Promise.all([
        this.pool.query(relayUrls, spacesFilter, 5000),
        this.pool.query(relayUrls, meetingsFilter, 5000),
      ]);

      // Group meetings by their parent space
      const spacesMap = new Map<string, MeetingSpace>();

      // Initialize spaces
      for (const space of spaces) {
        const dTag = space.tags.find((tag: string[]) => tag[0] === 'd')?.[1];
        if (dTag) {
          const key = `${space.pubkey}:${dTag}`;
          spacesMap.set(key, {
            event: space,
            meetings: [],
          });
        }
      }

      // Associate meetings with their spaces
      for (const meeting of meetings) {
        // Find the 'a' tag that references the parent space
        const aTag = meeting.tags.find((tag: string[]) => tag[0] === 'a');
        if (aTag?.[1]) {
          // a tag format: "30312:<pubkey>:<d-identifier>"
          const parts = aTag[1].split(':');
          if (parts.length === 3 && parts[0] === '30312') {
            const key = `${parts[1]}:${parts[2]}`;
            const space = spacesMap.get(key);
            if (space) {
              space.meetings.push(meeting);
            }
          }
        }
      }

      // Convert map to array and sort by most recent
      const spacesArray = Array.from(spacesMap.values()).sort((a, b) => {
        return b.event.created_at - a.event.created_at;
      });

      this.meetingSpaces.set(spacesArray);
    } catch (error) {
      console.error('Failed to load meetings:', error);
    } finally {
      this.loading.set(false);
    }
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  refresh(): void {
    this.loadMeetings();
  }

  getSpaceName(space: Event): string {
    const roomTag = space.tags.find((tag: string[]) => tag[0] === 'room');
    return roomTag?.[1] || 'Unnamed Room';
  }

  getSpaceSummary(space: Event): string | null {
    const summaryTag = space.tags.find((tag: string[]) => tag[0] === 'summary');
    return summaryTag?.[1] || null;
  }

  getSpaceImage(space: Event): string | null {
    const imageTag = space.tags.find((tag: string[]) => tag[0] === 'image');
    return imageTag?.[1] || null;
  }

  getSpaceStatus(space: Event): string {
    const statusTag = space.tags.find((tag: string[]) => tag[0] === 'status');
    return statusTag?.[1] || 'closed';
  }

  getSpaceServiceUrl(space: Event): string | null {
    const serviceTag = space.tags.find((tag: string[]) => tag[0] === 'service');
    return serviceTag?.[1] || null;
  }

  getSpaceHashtags(space: Event): string[] {
    return space.tags
      .filter((tag: string[]) => tag[0] === 't')
      .map((tag: string[]) => tag[1]);
  }

  getSpaceHosts(space: Event): { pubkey: string; role: string }[] {
    return space.tags
      .filter((tag: string[]) => tag[0] === 'p')
      .map((tag: string[]) => ({
        pubkey: tag[1],
        role: tag[3] || 'Participant',
      }));
  }

  getMeetingTitle(meeting: Event): string {
    const titleTag = meeting.tags.find((tag: string[]) => tag[0] === 'title');
    return titleTag?.[1] || 'Untitled Meeting';
  }

  getMeetingSummary(meeting: Event): string | null {
    const summaryTag = meeting.tags.find((tag: string[]) => tag[0] === 'summary');
    return summaryTag?.[1] || null;
  }

  getMeetingStatus(meeting: Event): string {
    const statusTag = meeting.tags.find((tag: string[]) => tag[0] === 'status');
    return statusTag?.[1] || 'planned';
  }

  getMeetingStarts(meeting: Event): number | null {
    const startsTag = meeting.tags.find((tag: string[]) => tag[0] === 'starts');
    return startsTag?.[1] ? parseInt(startsTag[1], 10) : null;
  }

  getMeetingEnds(meeting: Event): number | null {
    const endsTag = meeting.tags.find((tag: string[]) => tag[0] === 'ends');
    return endsTag?.[1] ? parseInt(endsTag[1], 10) : null;
  }

  getMeetingCurrentParticipants(meeting: Event): number | null {
    const tag = meeting.tags.find((tag: string[]) => tag[0] === 'current_participants');
    return tag?.[1] ? parseInt(tag[1], 10) : null;
  }

  getMeetingTotalParticipants(meeting: Event): number | null {
    const tag = meeting.tags.find((tag: string[]) => tag[0] === 'total_participants');
    return tag?.[1] ? parseInt(tag[1], 10) : null;
  }

  joinSpace(space: Event): void {
    const serviceUrl = this.getSpaceServiceUrl(space);
    if (serviceUrl) {
      window.open(serviceUrl, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback to event page
      this.layout.openGenericEvent(space.id);
    }
  }

  viewMeeting(meeting: Event): void {
    this.layout.openGenericEvent(meeting.id);
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'live':
        return 'radio_button_checked';
      case 'planned':
        return 'schedule';
      case 'ended':
        return 'stop_circle';
      default:
        return 'help_outline';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'live':
        return 'live';
      case 'planned':
        return 'planned';
      case 'ended':
        return 'ended';
      default:
        return '';
    }
  }
}
