import { Component, computed, input, inject, signal, effect, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { MediaPlayerService } from '../../services/media-player.service';
import { MediaItem } from '../../interfaces';
import { IgdbService, GameData } from '../../services/igdb.service';
import { GameHoverCardService } from '../../services/game-hover-card.service';
import { TimestampPipe } from '../../pipes/timestamp.pipe';

@Component({
  selector: 'app-live-event',
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatTooltipModule,
    MatMenuModule,
    TimestampPipe,
    UserProfileComponent,
  ],
  templateUrl: './live-event.component.html',
  styleUrl: './live-event.component.scss',
})
export class LiveEventComponent {
  event = input.required<Event>();

  @ViewChild('gameCoverElement') gameCoverElement?: ElementRef<HTMLElement>;

  private router = inject(Router);
  private mediaPlayer = inject(MediaPlayerService);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private igdbService = inject(IgdbService);
  private gameHoverCardService = inject(GameHoverCardService);

  // Track thumbnail load errors
  thumbnailError = signal(false);

  // Game data for IGDB integration
  gameData = signal<GameData | null>(null);
  gameLoading = signal(false);

  // Live event title
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    const titleTag = event.tags.find(tag => tag[0] === 'title');
    const fullTitle = titleTag?.[1] || 'Untitled Live Event';

    // Truncate to 100 characters
    if (fullTitle.length > 100) {
      return fullTitle.substring(0, 100) + '...';
    }
    return fullTitle;
  });

  // Live event summary/description
  summary = computed(() => {
    const event = this.event();
    if (!event) return null;

    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    const fullSummary = summaryTag?.[1] || null;

    // Truncate to 200 characters
    if (fullSummary && fullSummary.length > 200) {
      return fullSummary.substring(0, 200) + '...';
    }
    return fullSummary;
  });

  // Live event status
  status = computed(() => {
    const event = this.event();
    if (!event) return 'planned';

    const statusTag = event.tags.find(tag => tag[0] === 'status');
    return statusTag?.[1] || 'planned';
  });

  // Start timestamp (in seconds)
  starts = computed(() => {
    const event = this.event();
    if (!event) return null;

    const startsTag = event.tags.find(tag => tag[0] === 'starts');
    return startsTag?.[1] ? parseInt(startsTag[1], 10) : null;
  });

  // End timestamp (in seconds)
  ends = computed(() => {
    const event = this.event();
    if (!event) return null;

    const endsTag = event.tags.find(tag => tag[0] === 'ends');
    return endsTag?.[1] ? parseInt(endsTag[1], 10) : null;
  });

  // Thumbnail image
  thumbnail = computed(() => {
    const event = this.event();
    if (!event) return null;

    const thumbTag = event.tags.find(tag => tag[0] === 'thumb');
    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return thumbTag?.[1] || imageTag?.[1] || null;
  });

  // Streaming URL
  streamingUrl = computed(() => {
    const event = this.event();
    if (!event) return null;

    const streamingTag = event.tags.find(tag => tag[0] === 'streaming');
    return streamingTag?.[1] || null;
  });

  // Service URL (API endpoint)
  serviceUrl = computed(() => {
    const event = this.event();
    if (!event) return null;

    const serviceTag = event.tags.find(tag => tag[0] === 'service');
    return serviceTag?.[1] || null;
  });

  // Current participants count
  currentParticipants = computed(() => {
    const event = this.event();
    if (!event) return null;

    const participantsTag = event.tags.find(tag => tag[0] === 'current_participants');
    return participantsTag?.[1] ? parseInt(participantsTag[1], 10) : null;
  });

  // Total participants count
  totalParticipants = computed(() => {
    const event = this.event();
    if (!event) return null;

    const participantsTag = event.tags.find(tag => tag[0] === 'total_participants');
    return participantsTag?.[1] ? parseInt(participantsTag[1], 10) : null;
  });

  // Participants (hosts, speakers, etc.)
  participants = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 'p')
      .map(tag => ({
        pubkey: tag[1],
        relay: tag[2] || '',
        role: tag[3] || 'Participant',
        proof: tag[4] || null,
      }));
  });

  // First participant for fallback images
  firstParticipant = computed(() => {
    const participants = this.participants();
    return participants.length > 0 ? participants[0] : null;
  });

  // Hashtags
  hashtags = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1]);
  });

  // Display hashtags with igdb tags replaced by game name
  displayHashtags = computed(() => {
    const tags = this.hashtags();
    const game = this.gameData();

    const mappedTags = tags.map(tag => {
      if (tag.startsWith('igdb:') && game?.name) {
        return game.name;
      }
      return tag;
    });

    // Remove duplicates to prevent Angular tracking errors
    return [...new Set(mappedTags)];
  });

  // IGDB game ID from tags
  igdbGameId = computed(() => {
    const event = this.event();
    if (!event) return null;
    return this.igdbService.extractIgdbId(event.tags);
  });

  // Game cover URL
  gameCoverUrl = computed(() => {
    return this.igdbService.getBestCoverUrl(this.gameData(), 'small');
  });

  // Extract URL from alt tag
  altUrl = computed(() => {
    const event = this.event();
    if (!event) return null;

    const altTag = event.tags.find(tag => tag[0] === 'alt');
    if (!altTag?.[1]) return null;

    // Extract URL from the alt text (format: "Watch live on <URL>")
    const urlMatch = altTag[1].match(/https?:\/\/[^\s]+/);
    return urlMatch?.[0] || null;
  });

  // Status badge color
  statusColor = computed(() => {
    const status = this.status();
    switch (status) {
      case 'live':
        return 'accent';
      case 'ended':
        return 'basic';
      default:
        return 'primary';
    }
  });

  // Status icon
  statusIcon = computed(() => {
    const status = this.status();
    switch (status) {
      case 'live':
        return 'radio_button_checked';
      case 'ended':
        return 'stop_circle';
      default:
        return 'schedule';
    }
  });

  // Check if the live event is happening now
  isLive = computed(() => {
    return this.status() === 'live';
  });

  constructor() {
    // Load game data when IGDB ID is present
    effect(() => {
      const gameId = this.igdbGameId();
      if (gameId) {
        this.loadGameData(gameId);
      }
    });
  }

  private async loadGameData(gameId: number): Promise<void> {
    // Check if already cached
    if (this.igdbService.isGameCached(gameId)) {
      this.gameData.set(this.igdbService.getCachedGame(gameId)!);
      return;
    }

    this.gameLoading.set(true);
    try {
      const data = await this.igdbService.fetchGameData(gameId);
      this.gameData.set(data);
    } finally {
      this.gameLoading.set(false);
    }
  }

  // Game hover card methods
  onGameCoverHover(element: HTMLElement): void {
    const gameId = this.igdbGameId();
    if (gameId) {
      this.gameHoverCardService.showHoverCard(element, gameId);
    }
  }

  onGameCoverLeave(): void {
    this.gameHoverCardService.hideHoverCard();
  }

  // Play stream in media player
  openStream(): void {
    const url = this.streamingUrl();
    if (!url) return;

    const title = this.title() || 'Live Stream';
    const thumbnail = this.thumbnail() || '/icons/icon-192x192.png';

    // Create media item for the live stream
    const mediaItem: MediaItem = {
      source: url,
      title: title,
      artist: 'Live Stream',
      artwork: thumbnail,
      type: url.toLowerCase().includes('cornychat') ? 'External' :
        url.toLowerCase().includes('.m3u8') ? 'HLS' :
          url.toLowerCase().startsWith('wss+livekit') ? 'LiveKit' : 'Video',
      isLiveStream: true, // Mark as live stream
      participants: this.participants(), // Pass participant data
      liveEventData: this.event(), // Pass full event data
    };

    // Play the stream in the media player
    this.mediaPlayer.play(mediaItem);
  }

  // Open event page or alt URL
  openEventPage(): void {
    const altUrlValue = this.altUrl();

    if (altUrlValue) {
      // If alt URL exists, open that instead
      window.open(altUrlValue, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback to event page
      const event = this.event();
      if (event) {
        this.router.navigate(['/e', event.id]);
      }
    }
  }

  // Copy event data to clipboard for debugging
  copyEventData(): void {
    const event = this.event();
    if (event) {
      this.clipboard.copy(JSON.stringify(event, null, 2));
      this.snackBar.open('Event data copied to clipboard', 'Close', {
        duration: 3000,
      });
    }
  }

  // Handle thumbnail image load error
  onThumbnailError(): void {
    this.thumbnailError.set(true);
  }
}
