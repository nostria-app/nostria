import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { nip19 } from 'nostr-tools';

import { FollowingService } from '../../services/following.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { NPubPipe } from '../../pipes/npub.pipe';

export interface ForwardMessageDialogResult {
  pubkeys: string[];
}

@Component({
  selector: 'app-forward-message-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule,
    MatCheckboxModule,
    UserProfileComponent,
    NPubPipe,
  ],
  templateUrl: './forward-message-dialog.component.html',
  styleUrl: './forward-message-dialog.component.scss',
})
export class ForwardMessageDialogComponent {
  private readonly dialogRef = inject(CustomDialogRef<ForwardMessageDialogComponent, ForwardMessageDialogResult | undefined>);
  private readonly followingService = inject(FollowingService);

  // Form state
  searchInput = signal<string>('');

  // Selected pubkeys for forwarding (multi-select)
  selectedPubkeys = signal<Set<string>>(new Set());

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

  // Computed: Number of selected recipients
  selectedCount = computed(() => this.selectedPubkeys().size);

  // Computed: Can forward (at least one recipient selected)
  canForward = computed(() => this.selectedPubkeys().size > 0);

  constructor() {
    // Load initial following list
    this.loadInitialFollowingList();
  }

  private loadInitialFollowingList(): void {
    const allProfiles = this.followingService.searchProfiles('');
    this.initialFollowingList = this.followingService.toNostrRecords(allProfiles).slice(0, 50);
  }

  isSelected(pubkey: string): boolean {
    return this.selectedPubkeys().has(pubkey);
  }

  toggleProfile(pubkey: string): void {
    const current = new Set(this.selectedPubkeys());
    if (current.has(pubkey)) {
      current.delete(pubkey);
    } else {
      current.add(pubkey);
    }
    this.selectedPubkeys.set(current);
  }

  addNpub(): void {
    if (!this.hasValidNpub()) return;

    try {
      const decoded = nip19.decode(this.searchInput().trim());
      const pubkey = decoded.data as string;
      const current = new Set(this.selectedPubkeys());
      current.add(pubkey);
      this.selectedPubkeys.set(current);
      this.searchInput.set('');
    } catch {
      // Invalid npub, ignore
    }
  }

  removeSelected(pubkey: string): void {
    const current = new Set(this.selectedPubkeys());
    current.delete(pubkey);
    this.selectedPubkeys.set(current);
  }

  forward(): void {
    if (!this.canForward()) return;

    const result: ForwardMessageDialogResult = {
      pubkeys: Array.from(this.selectedPubkeys()),
    };

    this.dialogRef.close(result);
  }

  close(): void {
    this.dialogRef.close();
  }
}
