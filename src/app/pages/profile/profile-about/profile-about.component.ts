import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { NostrRecord } from '../../../interfaces';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';

@Component({
  selector: 'app-profile-about',
  imports: [CommonModule, MatCardModule, MatIconModule, MatButtonModule, TimestampPipe],
  templateUrl: './profile-about.component.html',
  styleUrl: './profile-about.component.scss',
})
export class ProfileAboutComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private readonly data = inject(DataService);
  utilities = inject(UtilitiesService);

  userMetadata = signal<NostrRecord | undefined>(undefined);

  constructor() {
    effect(() => {
      //   const pubkey = this.getPubkey();
      //   if (pubkey) {
      //     this.loadUserMetadata(pubkey);
      //   }
    });
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  // Get the formatted npub for display
  getFormattedNpub(): string {
    const pubkey = this.getPubkey();
    return pubkey ? this.utilities.getNpubFromPubkey(pubkey) : '';
  }

  // Load user metadata
  async loadUserMetadata(pubkey: string): Promise<void> {
    try {
      const metadata = await this.data.getProfile(pubkey);
      // const metadata = await this.nostrService.getMetadataForUser(pubkey);
      this.userMetadata.set(metadata);
    } catch (err) {
      this.logger.error('Error loading user metadata:', err);
    }
  }

  // Copy pubkey to clipboard
  copyToClipboard(): void {
    navigator.clipboard
      .writeText(this.getFormattedNpub())
      .then(() => {
        this.logger.debug('Npub copied to clipboard');
      })
      .catch(err => {
        this.logger.error('Failed to copy npub to clipboard:', err);
      });
  }
}
