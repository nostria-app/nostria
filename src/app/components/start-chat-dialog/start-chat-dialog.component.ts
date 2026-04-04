import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';

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
  isGroup?: boolean;
  participants?: string[];
  subject?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    MatChipsModule,
    MatTabsModule,
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

  // Mode: 0 = direct message, 1 = group
  mode = signal<number>(0);

  // Form state - single unified input
  searchInput = signal<string>('');
  isLegacy = signal<boolean>(false);

  // Group-specific state
  groupSubject = signal<string>('');
  selectedGroupMembers = signal<NostrRecord[]>([]);

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

  // Computed: Search results based on input (excludes already-selected group members)
  searchResults = computed(() => {
    const input = this.searchInput().trim().toLowerCase();

    // If input is an npub, don't show search results
    if (this.isNpubInput()) {
      return [];
    }

    // If no input, show initial following list
    let results: NostrRecord[];
    if (!input) {
      results = this.initialFollowingList;
    } else {
      // Filter following list by search query
      const followingResults = this.followingService.searchProfiles(input);
      results = this.followingService.toNostrRecords(followingResults);
    }

    // In group mode, exclude already-selected members
    if (this.mode() === 1) {
      const selectedPubkeys = new Set(this.selectedGroupMembers().map(m => m.event.pubkey));
      results = results.filter(r => !selectedPubkeys.has(r.event.pubkey));
    }

    return results;
  });

  canStartChat = computed(() => {
    if (this.mode() === 1) {
      // Group mode: need at least 2 other participants
      return this.selectedGroupMembers().length >= 2;
    }
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

  onModeChange(index: number): void {
    this.mode.set(index);
    // Reset state when switching modes
    this.selectedProfile.set(null);
    this.selectedGroupMembers.set([]);
    this.searchInput.set('');
    this.groupSubject.set('');
    this.isLegacy.set(false);
  }

  selectProfile(profile: NostrRecord): void {
    if (this.mode() === 1) {
      // Group mode: add to members list
      this.addGroupMember(profile);
    } else {
      this.selectedProfile.set(profile);
      this.searchInput.set('');
    }
  }

  addGroupMember(profile: NostrRecord): void {
    const current = this.selectedGroupMembers();
    if (!current.some(m => m.event.pubkey === profile.event.pubkey)) {
      this.selectedGroupMembers.set([...current, profile]);
    }
    this.searchInput.set('');
  }

  addGroupMemberFromNpub(): void {
    if (!this.hasValidNpub()) return;
    const decoded = nip19.decode(this.searchInput().trim());
    const pubkey = decoded.data as string;

    // Check if already added
    const current = this.selectedGroupMembers();
    if (current.some(m => m.event.pubkey === pubkey)) {
      this.searchInput.set('');
      return;
    }

    // Create a minimal NostrRecord for the npub
    const record: NostrRecord = {
      event: { pubkey, id: '', sig: '', kind: 0, created_at: 0, tags: [], content: '' },
      data: {},
    };
    this.selectedGroupMembers.set([...current, record]);
    this.searchInput.set('');
  }

  removeGroupMember(pubkey: string): void {
    this.selectedGroupMembers.update(members => members.filter(m => m.event.pubkey !== pubkey));
  }

  clearSelection(): void {
    this.selectedProfile.set(null);
  }

  startChat(): void {
    if (this.mode() === 1) {
      // Group mode
      const members = this.selectedGroupMembers();
      if (members.length < 2) return;

      const result: StartChatDialogResult = {
        pubkey: members[0].event.pubkey, // Primary pubkey (not very meaningful for groups)
        isLegacy: false, // Groups always use NIP-44
        isGroup: true,
        participants: members.map(m => m.event.pubkey),
        subject: this.groupSubject().trim() || undefined,
      };

      this.dialogRef.close(result);
    } else {
      // Direct message mode
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
  }

  close(): void {
    this.dialogRef.close();
  }
}
