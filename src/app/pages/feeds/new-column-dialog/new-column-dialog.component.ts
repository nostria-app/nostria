import { Component, inject, signal, computed } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { FormBuilder, ReactiveFormsModule, FormControl } from '@angular/forms';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { MatChipInputEvent } from '@angular/material/chips';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { FeedService, ColumnConfig } from '../../../services/feed.service';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { AccountStateService } from '../../../services/account-state.service';
import { Followset, StarterPack } from '../../../services/followset';
import { NostrRecord } from '../../../interfaces';
import { DataService } from '../../../services/data.service';
import { EncryptionService } from '../../../services/encryption.service';
import { LoggerService } from '../../../services/logger.service';

export interface FollowSet {
  id: string; // event id
  dTag: string; // d-tag identifier
  title: string;
  description?: string;
  pubkeys: string[]; // Combined public and private pubkeys
  created: number;
}

interface DialogData {
  icons: string[];
  column?: ColumnConfig;
}

// Common Nostr event kinds
const NOSTR_KINDS = [
  { value: 0, label: 'Metadata (0)' },
  { value: 1, label: 'Text Note (1)' },
  { value: 2, label: 'Recommend Relay (2)' },
  { value: 3, label: 'Contacts (3)' },
  { value: 4, label: 'Encrypted Direct Messages (4)' },
  { value: 5, label: 'Event Deletion (5)' },
  { value: 6, label: 'Repost (6)' },
  { value: 7, label: 'Reaction (7)' },
  { value: 8, label: 'Badge Award (8)' },
  { value: 16, label: 'Generic Repost (16)' },
  { value: 20, label: 'Picture (20)' },
  { value: 21, label: 'Video Event (21)' },
  { value: 40, label: 'Channel Creation (40)' },
  { value: 41, label: 'Channel Metadata (41)' },
  { value: 42, label: 'Channel Message (42)' },
  { value: 43, label: 'Channel Hide Message (43)' },
  { value: 44, label: 'Channel Mute User (44)' },
  { value: 1063, label: 'File Metadata (1063)' },
  { value: 1068, label: 'Poll (1068)' },
  { value: 1311, label: 'Live Chat Message (1311)' },
  { value: 1984, label: 'Reporting (1984)' },
  { value: 9734, label: 'Zap Request (9734)' },
  { value: 9735, label: 'Zap (9735)' },
  { value: 10000, label: 'Mute List (10000)' },
  { value: 10001, label: 'Pin List (10001)' },
  { value: 10002, label: 'Relay List Metadata (10002)' },
  { value: 30000, label: 'Categorized People List (30000)' },
  { value: 30001, label: 'Categorized Bookmark List (30001)' },
  { value: 30023, label: 'Long-form Content (30023)' },
  { value: 30024, label: 'Draft Long-form Content (30024)' },
  { value: 30078, label: 'Application-specific Data (30078)' },
  { value: 32100, label: 'M3U Playlist (32100)' },
  { value: 34235, label: 'Addressable Video (34235)' },
  { value: 34236, label: 'Addressable Short Video (34236)' },
];

@Component({
  selector: 'app-new-column-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatChipsModule,
    MatAutocompleteModule,
    MatCardModule,
    MatDividerModule,
    ReactiveFormsModule,
    MatButtonToggleModule,
  ],
  templateUrl: './new-column-dialog.component.html',
  styleUrls: ['./new-column-dialog.component.scss'],
})
export class NewColumnDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<NewColumnDialogComponent>);
  private feedService = inject(FeedService);
  private accountState = inject(AccountStateService);
  private followset = inject(Followset);
  private dataService = inject(DataService);
  private encryption = inject(EncryptionService);
  private logger = inject(LoggerService);
  readonly data: DialogData = inject(MAT_DIALOG_DATA);

  // Form controls
  columnForm = this.fb.group({
    kinds: [this.data.column?.kinds || []],
    source: [this.data.column?.source || 'following'],
    relayConfig: [this.data.column?.relayConfig || 'account'],
    customRelays: [this.data.column?.customRelays || []],
    type: [this.data.column?.type || 'custom'],
  });

  // Signals and state
  isEditMode = signal(!!this.data.column);
  selectedColumnType = signal<string>(this.data.column?.type || 'custom');
  selectedKinds = signal<number[]>(this.data.column?.kinds || []);
  customRelays = signal<string[]>(this.data.column?.customRelays || []);
  selectedRelayConfig = signal<string>(this.data.column?.relayConfig || 'account');
  showCustomRelays = computed(() => this.selectedRelayConfig() === 'custom');

  // Custom source signals
  selectedUsers = signal<NostrRecord[]>([]);
  selectedStarterPacks = signal<StarterPack[]>([]);
  availableStarterPacks = signal<StarterPack[]>([]);
  selectedFollowSets = signal<FollowSet[]>([]);
  availableFollowSets = signal<FollowSet[]>([]);

  // Form controls for chips and autocomplete
  kindInputControl = new FormControl('');
  relayInputControl = new FormControl('');
  userInputControl = new FormControl('');
  starterPackInputControl = new FormControl('');
  followSetInputControl = new FormControl('');

  // Reactive signals for input values
  kindInputValue = signal('');
  userInputValue = signal('');
  starterPackInputValue = signal('');
  followSetInputValue = signal('');

  // Chip separator keys
  readonly separatorKeysCodes = [ENTER, COMMA] as const;

  // Available options
  columnTypes = signal(this.feedService.getFeedTypes());
  nostrKinds = signal(NOSTR_KINDS);

  // Get following users from account state using cached profiles
  // This uses the same cache as the global search for efficiency
  followingUsers = computed(() => {
    const followingPubkeys = this.accountState.followingList();
    if (!followingPubkeys || followingPubkeys.length === 0) return [];

    const profiles: NostrRecord[] = [];
    for (const pubkey of followingPubkeys) {
      const cacheKey = `metadata-${pubkey}`;
      const profile = this.accountState['cache'].get<NostrRecord>(cacheKey);
      if (profile) {
        profiles.push(profile);
      }
    }
    return profiles;
  });

  // Filtered options for autocomplete
  filteredKinds = computed(() => {
    const input = this.kindInputValue().toLowerCase();
    const selected = this.selectedKinds();

    return this.nostrKinds().filter(kind => {
      const matchesInput =
        kind.label.toLowerCase().includes(input) || kind.value.toString().includes(input);
      const notSelected = !selected.includes(kind.value);
      return matchesInput && notSelected;
    });
  });

  // Filtered users for autocomplete using the same search as global search
  filteredUsers = computed(() => {
    const input = this.userInputValue();
    if (!input || input.length < 1) {
      // Return all following users if no search input
      return this.followingUsers().filter(profile => {
        return !this.selectedUsers().some(selected => selected.event.pubkey === profile.event.pubkey);
      });
    }

    // Use accountState.searchProfiles for consistent search behavior
    const searchResults = this.accountState.searchProfiles(input);
    const selected = this.selectedUsers();

    return searchResults.filter(profile => {
      return !selected.some(s => s.event.pubkey === profile.event.pubkey);
    });
  });

  // Filtered starter packs for autocomplete
  filteredStarterPacks = computed(() => {
    const input = this.starterPackInputValue().toLowerCase();
    const available = this.availableStarterPacks();
    const selected = this.selectedStarterPacks();

    return available.filter(pack => {
      const matchesInput = pack.title.toLowerCase().includes(input) ||
        pack.description?.toLowerCase().includes(input);
      const notSelected = !selected.some(s => s.id === pack.id);
      return matchesInput && notSelected;
    });
  });

  // Filtered follow sets for autocomplete
  filteredFollowSets = computed(() => {
    const input = this.followSetInputValue().toLowerCase();
    const available = this.availableFollowSets();
    const selected = this.selectedFollowSets();

    return available.filter(set => {
      const matchesInput = set.title.toLowerCase().includes(input) ||
        set.description?.toLowerCase().includes(input);
      const notSelected = !selected.some(s => s.id === set.id);
      return matchesInput && notSelected;
    });
  });

  constructor() {
    // Set up reactive input value tracking
    this.kindInputControl.valueChanges.subscribe(value => {
      this.kindInputValue.set(value || '');
    });

    this.userInputControl.valueChanges.subscribe(value => {
      this.userInputValue.set(value || '');
    });

    this.starterPackInputControl.valueChanges.subscribe(value => {
      this.starterPackInputValue.set(value || '');
    });

    this.followSetInputControl.valueChanges.subscribe(value => {
      this.followSetInputValue.set(value || '');
    });

    // Load starter packs and follow sets when component initializes
    // Wait for both to complete before initializing selected items
    this.initializeData();
  }

  private async initializeData(): Promise<void> {
    // Load data in parallel
    await Promise.all([
      this.loadStarterPacks(),
      this.loadFollowSets()
    ]);

    // Initialize selected items if editing existing column
    // This must happen AFTER the data is loaded
    if (this.data.column) {
      this.initializeSelectedItems();
    }
  }

  selectColumnType(typeKey: string): void {
    this.selectedColumnType.set(typeKey);
    this.columnForm.patchValue({
      type: typeKey as 'photos' | 'videos' | 'notes' | 'articles' | 'music' | 'custom',
    });

    // Auto-fill based on column type
    const validTypes = ['notes', 'articles', 'photos', 'videos', 'music', 'custom'] as const;
    if (validTypes.includes(typeKey as (typeof validTypes)[number])) {
      const columnType = this.feedService.getFeedType(typeKey as (typeof validTypes)[number]);
      if (columnType && columnType.kinds.length > 0) {
        this.selectedKinds.set(columnType.kinds);
        this.columnForm.patchValue({ kinds: columnType.kinds });
      }
    }
  }

  getKindLabel(kind: number): string {
    const kindInfo = this.nostrKinds().find(k => k.value === kind);
    return kindInfo ? kindInfo.label : `Kind ${kind}`;
  }

  addKind(event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (value) {
      const kindNumber = parseInt(value, 10);
      if (!isNaN(kindNumber) && !this.selectedKinds().includes(kindNumber)) {
        this.selectedKinds.update(kinds => [...kinds, kindNumber]);
        this.updateKindsForm();
      }
    }
    event.chipInput!.clear();
    this.kindInputControl.setValue('');
  }

  removeKind(kind: number): void {
    this.selectedKinds.update(kinds => kinds.filter(k => k !== kind));
    this.updateKindsForm();
  }

  kindSelected(event: MatAutocompleteSelectedEvent): void {
    const kindValue = event.option.value;
    if (!this.selectedKinds().includes(kindValue)) {
      this.selectedKinds.update(kinds => [...kinds, kindValue]);
      this.updateKindsForm();
    }
    this.kindInputControl.setValue('');
  }

  private updateKindsForm(): void {
    this.columnForm.patchValue({ kinds: this.selectedKinds() });
  }

  onRelayConfigChange(value: string): void {
    this.selectedRelayConfig.set(value);
    if (value !== 'custom') {
      this.customRelays.set([]);
      this.columnForm.patchValue({ customRelays: [] });
    }
  }

  addCustomRelay(event: MatChipInputEvent): void {
    let value = event.value.trim();
    if (value) {
      // Automatically add wss:// prefix if not present
      if (!value.startsWith('wss://') && !value.startsWith('ws://')) {
        value = 'wss://' + value;
      }

      if (this.isValidRelayUrl(value)) {
        if (!this.customRelays().includes(value)) {
          this.customRelays.update(relays => [...relays, value]);
          this.updateCustomRelaysForm();
        }
      }
    }
    event.chipInput!.clear();
    this.relayInputControl.setValue('');
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relay));
    this.updateCustomRelaysForm();
  }

  private updateCustomRelaysForm(): void {
    this.columnForm.patchValue({ customRelays: this.customRelays() });
  }

  private isValidRelayUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'wss:' || urlObj.protocol === 'ws:';
    } catch {
      return false;
    }
  }

  getActiveRelays(): string[] {
    const relayConfig = this.selectedRelayConfig();

    switch (relayConfig) {
      case 'account':
        return this.feedService.userRelays().map(r => r.url);
      case 'custom':
        return this.customRelays();
      default:
        return [];
    }
  }

  onSubmit(): void {
    if (this.columnForm.valid) {
      const formValue = this.columnForm.value;

      // Build filters object (empty for now, PoW filtering removed)
      const filters: Record<string, unknown> = {};

      // Create column config
      const columnConfig: ColumnConfig = {
        id: this.data.column?.id || crypto.randomUUID(),
        label: '',
        icon: this.data.column?.icon || 'chat', // Default icon (not displayed in UI)
        type: formValue.type as 'photos' | 'videos' | 'notes' | 'articles' | 'music' | 'custom',
        source: formValue.source || 'public',
        kinds: this.selectedKinds(),
        relayConfig: formValue.relayConfig as 'account' | 'custom',
        customRelays: formValue.relayConfig === 'custom' ? this.customRelays() : undefined,
        customUsers: formValue.source === 'custom' ? this.selectedUsers().map(u => u.event.pubkey) : undefined,
        customStarterPacks: formValue.source === 'custom' ? this.selectedStarterPacks().map(p => p.dTag) : undefined,
        customFollowSets: formValue.source === 'custom' ? this.selectedFollowSets().map(s => s.dTag) : undefined,
        filters: Object.keys(filters).length > 0 ? filters : {},
        createdAt: this.data.column?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      this.dialogRef.close(columnConfig);
    }
  }

  // Custom source methods
  async loadStarterPacks(): Promise<void> {
    try {
      const starterPacks = await this.followset.fetchStarterPacks();
      this.availableStarterPacks.set(starterPacks);
    } catch (error) {
      console.error('Failed to load starter packs:', error);
    }
  }

  async loadFollowSets(): Promise<void> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.warn('No pubkey available for loading follow sets');
        return;
      }

      // Fetch kind 30000 events (Follow Sets)
      const records = await this.dataService.getEventsByPubkeyAndKind(pubkey, 30000, {
        save: true,
        cache: true,
      });

      if (!records || records.length === 0) {
        this.logger.debug('No follow sets found');
        return;
      }

      const followSets: FollowSet[] = [];

      for (const record of records) {
        if (!record.event) continue;

        const event = record.event;

        // Extract metadata
        const dTag = event.tags.find(t => t[0] === 'd')?.[1] || crypto.randomUUID();
        const title = event.tags.find(t => t[0] === 'title')?.[1] || event.tags.find(t => t[0] === 'name')?.[1] || `Follow Set ${dTag}`;
        const description = event.tags.find(t => t[0] === 'description')?.[1];

        // Parse public items (p tags)
        const publicPubkeys = event.tags
          .filter(t => t[0] === 'p' && t[1])
          .map(t => t[1]);

        // Parse private items from encrypted content
        let privatePubkeys: string[] = [];
        if (event.content && event.content.trim() !== '') {
          try {
            // Check if content is encrypted
            const isEncrypted = this.encryption.isContentEncrypted(event.content);
            if (isEncrypted) {
              // Decrypt content - use autoDecrypt which handles both NIP-04 and NIP-44
              const decrypted = await this.encryption.autoDecrypt(event.content, pubkey, event);
              if (decrypted && decrypted.content) {
                // Parse decrypted JSON
                const privateData = JSON.parse(decrypted.content);
                if (Array.isArray(privateData)) {
                  // Extract p tags from private data
                  privatePubkeys = privateData
                    .filter((tag: string[]) => tag[0] === 'p' && tag[1])
                    .map((tag: string[]) => tag[1]);
                }
              }
            }
          } catch (error) {
            this.logger.error('Failed to decrypt follow set content:', error);
          }
        }

        // Combine public and private pubkeys (remove duplicates)
        const allPubkeys = [...new Set([...publicPubkeys, ...privatePubkeys])];

        followSets.push({
          id: event.id,
          dTag,
          title,
          description,
          pubkeys: allPubkeys,
          created: event.created_at,
        });
      }

      // Sort by creation date (newest first)
      followSets.sort((a, b) => b.created - a.created);

      this.availableFollowSets.set(followSets);
      this.logger.debug(`Loaded ${followSets.length} follow sets`);
    } catch (error) {
      this.logger.error('Failed to load follow sets:', error);
    }
  }



  initializeSelectedItems(): void {
    const column = this.data.column;
    if (!column) return;

    this.logger.debug('[NewColumnDialog] Initializing selected items for column:', column.id);

    // Initialize selected users if customUsers exist
    if (column.customUsers && column.customUsers.length > 0) {
      this.logger.debug('[NewColumnDialog] Loading', column.customUsers.length, 'custom users');
      const profiles: NostrRecord[] = [];
      for (const pubkey of column.customUsers) {
        const cacheKey = `metadata-${pubkey}`;
        const profile = this.accountState['cache'].get<NostrRecord>(cacheKey);
        if (profile) {
          profiles.push(profile);
        }
      }
      this.selectedUsers.set(profiles);
      this.logger.debug('[NewColumnDialog] Loaded', profiles.length, 'user profiles');
    }

    // Initialize selected starter packs if customStarterPacks exist
    if (column.customStarterPacks && column.customStarterPacks.length > 0) {
      this.logger.debug('[NewColumnDialog] Loading', column.customStarterPacks.length, 'starter packs from dTags:', column.customStarterPacks);
      this.logger.debug('[NewColumnDialog] Available starter packs:', this.availableStarterPacks().length);
      const packs = this.availableStarterPacks().filter(pack =>
        column.customStarterPacks!.includes(pack.dTag)
      );
      this.selectedStarterPacks.set(packs);
      this.logger.debug('[NewColumnDialog] Loaded', packs.length, 'starter packs');
    }

    // Initialize selected follow sets if customFollowSets exist
    if (column.customFollowSets && column.customFollowSets.length > 0) {
      this.logger.debug('[NewColumnDialog] Loading', column.customFollowSets.length, 'follow sets from dTags:', column.customFollowSets);
      this.logger.debug('[NewColumnDialog] Available follow sets:', this.availableFollowSets().length, this.availableFollowSets().map(s => ({ dTag: s.dTag, title: s.title })));
      const sets = this.availableFollowSets().filter(set =>
        column.customFollowSets!.includes(set.dTag)
      );
      this.selectedFollowSets.set(sets);
      this.logger.debug('[NewColumnDialog] Loaded', sets.length, 'follow sets:', sets.map(s => ({ dTag: s.dTag, title: s.title, pubkeys: s.pubkeys.length })));
    }
  }

  onUserSelected(event: MatAutocompleteSelectedEvent): void {
    const pubkey = event.option.value;
    const profile = this.followingUsers().find(p => p.event.pubkey === pubkey);

    if (profile && !this.selectedUsers().some(u => u.event.pubkey === pubkey)) {
      this.selectedUsers.update(users => [...users, profile]);
    }

    // Clear the input
    this.userInputControl.setValue('');
    this.userInputValue.set('');
  }

  removeUser(user: NostrRecord): void {
    this.selectedUsers.update(users => users.filter(u => u.event.pubkey !== user.event.pubkey));
  }

  onStarterPackSelected(event: MatAutocompleteSelectedEvent): void {
    const packId = event.option.value;
    const pack = this.availableStarterPacks().find(p => p.id === packId);

    if (pack && !this.selectedStarterPacks().some(p => p.id === packId)) {
      this.selectedStarterPacks.update(packs => [...packs, pack]);
    }

    // Clear the input
    this.starterPackInputControl.setValue('');
    this.starterPackInputValue.set('');
  }

  removeStarterPack(pack: StarterPack): void {
    this.selectedStarterPacks.update(packs => packs.filter(p => p.id !== pack.id));
  }

  onFollowSetSelected(event: MatAutocompleteSelectedEvent): void {
    const setId = event.option.value;
    const followSet = this.availableFollowSets().find(s => s.id === setId);

    if (followSet && !this.selectedFollowSets().some(s => s.id === setId)) {
      this.selectedFollowSets.update(sets => [...sets, followSet]);
    }

    // Clear the input
    this.followSetInputControl.setValue('');
    this.followSetInputValue.set('');
  }

  removeFollowSet(followSet: FollowSet): void {
    this.selectedFollowSets.update(sets => sets.filter(s => s.id !== followSet.id));
  }
}
