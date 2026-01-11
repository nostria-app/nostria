import { Component, inject, signal, computed, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { ReportingService } from '../../../services/reporting.service';
import { DatabaseService } from '../../../services/database.service';
import { DataService } from '../../../services/data.service';
import { ZapDialogComponent, ZapDialogData } from '../../../components/zap-dialog/zap-dialog.component';

const MUSIC_KIND = 36787;

type SortOption = 'name-asc' | 'name-desc' | 'tracks-asc' | 'tracks-desc';

interface ArtistData {
  name: string;
  pubkey: string;
  trackCount: number;
}

@Component({
  selector: 'app-music-artists',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatMenuModule,
    FormsModule,
  ],
  templateUrl: './artists.component.html',
  styleUrls: ['./artists.component.scss'],
})
export class ArtistsComponent implements OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountRelay = inject(AccountRelayService);
  private reporting = inject(ReportingService);
  private database = inject(DatabaseService);
  private dataService = inject(DataService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  allTracks = signal<Event[]>([]);
  loading = signal(true);
  sortBy = signal<SortOption>('name-asc');

  private trackSubscription: { close: () => void } | null = null;
  private trackMap = new Map<string, Event>();

  /**
   * Extract all unique artists from tracks with track counts
   */
  private allArtistsData = computed(() => {
    const artistMap = new Map<string, ArtistData>();

    this.allTracks().forEach(track => {
      const artistTag = track.tags.find(t => t[0] === 'artist');
      if (artistTag?.[1]) {
        const artistName = artistTag[1].trim();
        if (artistName) {
          const existing = artistMap.get(artistName);
          if (existing) {
            existing.trackCount++;
          } else {
            artistMap.set(artistName, {
              name: artistName,
              pubkey: track.pubkey,
              trackCount: 1,
            });
          }
        }
      }
    });

    return Array.from(artistMap.values());
  });

  /**
   * Sorted artists based on current sort option
   */
  artists = computed(() => {
    const artists = [...this.allArtistsData()];
    const sort = this.sortBy();

    switch (sort) {
      case 'name-asc':
        return artists.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return artists.sort((a, b) => b.name.localeCompare(a.name));
      case 'tracks-asc':
        return artists.sort((a, b) => a.trackCount - b.trackCount);
      case 'tracks-desc':
        return artists.sort((a, b) => b.trackCount - a.trackCount);
      default:
        return artists;
    }
  });

  constructor() {
    this.initializeArtists();
  }

  ngOnDestroy(): void {
    this.trackSubscription?.close();
  }

  private async initializeArtists(): Promise<void> {
    await this.loadFromDatabase();
    this.startSubscription();
  }

  private async loadFromDatabase(): Promise<void> {
    try {
      const cachedTracks = await this.database.getEventsByKind(MUSIC_KIND);
      for (const track of cachedTracks) {
        if (this.reporting.isUserBlocked(track.pubkey)) continue;
        if (this.reporting.isContentBlocked(track)) continue;

        const dTag = track.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${track.pubkey}:${dTag}`;

        const existing = this.trackMap.get(uniqueId);
        if (!existing || track.created_at > existing.created_at) {
          this.trackMap.set(uniqueId, track);
        }
      }

      if (this.trackMap.size > 0) {
        this.allTracks.set(Array.from(this.trackMap.values()));
      }
    } catch (error) {
      console.error('[Artists] Failed to load from database:', error);
    }
  }

  private startSubscription(): void {
    const accountRelays = this.accountRelay.getRelayUrls();

    if (accountRelays.length === 0) {
      console.warn('[Artists] No account relays available');
      this.loading.set(false);
      return;
    }

    const filters = { kinds: [MUSIC_KIND], limit: 500 };

    this.trackSubscription = this.pool.subscribe(accountRelays, filters, (event: Event) => {
      if (this.reporting.isUserBlocked(event.pubkey)) return;
      if (this.reporting.isContentBlocked(event)) return;

      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      const uniqueId = `${event.pubkey}:${dTag}`;

      const existing = this.trackMap.get(uniqueId);
      if (!existing || event.created_at > existing.created_at) {
        this.trackMap.set(uniqueId, event);
        this.allTracks.set(Array.from(this.trackMap.values()));

        this.database.saveEvent({ ...event, dTag }).catch((err: Error) =>
          console.warn('[Artists] Failed to save track to database:', err)
        );
      }
    });

    // Set loading to false after initial load timeout
    setTimeout(() => {
      this.loading.set(false);
    }, 5000);
  }

  goToArtist(pubkey: string): void {
    const npub = nip19.npubEncode(pubkey);
    this.router.navigate(['/music/artist', npub]);
  }

  goBack(): void {
    this.router.navigate(['/music']);
  }

  getArtistPicture(pubkey: string): string | null {
    const profile = this.dataService.getCachedProfile(pubkey);
    return profile?.data?.picture || null;
  }

  zapArtist(event: MouseEvent, artistData: ArtistData): void {
    event.stopPropagation();
    
    const profile = this.dataService.getCachedProfile(artistData.pubkey);

    const data: ZapDialogData = {
      recipientPubkey: artistData.pubkey,
      recipientName: artistData.name,
      recipientMetadata: profile?.data,
    };

    this.dialog.open(ZapDialogComponent, {
      data,
      width: '400px',
      maxWidth: '95vw',
    });
  }
}
