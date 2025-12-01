import {
  Component,
  input,
  signal,
  effect,
  inject,
  untracked,
} from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterModule } from '@angular/router';
import { DataService } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';
import { DatabaseService } from '../../services/database.service';
import { UserRelayService } from '../../services/relays/user-relay';
import { FavoritesService } from '../../services/favorites.service';
import { kinds } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import type { NostrRecord } from '../../interfaces';

@Component({
  selector: 'app-timeline-hover-card',
  standalone: true,
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    RouterModule
],
  templateUrl: './timeline-hover-card.component.html',
  styleUrl: './timeline-hover-card.component.scss',
})
export class TimelineHoverCardComponent {
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);
  private database = inject(DatabaseService);
  private userRelayService = inject(UserRelayService);
  private favoritesService = inject(FavoritesService);
  private router = inject(Router);

  pubkey = input.required<string>();
  profile = signal<{ data?: { display_name?: string; name?: string; picture?: string } } | null>(null);
  recentNotes = signal<NostrRecord[]>([]);
  isLoading = signal(false);

  npubValue = signal<string>('');

  // Expose isFavorite as a computed signal
  isFavorite = () => this.favoritesService.isFavorite(this.pubkey());

  isHovering = signal(false);
  effectTransform = signal('');

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();

      if (pubkey) {
        untracked(() => {
          this.loadProfile(pubkey);
          this.loadRecentNotes(pubkey);
          this.npubValue.set(nip19.npubEncode(pubkey));
        });
      }
    });
  }

  private async loadProfile(pubkey: string): Promise<void> {
    try {
      const profile = await this.dataService.getProfile(pubkey);
      this.profile.set(profile || null);
    } catch (error) {
      console.error('Failed to load profile for timeline hover card:', error);
      this.profile.set(null);
    }
  }

  private async loadRecentNotes(pubkey: string): Promise<void> {
    this.isLoading.set(true);

    try {
      // Fetch fresh data from relays to ensure we get recent posts
      // Calculate timestamp from 30 days ago
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

      const events = await this.userRelayService.query(pubkey, {
        kinds: [kinds.ShortTextNote],
        authors: [pubkey],
        since: thirtyDaysAgo,
        limit: 20, // Fetch more to ensure we have enough root posts
      });

      if (events && events.length > 0) {
        const notes = events
          .filter(event => this.utilities.isRootPost(event))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 5)
          .map(event => ({
            event,
            data: event.content,
          }));

        this.recentNotes.set(notes);
      } else {
        // Fallback to storage if relay query fails or returns nothing
        const storageEvents = await this.database.getUserEvents(pubkey);
        const rootNotes = storageEvents
          .filter(event => event.kind === kinds.ShortTextNote && this.utilities.isRootPost(event))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 5);

        if (rootNotes.length > 0) {
          this.recentNotes.set(rootNotes.map(event => ({
            event,
            data: event.content,
          })));
        }
      }
    } catch (error) {
      console.error('Failed to load recent notes for timeline hover card:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  onCardMouseMove(event: MouseEvent) {
    this.isHovering.set(true);
    const card = event.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    this.effectTransform.set(`translate(${x}px, ${y}px) translate(-50%, -50%)`);
  }

  onCardMouseLeave() {
    this.isHovering.set(false);
  }

  getDisplayName(): string {
    const profileData = this.profile();
    if (!profileData?.data) return 'Anonymous';
    return profileData.data.display_name || profileData.data.name || 'Anonymous';
  }

  getAvatarUrl(): string | undefined {
    return this.profile()?.data?.picture;
  }

  truncateContent(content: string): string {
    if (!content) return '';
    const maxLength = 200;
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  getTimeAgo(timestamp: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return `${Math.floor(diff / 604800)}w ago`;
  }

  navigateToEvent(eventId: string): void {
    const pubkey = this.pubkey();
    const neventId = nip19.neventEncode({
      id: eventId,
      author: pubkey,
    });
    this.router.navigate(['/e', neventId]);
  }

  toggleFavorite(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.favoritesService.toggleFavorite(this.pubkey());
  }
}
