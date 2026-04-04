import { Component, inject, signal, computed, output, ChangeDetectionStrategy } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormBuilder, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
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
import { MentionAutocompleteComponent, MentionAutocompleteConfig, MentionSelection } from '../../../components/mention-autocomplete/mention-autocomplete.component';
import { MentionInputService } from '../../../services/mention-input.service';
import { CorsProxyService } from '../../../services/cors-proxy.service';

const MUSIC_KIND = 36787;

interface RssFeedItem {
  guid: string;
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
  license: string;
  splits: TrackSplit[];
  // Used for UI state
  expanded: boolean;
  selected: boolean;
}

interface AlbumInfo {
  guid: string;
  title: string;
  artist: string;
  imageUrl: string;
  releaseDate: string;
  enabled: boolean;
}

interface TrackSplit {
  address: string;
  percentage: number;
}

interface ValueRecipient {
  name: string;
  address: string;
  type: string;
  // UI state for profile resolution
  resolvedPubkey: string;
  resolvedName: string;
  resolvedAvatar: string | null;
  isEditing: boolean;
  searchInput: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    MatChipsModule,
    MatAutocompleteModule,
    MatExpansionModule,
    MatSnackBarModule,
    ReactiveFormsModule,
    FormsModule,
    MentionAutocompleteComponent,
    JsonPipe,
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
  private mentionInputService = inject(MentionInputService);
  private corsProxy = inject(CorsProxyService);

  // Form state
  rssUrl = signal('');
  isFetching = signal(false);
  isPublishing = signal(false);
  hasFetched = signal(false);
  showPreview = signal(false);
  previewEvents = signal<{ kind: number; created_at: number; tags: string[][]; content: string }[]>([]);

  // Album information
  albumInfo = signal<AlbumInfo>({
    guid: '',
    title: '',
    artist: '',
    imageUrl: '',
    releaseDate: '',
    enabled: true,
  });

  // Tracks from RSS feed
  tracks = signal<RssFeedItem[]>([]);

  // Value recipients from RSS feed
  valueRecipients = signal<ValueRecipient[]>([]);
  activeRecipientIndex = signal<number>(-1);

  // Mention autocomplete
  mentionConfig = signal<MentionAutocompleteConfig | null>(null);
  mentionPosition = signal({ top: 0, left: 0 });

  // Whether all RSS recipients have been resolved
  allRecipientsResolved = computed(() => {
    const recipients = this.valueRecipients();
    if (recipients.length === 0) return true;
    return recipients.every(r => !!r.resolvedPubkey);
  });

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

  // Available license options (same as music-track-dialog)
  licenseOptions = [
    { value: '', label: 'None', url: '' },
    { value: 'All Rights Reserved', label: 'All Rights Reserved', url: '' },
    { value: 'CC0 1.0', label: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    { value: 'CC-BY 4.0', label: 'CC-BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    { value: 'CC BY-SA 4.0', label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    { value: 'CC BY-ND 4.0', label: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
    { value: 'CC BY-NC 4.0', label: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    { value: 'CC BY-NC-SA 4.0', label: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
    { value: 'CC BY-NC-ND 4.0', label: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
  ];

  readonly suggestedGenres = [
    'Electronic', 'Rock', 'Pop', 'Hip Hop', 'R&B', 'Jazz', 'Classical',
    'Country', 'Folk', 'Metal', 'Punk', 'Alternative', 'Indie',
    'Dance', 'House', 'Techno', 'Ambient', 'Experimental', 'Soul',
    'Reggae', 'Blues', 'Latin', 'World', 'Soundtrack', 'Lo-Fi',
    'Trap', 'Dubstep', 'Drum & Bass', 'Synthwave',
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
      // Use shared CORS-aware fetch (direct first, then proxy fallback).
      const text = await this.corsProxy.fetchText(url);

      // The proxy can return JSON errors; surface those instead of generic XML parse failures.
      const trimmedText = text.trim();
      if (trimmedText.startsWith('{')) {
        try {
          const jsonResponse = JSON.parse(trimmedText) as { error?: string; timeout?: number };
          if (jsonResponse.error) {
            throw new Error(
              `Failed to fetch RSS feed: ${jsonResponse.error}${jsonResponse.timeout ? ` (timeout: ${jsonResponse.timeout}ms)` : ''}`
            );
          }
        } catch (err) {
          if (!(err instanceof SyntaxError)) {
            throw err;
          }
        }
      }

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
      const channelGuid = this.getPodcastText(channel, 'guid');

      this.albumInfo.set({
        guid: channelGuid,
        title: channelTitle,
        artist: channelAuthor,
        imageUrl: channelImage,
        releaseDate: this.formatDate(new Date()),
        enabled: true,
      });

      // Parse channel-level podcast:value recipients
      const channelRawRecipients = this.parseRawValueRecipients(channel);
      const allUniqueAddresses = new Map<string, { name: string; address: string; type: string }>();
      for (const r of channelRawRecipients) {
        allUniqueAddresses.set(r.address, { name: r.name, address: r.address, type: r.type });
      }

      // Parse channel-level podcast:license
      const channelLicense = this.matchRssLicense(this.getPodcastText(channel, 'license'));

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
        const itemGuid = item.querySelector('guid')?.textContent || '';

        // Parse item-level podcast:license (overrides channel-level)
        const itemLicense = this.matchRssLicense(this.getPodcastText(item, 'license'));

        // Parse item-level value recipients (overrides channel-level if present)
        const itemRawRecipients = this.parseRawValueRecipients(item);
        const trackRecipients = itemRawRecipients.length > 0 ? itemRawRecipients : channelRawRecipients;

        // Parse genres from itunes:keywords (item-level, fallback to channel-level)
        const itemKeywords = this.getItunesText(item, 'keywords');
        const channelKeywords = this.getItunesText(channel, 'keywords');
        const keywordsText = itemKeywords || channelKeywords;
        const genres = keywordsText
          ? keywordsText.split(',').map(k => k.trim()).filter(k => k.length > 0)
          : [];

        // Collect unique addresses for profile assignment
        for (const r of trackRecipients) {
          if (!allUniqueAddresses.has(r.address)) {
            allUniqueAddresses.set(r.address, { name: r.name, address: r.address, type: r.type });
          }
        }

        // Only include items with audio URLs
        if (audioUrl) {
          parsedTracks.push({
            guid: itemGuid,
            title,
            artist: author,
            album: channelTitle,
            audioUrl,
            imageUrl: itemImage,
            duration: this.formatRssDuration(duration),
            releaseDate: this.formatDate(pubDate ? new Date(pubDate) : new Date()),
            description: this.stripHtml(description),
            trackNumber: index + 1,
            genres,
            aiGenerated: false,
            license: itemLicense || channelLicense,
            splits: trackRecipients.map(r => ({ address: r.address, percentage: r.split })),
            expanded: false,
            selected: true,
          });
        }
      });

      // Set unique value recipients for profile assignment UI
      this.valueRecipients.set(Array.from(allUniqueAddresses.values()).map(r => ({
        name: r.name,
        address: r.address,
        type: r.type,
        resolvedPubkey: '',
        resolvedName: '',
        resolvedAvatar: null,
        isEditing: false,
        searchInput: '',
      })));

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

  private parseDurationToSeconds(duration: string): number | null {
    const value = duration.trim();
    if (!value) return null;

    if (value.includes(':')) {
      const parts = value.split(':').map(part => parseInt(part, 10));
      if (parts.some(part => Number.isNaN(part))) return null;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return null;
    }

    const seconds = parseInt(value, 10);
    return Number.isNaN(seconds) ? null : seconds;
  }

  private formatDate(date: Date): string {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return '';
    }
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  }

  private getPodcastText(parent: Element, tagName: string): string {
    const PODCAST_NS = 'https://podcastindex.org/namespace/1.0';
    const nsElements = parent.getElementsByTagNameNS(PODCAST_NS, tagName);
    if (nsElements.length > 0) {
      return nsElements[0].textContent || '';
    }
    for (const child of Array.from(parent.children)) {
      if (child.nodeName === `podcast:${tagName}`) {
        return child.textContent || '';
      }
    }
    return '';
  }

  private matchRssLicense(rssLicense: string): string {
    if (!rssLicense) return '';
    const normalized = rssLicense.trim().toLowerCase().replace(/[\s_]+/g, '-');
    const mapping: Record<string, string> = {
      'cc0-1.0': 'CC0 1.0',
      'cc0': 'CC0 1.0',
      'cc-by-4.0': 'CC-BY 4.0',
      'cc-by': 'CC-BY 4.0',
      'cc-by-sa-4.0': 'CC BY-SA 4.0',
      'cc-by-sa': 'CC BY-SA 4.0',
      'cc-by-nd-4.0': 'CC BY-ND 4.0',
      'cc-by-nd': 'CC BY-ND 4.0',
      'cc-by-nc-4.0': 'CC BY-NC 4.0',
      'cc-by-nc': 'CC BY-NC 4.0',
      'cc-by-nc-sa-4.0': 'CC BY-NC-SA 4.0',
      'cc-by-nc-sa': 'CC BY-NC-SA 4.0',
      'cc-by-nc-nd-4.0': 'CC BY-NC-ND 4.0',
      'cc-by-nc-nd': 'CC BY-NC-ND 4.0',
      'all-rights-reserved': 'All Rights Reserved',
    };
    return mapping[normalized] || '';
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

  addTrackGenre(index: number, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    this.tracks.update(tracks => {
      const updated = [...tracks];
      const track = updated[index];
      if (!track.genres.some(g => g.toLowerCase() === trimmed.toLowerCase())) {
        updated[index] = { ...track, genres: [...track.genres, trimmed] };
      }
      return updated;
    });
  }

  removeTrackGenre(index: number, genre: string): void {
    this.tracks.update(tracks => {
      const updated = [...tracks];
      const track = updated[index];
      updated[index] = { ...track, genres: track.genres.filter(g => g !== genre) };
      return updated;
    });
  }

  getFilteredGenres(currentGenres: string[]): string[] {
    const current = currentGenres.map(g => g.toLowerCase());
    return this.suggestedGenres.filter(g => !current.includes(g.toLowerCase()));
  }

  updateAlbumInfo(updates: Partial<AlbumInfo>): void {
    this.albumInfo.update(info => ({ ...info, ...updates }));
  }

  goBack(): void {
    this.hasFetched.set(false);
    this.tracks.set([]);
    this.valueRecipients.set([]);
    this.activeRecipientIndex.set(-1);
  }

  private generateEventTemplates(pubkey?: string): { kind: number; created_at: number; tags: string[][]; content: string }[] {
    const selectedTracks = this.tracks().filter(t => t.selected);
    const album = this.albumInfo();
    const events: { kind: number; created_at: number; tags: string[][]; content: string }[] = [];
    const trackDTags: string[] = [];

    for (const track of selectedTracks) {
      const dTag = track.guid || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const tags: string[][] = [
        ['d', dTag],
        ['title', track.title],
        ['url', track.audioUrl],
      ];

      if (track.imageUrl) {
        tags.push(['image', track.imageUrl]);
      } else if (album.enabled && album.imageUrl) {
        tags.push(['image', album.imageUrl]);
      } else {
        tags.push(['gradient', 'colors', this.currentGradient()]);
      }

      if (track.artist) {
        tags.push(['artist', track.artist]);
      }

      if (album.enabled && album.title) {
        tags.push(['album', album.title]);
      }

      if (track.trackNumber) {
        tags.push(['track_number', String(track.trackNumber)]);
      }

      if (track.duration) {
        const durationSeconds = this.parseDurationToSeconds(track.duration);
        if (durationSeconds && durationSeconds > 0) {
          tags.push(['duration', String(durationSeconds)]);
        }
      }

      if (track.releaseDate) {
        tags.push(['released', track.releaseDate]);
      }

      for (const genre of track.genres) {
        tags.push(['t', genre.toLowerCase()]);
      }

      if (track.aiGenerated) {
        tags.push(['ai_generated', 'true']);
      }

      if (track.license) {
        tags.push(['license', track.license]);
      }

      const recipients = this.valueRecipients();
      for (const split of track.splits) {
        const recipient = recipients.find(r => r.address === split.address);
        if (recipient?.resolvedPubkey && split.percentage > 0) {
          tags.push(['zap', recipient.resolvedPubkey, 'wss://relay.damus.io', String(split.percentage)]);
        }
      }

      tags.push(['alt', `Music track: ${track.title} by ${track.artist || 'Unknown Artist'}`]);

      const content = track.description || '';

      events.push({
        kind: MUSIC_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      });

      trackDTags.push(dTag);
    }

    // Generate album event (kind 34139) if album is enabled
    if (album.enabled && album.title && trackDTags.length > 0) {
      const albumDTag = album.guid || `album-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const authorPubkey = pubkey || '<pubkey>';

      const albumTags: string[][] = [
        ['d', albumDTag],
        ['title', album.title],
      ];

      if (album.imageUrl) {
        albumTags.push(['image', album.imageUrl]);
      } else {
        albumTags.push(['gradient', 'colors', this.currentGradient()]);
      }

      if (album.artist) {
        albumTags.push(['artist', album.artist]);
      }

      if (album.releaseDate) {
        albumTags.push(['released', album.releaseDate]);
      }

      // Reference each track
      for (const dTag of trackDTags) {
        albumTags.push(['a', `${MUSIC_KIND}:${authorPubkey}:${dTag}`]);
      }

      albumTags.push(['public', 'true']);
      albumTags.push(['t', 'music']);
      albumTags.push(['t', 'album']);
      albumTags.push(['alt', `Music album: ${album.title} by ${album.artist || 'Unknown Artist'}`]);

      events.push({
        kind: 34139,
        created_at: Math.floor(Date.now() / 1000),
        tags: albumTags,
        content: '',
      });
    }

    return events;
  }

  togglePreview(): void {
    if (this.showPreview()) {
      this.showPreview.set(false);
      this.previewEvents.set([]);
    } else {
      const pubkey = this.accountState.pubkey() || '<pubkey>';
      this.previewEvents.set(this.generateEventTemplates(pubkey));
      this.showPreview.set(true);
    }
  }

  async publishTracks(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Not authenticated', 'Close', { duration: 3000 });
      return;
    }

    const eventTemplates = this.generateEventTemplates(pubkey);
    if (eventTemplates.length === 0) {
      this.snackBar.open('No tracks selected', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);
    this.showPreview.set(false);
    const publishedEvents: Event[] = [];

    try {
      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      if (relayUrls.length === 0) {
        this.snackBar.open('No relays available', 'Close', { duration: 3000 });
        return;
      }

      for (const eventTemplate of eventTemplates) {
        const signedEvent = await this.nostrService.signEvent(eventTemplate);
        if (!signedEvent) {
          this.logger.warn('Failed to sign event');
          continue;
        }

        try {
          await this.pool.publish(relayUrls, signedEvent);
          publishedEvents.push(signedEvent);
        } catch (error) {
          this.logger.warn('Failed to publish track:', error);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (publishedEvents.length > 0) {
        const trackCount = publishedEvents.filter(e => e.kind === MUSIC_KIND).length;
        const albumCount = publishedEvents.filter(e => e.kind === 34139).length;
        const parts = [];
        if (trackCount > 0) parts.push(`${trackCount} track${trackCount > 1 ? 's' : ''}`);
        if (albumCount > 0) parts.push(`${albumCount} album`);
        this.snackBar.open(`Published ${parts.join(' + ')} successfully!`, 'Close', { duration: 3000 });
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

  // --- Podcast value recipient parsing ---

  private parseRawValueRecipients(parent: Element): { name: string; address: string; split: number; type: string }[] {
    const PODCAST_NS = 'https://podcastindex.org/namespace/1.0';
    const recipients: { name: string; address: string; split: number; type: string }[] = [];

    // Find podcast:value element
    let valueEl: Element | null = null;
    const nsValues = parent.getElementsByTagNameNS(PODCAST_NS, 'value');
    if (nsValues.length > 0) {
      valueEl = nsValues[0];
    } else {
      for (const child of Array.from(parent.children)) {
        if (child.nodeName === 'podcast:value') {
          valueEl = child;
          break;
        }
      }
    }

    if (!valueEl) return recipients;

    // Find podcast:valueRecipient elements
    const nsRecipients = valueEl.getElementsByTagNameNS(PODCAST_NS, 'valueRecipient');
    const recipientEls = nsRecipients.length > 0
      ? Array.from(nsRecipients)
      : Array.from(valueEl.children).filter(c => c.nodeName === 'podcast:valueRecipient');

    for (const el of recipientEls) {
      const name = el.getAttribute('name') || '';
      const address = el.getAttribute('address') || '';
      const split = parseInt(el.getAttribute('split') || '0', 10);
      const type = el.getAttribute('type') || '';
      if (address) {
        recipients.push({ name, address, split, type });
      }
    }

    return recipients;
  }

  onMentionSelected(selection: MentionSelection): void {
    const recipientIdx = this.activeRecipientIndex();
    if (recipientIdx >= 0) {
      this.resolveRecipientByPubkey(recipientIdx, selection.pubkey, selection.displayName);
    }
    this.mentionConfig.set(null);
  }

  onMentionDismissed(): void {
    this.mentionConfig.set(null);
  }

  // --- RSS recipient resolution ---

  startEditRecipient(index: number): void {
    this.activeRecipientIndex.set(index);
    this.valueRecipients.update(recipients => {
      return recipients.map((r, i) => ({
        ...r,
        isEditing: i === index,
        searchInput: i === index ? '' : r.searchInput,
      }));
    });
  }

  cancelEditRecipient(index: number): void {
    this.activeRecipientIndex.set(-1);
    this.mentionConfig.set(null);
    this.valueRecipients.update(recipients => {
      const updated = [...recipients];
      updated[index] = { ...updated[index], isEditing: false, searchInput: '' };
      return updated;
    });
  }

  onRecipientInputChange(index: number, event: globalThis.Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    this.activeRecipientIndex.set(index);

    this.valueRecipients.update(recipients => {
      const updated = [...recipients];
      updated[index] = { ...updated[index], searchInput: value };
      return updated;
    });

    const detection = this.mentionInputService.detectMention(value, input.selectionStart || value.length);
    if (detection.isTypingMention) {
      const rect = input.getBoundingClientRect();
      this.mentionPosition.set({
        top: rect.bottom + 4,
        left: rect.left
      });
      this.mentionConfig.set({
        cursorPosition: detection.cursorPosition,
        query: detection.query,
        mentionStart: detection.mentionStart
      });
    } else {
      this.mentionConfig.set(null);
    }
  }

  onRecipientInputKeyDown(event: KeyboardEvent): void {
    if (this.mentionConfig()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        if (event.key === 'Escape') {
          this.mentionConfig.set(null);
        }
        return;
      }
    }
  }

  async confirmRecipientSearch(index: number): Promise<void> {
    const recipient = this.valueRecipients()[index];
    const input = recipient.searchInput.trim();
    if (!input) return;

    try {
      let pubkey: string;

      if (input.startsWith('npub')) {
        const decoded = nip19.decode(input);
        if (decoded.type !== 'npub') {
          this.snackBar.open('Invalid npub', 'Close', { duration: 3000 });
          return;
        }
        pubkey = decoded.data;
      } else {
        if (!/^[0-9a-fA-F]{64}$/.test(input)) {
          this.snackBar.open('Invalid pubkey format. Use npub or 64-character hex.', 'Close', { duration: 3000 });
          return;
        }
        pubkey = input.toLowerCase();
      }

      await this.resolveRecipientByPubkey(index, pubkey);
    } catch {
      this.snackBar.open('Failed to resolve profile', 'Close', { duration: 3000 });
    }
  }

  async resolveRecipientByPubkey(index: number, pubkey: string, displayName?: string): Promise<void> {
    // Check if this pubkey is already used by another recipient
    const otherResolved = this.valueRecipients().some((r, i) => i !== index && r.resolvedPubkey === pubkey);
    if (otherResolved) {
      this.snackBar.open('This profile is already assigned', 'Close', { duration: 3000 });
      return;
    }

    const profile = await this.dataService.getProfile(pubkey);
    const name = displayName || profile?.data?.name || profile?.data?.display_name || nip19.npubEncode(pubkey).slice(0, 12) + '...';
    const avatar = profile?.data?.picture || null;

    // Update the recipient
    this.valueRecipients.update(recipients => {
      const updated = [...recipients];
      updated[index] = {
        ...updated[index],
        resolvedPubkey: pubkey,
        resolvedName: name,
        resolvedAvatar: avatar,
        isEditing: false,
        searchInput: '',
      };
      return updated;
    });

    this.activeRecipientIndex.set(-1);
    this.mentionConfig.set(null);
  }

  clearRecipientResolution(index: number): void {
    this.valueRecipients.update(recipients => {
      const updated = [...recipients];
      updated[index] = {
        ...updated[index],
        resolvedPubkey: '',
        resolvedName: '',
        resolvedAvatar: null,
      };
      return updated;
    });
  }

  getRecipientDisplayName(address: string): string {
    const recipient = this.valueRecipients().find(r => r.address === address);
    if (recipient?.resolvedName) return recipient.resolvedName;
    if (recipient?.name) return recipient.name;
    return address;
  }
}
