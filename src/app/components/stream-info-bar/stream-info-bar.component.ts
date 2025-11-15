import { Component, computed, input, inject, signal, effect } from '@angular/core';
import { Event } from 'nostr-tools';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { RouterModule } from '@angular/router';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-stream-info-bar',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatChipsModule,
    MatBadgeModule,
    RouterModule,
    UserProfileComponent,
  ],
  template: `
    <div class="stream-info-bar">
      <div class="stream-header">
        <div class="stream-title-section">
          <h2 class="stream-title">{{ title() }}</h2>
          <div class="stream-meta">
            <app-user-profile [pubkey]="streamerPubkey()" />
            <span class="separator">•</span>
            <div class="live-indicator">
              <span class="live-dot"></span>
              <span class="live-text">LIVE</span>
            </div>
            @if (viewerCount() > 0) {
            <span class="separator">•</span>
            <span class="viewer-count">
              <mat-icon>visibility</mat-icon>
              {{ viewerCount() }} {{ viewerCount() === 1 ? 'viewer' : 'viewers' }}
            </span>
            }
          </div>
        </div>
        
        <div class="stream-actions">
          <button 
            mat-flat-button 
            class="zap-button"
            (click)="openZapDialog()"
            matTooltip="Send zap to streamer">
            <mat-icon>bolt</mat-icon>
            Zap
          </button>
        </div>
      </div>
      
      @if (description()) {
      <div class="stream-description">
        {{ description() }}
      </div>
      }
      
      @if (tags().length > 0) {
      <div class="stream-tags">
        <mat-chip-set>
          @for (tag of tags(); track tag) {
          <mat-chip>{{ tag }}</mat-chip>
          }
        </mat-chip-set>
      </div>
      }
    </div>
  `,
  styles: [`
    .stream-info-bar {
      background: var(--mat-sys-surface-container);
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .stream-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }

    .stream-title-section {
      flex: 1;
      min-width: 0;
    }

    .stream-title {
      margin: 0 0 8px 0;
      font-size: 1.5rem;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stream-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .separator {
      opacity: 0.5;
    }

    .live-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-error);
      font-weight: 600;
    }

    .live-dot {
      width: 8px;
      height: 8px;
      background: var(--mat-sys-error);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .live-text {
      font-size: 0.75rem;
      letter-spacing: 0.5px;
    }

    .viewer-count {
      display: flex;
      align-items: center;
      gap: 4px;
      
      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .stream-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .zap-button {
      background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);
      color: #000;
      font-weight: 600;
      
      mat-icon {
        margin-right: 4px;
      }

      &:hover {
        background: linear-gradient(135deg, #ffed4e 0%, #ffd700 100%);
      }
    }

    .stream-description {
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--mat-sys-on-surface);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .stream-tags {
      mat-chip-set {
        --mdc-chip-container-height: 28px;
      }
      
      mat-chip {
        font-size: 0.75rem;
      }
    }

    @media (max-width: 768px) {
      .stream-info-bar {
        padding: 12px 16px;
      }

      .stream-title {
        font-size: 1.25rem;
      }

      .stream-header {
        flex-direction: column;
        align-items: stretch;
      }

      .stream-actions {
        justify-content: stretch;
        
        .zap-button {
          flex: 1;
        }
      }
    }
  `]
})
export class StreamInfoBarComponent {
  liveEvent = input.required<Event>();

  private zapService = inject(ZapService);
  private dataService = inject(DataService);
  private relayPool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);

  // Viewer count (tracked via status events)
  viewerCount = signal(0);

  // Stream title
  title = computed(() => {
    const event = this.liveEvent();
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'Live Stream';
  });

  // Stream description
  description = computed(() => {
    const event = this.liveEvent();
    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    return summaryTag?.[1] || null;
  });

  // Streamer pubkey
  streamerPubkey = computed(() => {
    return this.liveEvent().pubkey;
  });

  // Streamer npub
  streamerNpub = computed(() => {
    return this.utilities.getNpubFromPubkey(this.streamerPubkey());
  });

  // Tags
  tags = computed(() => {
    const event = this.liveEvent();
    return event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1])
      .slice(0, 5); // Limit to 5 tags
  });

  // Event address for tracking viewers
  eventAddress = computed(() => {
    const event = this.liveEvent();
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) return null;
    return `${event.kind}:${event.pubkey}:${dTag}`;
  });

  constructor() {
    // Subscribe to viewer count updates
    effect(() => {
      const address = this.eventAddress();
      if (address) {
        this.subscribeToViewerUpdates(address);
      }
    });
  }

  private async subscribeToViewerUpdates(eventAddress: string): Promise<void> {
    // Query for kind 1312 status events to track viewers
    const relayUrls = this.relaysService.getOptimalRelays(
      this.utilities.preferredRelays
    );

    if (relayUrls.length === 0) {
      console.warn('No relays available for viewer tracking');
      return;
    }

    // Get recent status events (viewers are those who sent status in last 60 seconds)
    const sixtySecondsAgo = Math.floor(Date.now() / 1000) - 60;

    const filter = {
      kinds: [1312],
      '#a': [eventAddress],
      since: sixtySecondsAgo,
    };

    try {
      const events = await this.relayPool.query(relayUrls, filter, 5000);

      // Count unique viewers (unique pubkeys)
      const uniqueViewers = new Set(events.map(e => e.pubkey));
      this.viewerCount.set(uniqueViewers.size);

      // Poll for updates every 30 seconds
      setInterval(async () => {
        const now = Math.floor(Date.now() / 1000);
        const recentFilter = {
          kinds: [1312],
          '#a': [eventAddress],
          since: now - 60,
        };

        try {
          const recentEvents = await this.relayPool.query(relayUrls, recentFilter, 5000);
          const currentViewers = new Set(recentEvents.map(e => e.pubkey));
          this.viewerCount.set(currentViewers.size);
        } catch (error) {
          console.error('Error updating viewer count:', error);
        }
      }, 30000);
    } catch (error) {
      console.error('Error subscribing to viewer updates:', error);
    }
  }

  async openZapDialog(): Promise<void> {
    const event = this.liveEvent();
    const recipientPubkey = event.pubkey;

    // Get recipient metadata
    const metadata = await this.dataService.getProfile(recipientPubkey);

    if (!metadata) {
      this.snackBar.open('Unable to load streamer profile', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    // TODO: Open zap dialog with event context
    // For now, just call zap service with default amount
    const defaultAmount = 1000; // 1000 sats
    const message = `Zap for live stream: ${this.title()}`;

    try {
      // Parse metadata content (it's a JSON string)
      const parsedMetadata = typeof metadata.event.content === 'string'
        ? JSON.parse(metadata.event.content)
        : metadata.event.content;

      await this.zapService.sendZap(
        recipientPubkey,
        defaultAmount,
        message,
        event.id, // Reference the stream event
        parsedMetadata as Record<string, unknown>
      );

      this.snackBar.open('Zap sent successfully!', 'Dismiss', {
        duration: 3000,
      });
    } catch (error) {
      console.error('Error sending zap:', error);
      this.snackBar.open('Failed to send zap', 'Dismiss', {
        duration: 3000,
      });
    }
  }
}
