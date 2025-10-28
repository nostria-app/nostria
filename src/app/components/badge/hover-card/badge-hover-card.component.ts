import {
  Component,
  input,
  signal,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { BadgeService, ParsedBadge } from '../../../services/badge.service';
import { NostrEvent } from 'nostr-tools';
import { StorageService } from '../../../services/storage.service';

@Component({
  selector: 'app-badge-hover-card',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    RouterModule,
  ],
  templateUrl: './badge-hover-card.component.html',
  styleUrl: './badge-hover-card.component.scss',
})
export class BadgeHoverCardComponent {
  pubkey = input.required<string>();
  slug = input.required<string>();

  private badgeService = inject(BadgeService);
  private storage = inject(StorageService);

  isLoading = signal<boolean>(true);
  badgeDefinition = signal<NostrEvent | undefined>(undefined);
  parsedBadge = signal<ParsedBadge | undefined>(undefined);
  error = signal<string | null>(null);
  issuerName = signal<string>('');

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();
      const slug = this.slug();

      if (pubkey && slug) {
        untracked(() => {
          this.loadBadgeData();
        });
      }
    });
  }

  async loadBadgeData() {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const pubkey = this.pubkey();
      const slug = this.slug();

      // Try to get badge definition from service first
      let definition = this.badgeService.getBadgeDefinition(pubkey, slug);

      if (!definition) {
        // Load from service
        const loadedDefinition = await this.badgeService.loadBadgeDefinition(
          pubkey,
          slug
        );
        if (loadedDefinition) {
          definition = loadedDefinition;
        }
      }

      if (definition) {
        this.badgeDefinition.set(definition);
        const parsed = this.badgeService.parseDefinition(definition);
        this.parsedBadge.set(parsed);

        // Load issuer name
        const event = await this.storage.getEventByPubkeyAndKind(
          pubkey,
          0
        );
        if (event) {
          try {
            const metadata = JSON.parse(event.content);
            const name = metadata.display_name || metadata.name || 'Unknown';
            this.issuerName.set(name);
          } catch (e) {
            console.error('Failed to parse metadata:', e);
          }
        }
      } else {
        this.error.set('Badge not found');
      }
    } catch (err) {
      console.error('Error loading badge hover card data:', err);
      this.error.set('Failed to load badge');
    } finally {
      this.isLoading.set(false);
    }
  }
}
