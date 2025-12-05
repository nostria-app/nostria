import { Component, inject, signal, computed, effect, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatListModule } from '@angular/material/list';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { nip19 } from 'nostr-tools';

import { AccountStateService } from '../../services/account-state.service';
import { FollowingService } from '../../services/following.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { NPubPipe } from '../../pipes/npub.pipe';

export interface StartChatDialogResult {
  pubkey: string;
  isLegacy: boolean;
}

@Component({
  selector: 'app-start-chat-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatListModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    UserProfileComponent,
    NPubPipe,
  ],
  templateUrl: './start-chat-dialog.component.html',
  styleUrl: './start-chat-dialog.component.scss',
})
export class StartChatDialogComponent {
  private readonly dialogRef = inject(CustomDialogRef<StartChatDialogComponent, StartChatDialogResult | undefined>);
  private readonly accountState = inject(AccountStateService);
  private readonly followingService = inject(FollowingService);

  // Form state
  searchQuery = signal<string>('');
  npubInput = signal<string>('');
  isLegacy = signal<boolean>(false);

  // UI state
  isDiscoveringRelays = signal<boolean>(false);
  searchResults = signal<NostrRecord[]>([]);
  selectedProfile = signal<NostrRecord | null>(null);
  npubError = signal<string>('');

  // Computed properties
  hasValidNpub = computed(() => {
    const input = this.npubInput().trim();
    if (!input) return false;

    try {
      const decoded = nip19.decode(input);
      return decoded.type === 'npub';
    } catch {
      return false;
    }
  });

  canStartChat = computed(() => {
    return this.selectedProfile() !== null || this.hasValidNpub();
  });

  constructor() {
    // Effect to handle search query changes using FollowingService
    effect(() => {
      const query = this.searchQuery().trim();
      if (query.length >= 2) {
        const results = untracked(() => {
          const followingResults = this.followingService.searchProfiles(query);
          return this.followingService.toNostrRecords(followingResults);
        });
        this.searchResults.set(results);
      } else {
        this.searchResults.set([]);
      }
    });

    // Effect to validate npub input
    effect(() => {
      const input = this.npubInput().trim();
      if (input && !this.hasValidNpub()) {
        this.npubError.set('Invalid npub format');
      } else {
        this.npubError.set('');
      }
    });
  }

  selectProfile(profile: NostrRecord): void {
    this.selectedProfile.set(profile);
    this.npubInput.set('');
    this.searchQuery.set('');
    this.searchResults.set([]);
  }

  clearSelection(): void {
    this.selectedProfile.set(null);
  }

  async discoverRelays(): Promise<void> {
    if (!this.hasValidNpub()) return;

    this.isDiscoveringRelays.set(true);

    try {
      const decoded = nip19.decode(this.npubInput().trim());
      if (decoded.type === 'npub') {
        const pubkey = decoded.data;

        // TODO: Implement relay discovery using NIP-65 or NIP-05
        // For now, we'll just validate the pubkey

        // Clear search results and selection when using npub input
        this.selectedProfile.set(null);
        this.searchResults.set([]);

        console.log('Discovering relays for pubkey:', pubkey);

        // Simulate relay discovery delay
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Error discovering relays:', error);
      this.npubError.set('Error discovering relays');
    } finally {
      this.isDiscoveringRelays.set(false);
    }
  }

  startChat(): void {
    let pubkey: string;

    if (this.selectedProfile()) {
      pubkey = this.selectedProfile()!.event.pubkey;
    } else if (this.hasValidNpub()) {
      const decoded = nip19.decode(this.npubInput().trim());
      pubkey = decoded.data as string;
    } else {
      return;
    }

    const result: StartChatDialogResult = {
      pubkey,
      isLegacy: this.isLegacy(),
    };

    this.dialogRef.close(result);
  }

  close(): void {
    this.dialogRef.close();
  }
}
