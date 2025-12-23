import { Component, computed, input, inject, signal, effect } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { Event } from 'nostr-tools';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import { RouterLink } from '@angular/router';
import { NPubPipe } from '../../pipes/npub.pipe';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';

@Component({
  selector: 'app-music-event',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    AudioPlayerComponent,
    RouterLink,
    NPubPipe,
  ],
  template: `
    <div class="music-event">
      @if (image()) {
        <div class="music-cover">
          <img [src]="image()" [alt]="title()" class="cover-image" />
          @if (aiGenerated()) {
            <span class="ai-badge" i18n="@@music.aiGenerated">AI Generated</span>
          }
        </div>
      }
      
      <div class="music-info">
        <h3 class="music-title">{{ title() || 'Untitled Track' }}</h3>
        
        @if (showAuthor()) {
          <div class="music-author">
            @if (authorProfile()?.data?.picture) {
              <img [src]="authorProfile()?.data?.picture" class="author-avatar" alt="" />
            } @else {
              <mat-icon class="author-avatar-icon">account_circle</mat-icon>
            }
            <a [routerLink]="['/p', event().pubkey]" class="author-link">
              {{ authorProfile()?.data?.name || authorProfile()?.data?.display_name || (event().pubkey | npub) }}
            </a>
          </div>
        }
        
        @if (tags().length > 0) {
          <mat-chip-set class="music-tags">
            @for (tag of tags(); track tag) {
              <mat-chip class="tag-chip">{{ tag }}</mat-chip>
            }
          </mat-chip-set>
        }
      </div>
      
      <div class="music-player">
        <app-audio-player 
          [src]="audioUrl()"
          [waveform]="[]"
          [duration]="0"
        />
      </div>
      
      @if (hasLyrics() && showLyrics()) {
        <div class="music-lyrics">
          <button mat-button class="lyrics-toggle" (click)="toggleLyrics()">
            <mat-icon>{{ lyricsExpanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
            <span i18n="@@music.lyrics">Lyrics</span>
          </button>
          @if (lyricsExpanded()) {
            <pre class="lyrics-content">{{ lyrics() }}</pre>
          }
        </div>
      }
      
      @if (client()) {
        <div class="music-client">
          <span class="client-label" i18n="@@music.createdWith">Created with</span>
          <span class="client-name">{{ client() }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .music-event {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .music-cover {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      max-width: 300px;
      margin: 0 auto;
      border-radius: var(--mat-sys-corner-medium);
      overflow: hidden;
      
      .cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .ai-badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        padding: 0.25rem 0.5rem;
        background-color: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
        border-radius: var(--mat-sys-corner-small);
        font-size: 0.75rem;
      }
    }
    
    .music-info {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .music-title {
      margin: 0;
      font-size: 1.25rem;
      color: var(--mat-sys-on-surface);
    }
    
    .music-author {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      
      .author-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        object-fit: cover;
      }
      
      .author-avatar-icon {
        width: 24px;
        height: 24px;
        font-size: 24px;
        color: var(--mat-sys-on-surface-variant);
      }
      
      .author-link {
        color: var(--mat-sys-on-surface-variant);
        text-decoration: none;
        
        &:hover {
          color: var(--mat-sys-primary);
          text-decoration: underline;
        }
      }
    }
    
    .music-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      
      .tag-chip {
        font-size: 0.75rem;
      }
    }
    
    .music-player {
      width: 100%;
    }
    
    .music-lyrics {
      display: flex;
      flex-direction: column;
      
      .lyrics-toggle {
        align-self: flex-start;
      }
      
      .lyrics-content {
        margin: 0.5rem 0 0 0;
        padding: 1rem;
        background-color: var(--mat-sys-surface-container);
        border-radius: var(--mat-sys-corner-small);
        white-space: pre-wrap;
        font-family: inherit;
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface-variant);
        max-height: 300px;
        overflow-y: auto;
      }
    }
    
    .music-client {
      display: flex;
      gap: 0.25rem;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      
      .client-name {
        color: var(--mat-sys-primary);
      }
    }
  `],
})
export class MusicEventComponent {
  private data = inject(DataService);

  event = input.required<Event>();
  showAuthor = input<boolean>(true);
  showLyrics = input<boolean>(true);

  lyricsExpanded = signal(false);
  authorProfile = signal<NostrRecord | undefined>(undefined);

  constructor() {
    // Load author profile
    effect(() => {
      const pubkey = this.event().pubkey;
      if (pubkey) {
        this.data.getProfile(pubkey).then(profile => {
          this.authorProfile.set(profile);
        });
      }
    });
  }

  // Extract title from tags
  title = computed(() => {
    const event = this.event();
    const titleTag = event.tags.find(t => t[0] === 'title');
    return titleTag?.[1] || null;
  });

  // Extract audio URL
  audioUrl = computed(() => {
    const event = this.event();
    const urlTag = event.tags.find(t => t[0] === 'url');
    if (urlTag?.[1]) {
      return urlTag[1];
    }

    // Fallback to content if it's a URL
    const content = event.content;
    const match = content.match(/(https?:\/\/[^\s]+\.(mp3|wav|ogg|flac|m4a))/i);
    return match ? match[0] : '';
  });

  // Extract cover image
  image = computed(() => {
    const event = this.event();
    const imageTag = event.tags.find(t => t[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Extract tags (genres, categories)
  tags = computed(() => {
    const event = this.event();
    return event.tags
      .filter(t => t[0] === 't')
      .map(t => t[1])
      .filter(Boolean);
  });

  // Check if AI generated
  aiGenerated = computed(() => {
    const event = this.event();
    const aiTag = event.tags.find(t => t[0] === 'ai-generated');
    return aiTag?.[1] === 'true';
  });

  // Extract client
  client = computed(() => {
    const event = this.event();
    const clientTag = event.tags.find(t => t[0] === 'client');
    return clientTag?.[1] || null;
  });

  // Check if has lyrics
  hasLyrics = computed(() => {
    const event = this.event();
    return event.content && event.content.trim().length > 0 && !event.content.match(/^https?:\/\//);
  });

  // Get lyrics from content
  lyrics = computed(() => {
    const event = this.event();
    // Remove "Lyrics:" prefix if present
    return event.content.replace(/^Lyrics:\s*/i, '').trim();
  });

  toggleLyrics(): void {
    this.lyricsExpanded.update(v => !v);
  }
}
