import { Component, inject, signal, computed, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormBuilder, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Event } from 'nostr-tools';
import { MediaService } from '../../../services/media.service';
import { formatDuration } from '../../../utils/format-duration';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { RelaysService } from '../../../services/relays/relays';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { LoggerService } from '../../../services/logger.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';

const MUSIC_KIND = 36787;

interface RssFeedItem {
  title: string;
  artist: string;
  album: string;
  audioUrl: string;
  imageUrl: string;
  duration: string;
  releaseDate: string;
  description: string;
  trackNumber: number;
  genres: string[];
  aiGenerated: boolean;
  // Used for UI state
  expanded: boolean;
  selected: boolean;
}

interface AlbumInfo {
  title: string;
  artist: string;
  imageUrl: string;
  releaseDate: string;
  enabled: boolean;
}

@Component({
  selector: 'app-import-rss-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatExpansionModule,
    MatSnackBarModule,
    ReactiveFormsModule,
    FormsModule,
  ],
  templateUrl: './import-rss-dialog.component.html',
  styleUrl: './import-rss-dialog.component.scss',
})
export class ImportRssDialogComponent {
  closed = output<{ published: boolean; events?: Event[] } | null>();

  private fb = inject(FormBuilder);
  private mediaService = inject(MediaService);
  private accountState = inject(AccountStateService);
  private nostrService = inject(NostrService);
  private relaysService = inject(RelaysService);
  private pool = inject(RelayPoolService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private readonly logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);

  // Form state
  rssUrl = signal('');
  isFetching = signal(false);
  isPublishing = signal(false);
  hasFetched = signal(false);

  // Album information
  albumInfo = signal<AlbumInfo>({
    title: '',
    artist: '',
    imageUrl: '',
    releaseDate: '',
    enabled: true,
  });

  // Tracks from RSS feed
  tracks = signal<RssFeedItem[]>([]);

  // Random gradients for default cover
  private gradients = [
    '#e040fb, #7c4dff',
    '#ff6b6b, #feca57',
    '#00d2d3, #54a0ff',
    '#5f27cd, #00d2d3',
    '#ff9ff3, #feca57',
    '#1dd1a1, #00d2d3',
    '#ff6b6b, #ee5a24',
    '#c8d6e5, #576574',
  ];

  currentGradient = signal(this.getRandomGradient());

  // Available genres for music
  availableGenres = [
    'Electronic', 'Rock', 'Pop', 'Hip Hop', 'R&B', 'Jazz', 'Classical',
    'Country', 'Folk', 'Metal', 'Punk', 'Alternative', 'Indie',
    'Dance', 'House', 'Techno', 'Ambient', 'Experimental', 'Soul',
    'Reggae', 'Blues', 'Latin', 'World', 'Soundtrack', 'Lo-Fi',
    'Trap', 'Dubstep', 'Drum & Bass', 'Synthwave', 'Podcast', 'Other'
  ];

  // Computed
  trackCount = computed(() => this.tracks().length);
  selectedCount = computed(() => this.tracks().filter(t => t.selected).length);

  private getRandomGradient(): string {
    return this.gradients[Math.floor(Math.random() * this.gradients.length)];
  }

  randomizeGradient(): void {
    this.currentGradient.set(this.getRandomGradient());
    this.albumInfo.update(info => ({ ...info, imageUrl: '' }));
  }

  async fetchRss(): Promise<void> {
    const url = this.rssUrl().trim();
    if (!url) {
      this.snackBar.open('Please enter an RSS feed URL', 'Close', { duration: 3000 });
      return;
    }

    this.isFetching.set(true);

    try {
      // Fetch the RSS feed
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch RSS: ${response.statusText}`);
      }

      const text = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'application/xml');

      // Check for parse errors
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        throw new Error('Invalid RSS feed format');
      }

      // Parse channel info for album
      const channel = doc.querySelector('channel');
      if (!channel) {
        throw new Error('No channel found in RSS feed');
      }

      const channelTitle = channel.querySelector('title')?.textContent || '';
      const channelAuthor = channel.querySelector('author')?.textContent ||
        this.getItunesText(channel, 'author') || '';
      const channelImage = channel.querySelector('image > url')?.textContent ||
        this.getItunesImageHref(channel) || '';

      this.albumInfo.set({
        title: channelTitle,
        artist: channelAuthor,
        imageUrl: channelImage,
        releaseDate: this.formatDate(new Date()),
        enabled: true,
      });

      // Parse items
      const items = doc.querySelectorAll('item');
      const parsedTracks: RssFeedItem[] = [];

      items.forEach((item, index) => {
        const title = item.querySelector('title')?.textContent || `Track ${index + 1}`;
        const author = item.querySelector('author')?.textContent ||
          this.getItunesText(item, 'author') ||
          channelAuthor;
        const enclosure = item.querySelector('enclosure');
        const audioUrl = enclosure?.getAttribute('url') || '';
        const itemImage = this.getItunesImageHref(item) || '';
        const duration = this.getItunesText(item, 'duration') || '';
        const pubDate = item.querySelector('pubDate')?.textContent || '';
        const description = item.querySelector('description')?.textContent ||
          this.getItunesText(item, 'summary') || '';

        // Only include items with audio URLs
        if (audioUrl) {
          parsedTracks.push({
            title,
            artist: author,
            album: channelTitle,
            audioUrl,
            imageUrl: itemImage,
            duration: this.formatRssDuration(duration),
            releaseDate: this.formatDate(pubDate ? new Date(pubDate) : new Date()),
            description: this.stripHtml(description),
            trackNumber: index + 1,
            genres: [],
            aiGenerated: false,
            expanded: false,
            selected: true,
          });
        }
      });

      if (parsedTracks.length === 0) {
        this.snackBar.open('No audio tracks found in the RSS feed', 'Close', { duration: 3000 });
        return;
      }

      this.tracks.set(parsedTracks);
      this.hasFetched.set(true);
      this.snackBar.open(`Found ${parsedTracks.length} tracks`, 'Close', { duration: 2000 });
    } catch (error) {
      this.logger.error('Error fetching RSS:', error);
      this.snackBar.open(`Error: ${error instanceof Error ? error.message : 'Failed to fetch RSS'}`, 'Close', { duration: 3000 });
    } finally {
      this.isFetching.set(false);
    }
  }

  /**
   * Gets the href attribute from an itunes:image element.
   * Handles XML namespace parsing across different browsers.
   */
  private getItunesImageHref(parent: Element): string {
    // Try multiple methods to find the itunes:image element
    const ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';

    // Method 1: getElementsByTagNameNS (most reliable for namespaced elements)
    const nsElements = parent.getElementsByTagNameNS(ITUNES_NS, 'image');
    if (nsElements.length > 0) {
      return nsElements[0].getAttribute('href') || '';
    }

    // Method 2: Look for elements with itunes:image local name
    for (const child of Array.from(parent.children)) {
      const localName = child.localName || child.nodeName;
      if (localName === 'image' && (child.namespaceURI === ITUNES_NS || child.nodeName.includes('itunes'))) {
        return child.getAttribute('href') || '';
      }
      if (child.nodeName === 'itunes:image') {
        return child.getAttribute('href') || '';
      }
    }

    return '';
  }

  /**
   * Gets text content from an iTunes namespace element.
   */
  private getItunesText(parent: Element, tagName: string): string {
    const ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';

    // Method 1: getElementsByTagNameNS
    const nsElements = parent.getElementsByTagNameNS(ITUNES_NS, tagName);
    if (nsElements.length > 0) {
      return nsElements[0].textContent || '';
    }

    // Method 2: Look for elements with itunes: prefix
    for (const child of Array.from(parent.children)) {
      if (child.nodeName === `itunes:${tagName}`) {
        return child.textContent || '';
      }
    }

    return '';
  }

  private stripHtml(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  private formatRssDuration(duration: string): string {
    if (!duration) return '';

    // If it's already in HH:MM:SS or MM:SS format
    if (duration.includes(':')) {
      return duration;
    }

    // If it's in seconds
    const seconds = parseInt(duration, 10);
    if (isNaN(seconds)) return duration;

    return formatDuration(seconds);
  }

  private formatDate(date: Date): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return '';
    }
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }

  toggleTrackExpanded(index: number): void {
    this.tracks.update(tracks => {
      const updated = [...tracks];
      updated[index] = { ...updated[index], expanded: !updated[index].expanded };
      return updated;
    });
  }

  expandAll(): void {
    this.tracks.update(tracks => tracks.map(t => ({ ...t, expanded: true })));
  }

  collapseAll(): void {
    this.tracks.update(tracks => tracks.map(t => ({ ...t, expanded: false })));
  }

  updateTrack(index: number, updates: Partial<RssFeedItem>): void {
    this.tracks.update(tracks => {
      const updated = [...tracks];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }

  updateAlbumInfo(updates: Partial<AlbumInfo>): void {
    this.albumInfo.update(info => ({ ...info, ...updates }));
  }

  goBack(): void {
    this.hasFetched.set(false);
    this.tracks.set([]);
  }

  async publishTracks(): Promise<void> {
    const selectedTracks = this.tracks().filter(t => t.selected);
    if (selectedTracks.length === 0) {
      this.snackBar.open('No tracks selected', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);
    const publishedEvents: Event[] = [];

    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.snackBar.open('Not authenticated', 'Close', { duration: 3000 });
        return;
      }

      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      if (relayUrls.length === 0) {
        this.snackBar.open('No relays available', 'Close', { duration: 3000 });
        return;
      }

      const album = this.albumInfo();

      for (const track of selectedTracks) {
        // Generate unique identifier
        const dTag = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        // Build tags
        const tags: string[][] = [
          ['d', dTag],
          ['title', track.title],
          ['url', track.audioUrl],
          ['client', 'nostria'],
        ];

        // Add image
        if (track.imageUrl) {
          tags.push(['image', track.imageUrl]);
        } else if (album.enabled && album.imageUrl) {
          tags.push(['image', album.imageUrl]);
        } else {
          tags.push(['gradient', 'colors', this.currentGradient()]);
        }

        // Add artist
        if (track.artist) {
          tags.push(['artist', track.artist]);
        }

        // Add album info if enabled
        if (album.enabled && album.title) {
          tags.push(['album', album.title]);
        }

        // Add track number
        if (track.trackNumber) {
          tags.push(['track_number', String(track.trackNumber)]);
        }

        // Add duration
        if (track.duration) {
          tags.push(['duration', track.duration]);
        }

        // Add release date
        if (track.releaseDate) {
          tags.push(['released', track.releaseDate]);
        }

        // Add genres
        for (const genre of track.genres) {
          tags.push(['t', genre.toLowerCase()]);
        }

        // Add AI generated flag
        if (track.aiGenerated) {
          tags.push(['ai_generated', 'true']);
        }

        // Add alt tag for accessibility
        tags.push(['alt', `Music track: ${track.title} by ${track.artist || 'Unknown Artist'}`]);

        // Build content from description
        const content = track.description || '';

        // Create and sign the event
        const eventTemplate = {
          kind: MUSIC_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content,
        };

        const signedEvent = await this.nostrService.signEvent(eventTemplate);
        if (!signedEvent) {
          this.logger.warn('Failed to sign event for track:', track.title);
          continue;
        }

        // Publish to relays
        try {
          await this.pool.publish(relayUrls, signedEvent);
          publishedEvents.push(signedEvent);
        } catch (error) {
          this.logger.warn('Failed to publish track:', track.title, error);
        }

        // Small delay between publishes
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (publishedEvents.length > 0) {
        this.snackBar.open(`Published ${publishedEvents.length} tracks successfully!`, 'Close', { duration: 3000 });
        this.closed.emit({ published: true, events: publishedEvents });
      } else {
        this.snackBar.open('Failed to publish any tracks', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error publishing tracks:', error);
      this.snackBar.open('Error publishing tracks', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }

  cancel(): void {
    this.closed.emit(null);
  }
}
