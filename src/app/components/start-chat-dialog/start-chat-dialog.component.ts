import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
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
    MatSlideToggleModule,
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

  // Form state - single unified input
  searchInput = signal<string>('');
  isLegacy = signal<boolean>(false);

  // UI state
  isDiscoveringRelays = signal<boolean>(false);
  selectedProfile = signal<NostrRecord | null>(null);

  // Initial following list (cached on component init)
  private initialFollowingList: NostrRecord[] = [];

  // Computed: Check if input looks like an npub
  isNpubInput = computed(() => {
    const input = this.searchInput().trim();
    return input.startsWith('npub1');
  });

  // Computed: Validate npub format
  hasValidNpub = computed(() => {
    const input = this.searchInput().trim();
    if (!input || !this.isNpubInput()) return false;

    try {
      const decoded = nip19.decode(input);
      return decoded.type === 'npub';
    } catch {
      return false;
    }
  });

  // Computed: Error message for invalid npub
  npubError = computed(() => {
    const input = this.searchInput().trim();
    if (this.isNpubInput() && input.length > 10 && !this.hasValidNpub()) {
      return 'Invalid npub format';
    }
    return '';
  });

  // Computed: Search results based on input
  searchResults = computed(() => {
    const input = this.searchInput().trim().toLowerCase();

    // If input is an npub, don't show search results
    if (this.isNpubInput()) {
      return [];
    }

    // If no input, show initial following list
    if (!input) {
      return this.initialFollowingList;
    }

    // Filter following list by search query
    const followingResults = this.followingService.searchProfiles(input);
    return this.followingService.toNostrRecords(followingResults);
  });

  canStartChat = computed(() => {
    return this.selectedProfile() !== null || this.hasValidNpub();
  });

  constructor() {
    // Load initial following list
    this.loadInitialFollowingList();
  }

  private loadInitialFollowingList(): void {
    // Get all profiles from following list (limited for performance)
    const allProfiles = this.followingService.searchProfiles('');
    this.initialFollowingList = this.followingService.toNostrRecords(allProfiles).slice(0, 50);
  }

  selectProfile(profile: NostrRecord): void {
    this.selectedProfile.set(profile);
    this.searchInput.set('');
  }

  clearSelection(): void {
    this.selectedProfile.set(null);
  }

  startChat(): void {
    let pubkey: string;

    if (this.selectedProfile()) {
      pubkey = this.selectedProfile()!.event.pubkey;
    } else if (this.hasValidNpub()) {
      const decoded = nip19.decode(this.searchInput().trim());
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
