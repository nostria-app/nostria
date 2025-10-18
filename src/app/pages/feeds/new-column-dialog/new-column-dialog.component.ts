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
import { DataService } from '../../../services/data.service';

interface DialogData {
  icons: string[];
  column?: ColumnConfig;
}

interface UserProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  about?: string;
  npub: string;
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
  readonly data: DialogData = inject(MAT_DIALOG_DATA);

  // Form controls
  columnForm = this.fb.group({
    icon: [this.data.column?.icon || 'chat'],
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
  selectedUsers = signal<UserProfile[]>([]);
  selectedStarterPacks = signal<StarterPack[]>([]);
  availableStarterPacks = signal<StarterPack[]>([]);
  userProfiles = signal<Map<string, UserProfile>>(new Map()); // Cache for user profiles

  // Form controls for chips and autocomplete
  kindInputControl = new FormControl('');
  relayInputControl = new FormControl('');
  userInputControl = new FormControl('');
  starterPackInputControl = new FormControl('');

  // Reactive signals for input values
  kindInputValue = signal('');
  userInputValue = signal('');
  starterPackInputValue = signal('');

  // Chip separator keys
  readonly separatorKeysCodes = [ENTER, COMMA] as const;

  // Available options
  columnTypes = signal(this.feedService.getFeedTypes());
  nostrKinds = signal(NOSTR_KINDS);

  // Get following users from account state with real profile data
  followingUsers = computed(() => {
    const followingPubkeys = this.accountState.followingList();
    const profilesCache = this.userProfiles();

    if (!followingPubkeys || followingPubkeys.length === 0) return [];

    return followingPubkeys.map(pubkey => {
      const cachedProfile = profilesCache.get(pubkey);
      if (cachedProfile) {
        return cachedProfile;
      }

      // Return placeholder while profile is loading
      return {
        pubkey,
        name: `User ${pubkey.slice(0, 8)}...`, // Temporary placeholder
        npub: pubkey, // TODO: Convert to npub format if needed
        display_name: undefined,
        about: undefined
      };
    }).filter(user => user); // Filter out any null/undefined results
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

  // Filtered users for autocomplete
  filteredUsers = computed(() => {
    const input = this.userInputValue().toLowerCase();
    const following = this.followingUsers();
    const selected = this.selectedUsers();

    return following.filter(user => {
      const matchesInput = user.name?.toLowerCase().includes(input) || user.pubkey.includes(input);
      const notSelected = !selected.some(s => s.pubkey === user.pubkey);
      return matchesInput && notSelected;
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

    // Load starter packs when component initializes
    this.loadStarterPacks();

    // Load user profiles for following list
    this.loadUserProfiles();

    // Initialize selected items if editing existing column
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

      // Update icon if not in edit mode
      if (!this.isEditMode()) {
        this.columnForm.patchValue({
          icon: columnType.icon,
        });
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
      // Create column config
      const columnConfig: ColumnConfig = {
        id: this.data.column?.id || crypto.randomUUID(),
        label: '',
        icon: formValue.icon!,
        type: formValue.type as 'photos' | 'videos' | 'notes' | 'articles' | 'music' | 'custom',
        source: formValue.source || 'public',
        kinds: this.selectedKinds(),
        relayConfig: formValue.relayConfig as 'account' | 'custom',
        customRelays: formValue.relayConfig === 'custom' ? this.customRelays() : undefined,
        customUsers: formValue.source === 'custom' ? this.selectedUsers().map(u => u.pubkey) : undefined,
        customStarterPacks: formValue.source === 'custom' ? this.selectedStarterPacks().map(p => p.dTag) : undefined,
        filters: {},
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

  async loadUserProfiles(): Promise<void> {
    try {
      const followingPubkeys = this.accountState.followingList();
      if (!followingPubkeys || followingPubkeys.length === 0) {
        return;
      }

      // Load profiles in batches to avoid overwhelming the service
      const batchSize = 20;
      const profileMap = new Map<string, UserProfile>();

      for (let i = 0; i < followingPubkeys.length; i += batchSize) {
        const batch = followingPubkeys.slice(i, i + batchSize);

        try {
          const profiles = await this.dataService.getProfiles(batch);

          if (profiles) {
            profiles.forEach(record => {
              if (record.event && record.data) {
                const profileData = record.data as { name?: string; display_name?: string; about?: string; picture?: string };
                const userProfile: UserProfile = {
                  pubkey: record.event.pubkey,
                  name: profileData.name || profileData.display_name,
                  display_name: profileData.display_name,
                  about: profileData.about,
                  npub: record.event.pubkey // TODO: Convert to npub format if needed
                };
                profileMap.set(record.event.pubkey, userProfile);
              }
            });
          }
        } catch (error) {
          console.error(`Error loading profiles for batch ${i}-${i + batchSize}:`, error);
          // Continue with next batch even if this one fails
        }
      }

      // Update the signal with all loaded profiles
      this.userProfiles.set(profileMap);
      console.log(`Loaded ${profileMap.size} user profiles from ${followingPubkeys.length} following`);

    } catch (error) {
      console.error('Failed to load user profiles:', error);
    }
  }

  initializeSelectedItems(): void {
    const column = this.data.column;
    if (!column) return;

    // Initialize selected users if customUsers exist
    if (column.customUsers) {
      const users = column.customUsers.map(pubkey => ({
        pubkey,
        name: `User ${pubkey.slice(0, 8)}...`,
        npub: pubkey
      }));
      this.selectedUsers.set(users);
    }

    // Initialize selected starter packs if customStarterPacks exist
    if (column.customStarterPacks) {
      const packs = this.availableStarterPacks().filter(pack =>
        column.customStarterPacks?.includes(pack.dTag)
      );
      this.selectedStarterPacks.set(packs);
    }
  }

  onUserSelected(event: MatAutocompleteSelectedEvent): void {
    const pubkey = event.option.value;
    const user = this.followingUsers().find(u => u.pubkey === pubkey);

    if (user && !this.selectedUsers().some(u => u.pubkey === pubkey)) {
      this.selectedUsers.update(users => [...users, user]);
    }

    // Clear the input
    this.userInputControl.setValue('');
    this.userInputValue.set('');
  }

  removeUser(user: UserProfile): void {
    this.selectedUsers.update(users => users.filter(u => u.pubkey !== user.pubkey));
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
}
