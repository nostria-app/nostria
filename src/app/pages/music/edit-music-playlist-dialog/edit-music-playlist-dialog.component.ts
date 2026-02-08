import { Component, inject, signal, computed, input, output, effect, untracked, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Event, Filter, nip19 } from 'nostr-tools';
import { MusicPlaylistService, MusicPlaylist } from '../../../services/music-playlist.service';
import { MediaService } from '../../../services/media.service';
import { DataService } from '../../../services/data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { MentionAutocompleteComponent, MentionAutocompleteConfig, MentionSelection } from '../../../components/mention-autocomplete/mention-autocomplete.component';
import { MentionInputService } from '../../../services/mention-input.service';
import { NostrRecord } from '../../../interfaces';
import { RelayPublishSelectorComponent, RelayPublishConfig } from '../../../components/relay-publish-selector/relay-publish-selector.component';
import { LoggerService } from '../../../services/logger.service';

const MUSIC_KIND = 36787;

export interface EditMusicPlaylistDialogData {
  playlist: MusicPlaylist;
}

export interface TrackItem {
  ref: string;
  pubkey: string;
  dTag: string;
  title: string;
  artist: string;
  image?: string;
  loading: boolean;
  event?: Event;
}

interface ZapSplit {
  pubkey: string;
  name: string;
  avatar: string | null;
  percentage: number;
  isUploader: boolean;
}

@Component({
  selector: 'app-edit-music-playlist-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    DragDropModule,
    ReactiveFormsModule,
    MentionAutocompleteComponent,
    RelayPublishSelectorComponent,
  ],
  templateUrl: './edit-music-playlist-dialog.component.html',
  styleUrl: './edit-music-playlist-dialog.component.scss',
})
export class EditMusicPlaylistDialogComponent {
  data = input.required<EditMusicPlaylistDialogData>();
  closed = output<{ updated: boolean; playlist?: MusicPlaylist } | null>();
  private fb = inject(FormBuilder);
  private musicPlaylistService = inject(MusicPlaylistService);
  private mediaService = inject(MediaService);
  private dataService = inject(DataService);
  private accountState = inject(AccountStateService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private mentionInputService = inject(MentionInputService);
  private readonly logger = inject(LoggerService);
  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);

  playlistForm: FormGroup;
  isSaving = signal(false);
  isUploading = signal(false);
  isDraggingImage = signal(false);
  private dragEnterCounter = 0;
  coverImage = signal<string | null>(null);
  previousCoverImage = signal<string | null>(null); // Track original image for cleanup
  tracks = signal<TrackItem[]>([]);
  loadingTracks = signal(true);

  // Zap splits
  zapSplits = signal<ZapSplit[]>([]);
  currentUserProfile = signal<{ name: string; avatar: string | null }>({ name: '', avatar: null });
  isAddingSplit = signal(false);
  newSplitInput = signal('');
  mentionConfig = signal<MentionAutocompleteConfig | null>(null);
  mentionPosition = signal({ top: 0, left: 0 });

  // Computed total split percentage
  totalSplitPercentage = computed(() => {
    const splits = this.zapSplits();
    return splits.reduce((sum, split) => sum + split.percentage, 0);
  });

  // Relay publishing configuration
  relayPublishConfig = signal<RelayPublishConfig | null>(null);

  private artistProfiles = new Map<string, NostrRecord>();

  // Random gradients for default cover
  private gradients = [
    'linear-gradient(135deg, #e040fb 0%, #7c4dff 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)',
    'linear-gradient(135deg, #00d2d3 0%, #54a0ff 100%)',
    'linear-gradient(135deg, #5f27cd 0%, #00d2d3 100%)',
    'linear-gradient(135deg, #ff9ff3 0%, #feca57 100%)',
    'linear-gradient(135deg, #1dd1a1 0%, #00d2d3 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)',
    'linear-gradient(135deg, #c8d6e5 0%, #576574 100%)',
  ];

  currentGradient = signal(this.getRandomGradient());
  private initialized = false;

  constructor() {
    this.playlistForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(1)]],
      description: [''],
      imageUrl: [''],
      isPublic: [true],
      isCollaborative: [false],
    });

    // Initialize form when data is available
    effect(() => {
      const dialogData = this.data();
      if (dialogData && !this.initialized) {
        this.initialized = true;
        untracked(() => {
          const playlist = dialogData.playlist;
          this.playlistForm.patchValue({
            title: playlist.title,
            description: playlist.description || '',
            imageUrl: playlist.image || '',
            isPublic: playlist.isPublic,
            isCollaborative: playlist.isCollaborative,
          });

          if (playlist.image) {
            this.coverImage.set(playlist.image);
            this.previousCoverImage.set(playlist.image); // Track original for cleanup
          }

          // Initialize current user profile
          this.initializeCurrentUserProfile();

          // Extract zap splits from playlist event
          this.initializeZapSplitsFromPlaylist(playlist);

          // Load track details
          this.loadTrackDetails();
        });
      }
    });
  }

  private getRandomGradient(): string {
    return this.gradients[Math.floor(Math.random() * this.gradients.length)];
  }

  private async initializeCurrentUserProfile(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      const profile = await this.dataService.getProfile(pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || 'You';
      const avatar = profile?.data?.picture || null;
      this.currentUserProfile.set({ name, avatar });
    } catch (error) {
      this.logger.error('Failed to load current user profile:', error);
    }
  }

  private async initializeZapSplitsFromPlaylist(playlist: MusicPlaylist): Promise<void> {
    if (!playlist.event) {
      // No existing event, initialize with uploader getting 100%
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        const profile = this.currentUserProfile();
        this.zapSplits.set([{
          pubkey,
          name: profile.name,
          avatar: profile.avatar,
          percentage: 100,
          isUploader: true,
        }]);
      }
      return;
    }

    const splits: ZapSplit[] = [];
    const zapTags = playlist.event.tags.filter(t => t[0] === 'zap');

    if (zapTags.length > 0) {
      const rawSplits = zapTags.map(tag => ({
        pubkey: tag[1],
        relay: tag[2] || '',
        percentage: parseInt(tag[3] || '0', 10),
      }));

      const totalPercentage = rawSplits.reduce((sum, s) => sum + s.percentage, 0);
      const isValid = totalPercentage === 100;

      if (isValid) {
        for (const split of rawSplits) {
          const profile = await this.dataService.getProfile(split.pubkey);
          const name = profile?.data?.name || profile?.data?.display_name || nip19.npubEncode(split.pubkey).slice(0, 12) + '...';
          const avatar = profile?.data?.picture || null;
          const isUploader = split.pubkey === playlist.pubkey;

          splits.push({
            pubkey: split.pubkey,
            name,
            avatar,
            percentage: split.percentage,
            isUploader,
          });
        }
      }
    } else {
      // No zap splits, initialize with uploader getting 100%
      const profile = await this.dataService.getProfile(playlist.pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || 'Uploader';
      const avatar = profile?.data?.picture || null;

      splits.push({
        pubkey: playlist.pubkey,
        name,
        avatar,
        percentage: 100,
        isUploader: true,
      });
    }

    this.zapSplits.set(splits);
  }

  private async loadTrackDetails(): Promise<void> {
    const playlist = this.data().playlist;
    if (!playlist.trackRefs || playlist.trackRefs.length === 0) {
      this.loadingTracks.set(false);
      return;
    }

    // Initialize tracks with loading state
    const initialTracks: TrackItem[] = playlist.trackRefs.map(ref => {
      const parts = ref.split(':');
      const pubkey = parts[1] || '';
      const dTag = parts.slice(2).join(':');
      return {
        ref,
        pubkey,
        dTag,
        title: 'Loading...',
        artist: '',
        loading: true,
      };
    });
    this.tracks.set(initialTracks);

    // Fetch track events
    const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
    if (relayUrls.length === 0) {
      this.loadingTracks.set(false);
      return;
    }

    const trackKeys = initialTracks.map(t => ({ author: t.pubkey, dTag: t.dTag }));
    const uniqueAuthors = [...new Set(trackKeys.map(k => k.author))];
    const uniqueDTags = [...new Set(trackKeys.map(k => k.dTag))];

    const filter: Filter = {
      kinds: [MUSIC_KIND],
      authors: uniqueAuthors,
      '#d': uniqueDTags,
      limit: trackKeys.length * 2,
    };

    const trackMap = new Map<string, Event>();

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 5000);

      const sub = this.pool.subscribe(relayUrls, filter, async (event: Event) => {
        const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
        const key = `${event.pubkey}:${dTag}`;
        const existing = trackMap.get(key);
        if (!existing || existing.created_at < event.created_at) {
          trackMap.set(key, event);
        }

        if (trackMap.size >= trackKeys.length) {
          clearTimeout(timeout);
          sub?.close();
          resolve();
        }
      });

      // Shorter timeout for initial load
      setTimeout(() => {
        clearTimeout(timeout);
        sub?.close();
        resolve();
      }, 3000);
    });

    // Update tracks with fetched data
    const updatedTracks = await Promise.all(
      initialTracks.map(async (track) => {
        const key = `${track.pubkey}:${track.dTag}`;
        const event = trackMap.get(key);
        if (event) {
          const titleTag = event.tags.find(t => t[0] === 'title');
          const imageTag = event.tags.find(t => t[0] === 'image');

          // Get artist name
          let artistName = 'Unknown Artist';
          let profile = this.artistProfiles.get(event.pubkey);
          if (!profile) {
            profile = await this.dataService.getProfile(event.pubkey);
            if (profile) {
              this.artistProfiles.set(event.pubkey, profile);
            }
          }
          if (profile) {
            artistName = profile.data?.name || profile.data?.display_name || 'Unknown Artist';
          }

          return {
            ...track,
            title: titleTag?.[1] || 'Untitled Track',
            artist: artistName,
            image: imageTag?.[1],
            loading: false,
            event,
          };
        }
        return {
          ...track,
          title: 'Track not found',
          loading: false,
        };
      })
    );

    this.tracks.set(updatedTracks);
    this.loadingTracks.set(false);
  }

  randomizeGradient(): void {
    this.currentGradient.set(this.getRandomGradient());
    this.coverImage.set(null);
    this.playlistForm.patchValue({ imageUrl: '' });
  }

  async uploadImage(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      this.isUploading.set(true);
      try {
        const servers = this.mediaService.mediaServers();
        if (servers.length === 0) {
          this.logger.error('No media servers available');
          return;
        }
        const result = await this.mediaService.uploadFile(file, false, servers);
        if (result.status === 'success' || result.status === 'duplicate') {
          const url = result.item?.url;
          if (url) {
            this.coverImage.set(url);
            this.playlistForm.patchValue({ imageUrl: url });
          }
        }
      } catch (error) {
        this.logger.error('Failed to upload image:', error);
      } finally {
        this.isUploading.set(false);
      }
    };

    input.click();
  }

  // Drag and drop handlers for cover image
  onImageDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragEnterCounter++;
    this.isDraggingImage.set(true);
  }

  onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onImageDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragEnterCounter--;
    if (this.dragEnterCounter <= 0) {
      this.dragEnterCounter = 0;
      this.isDraggingImage.set(false);
    }
  }

  async onImageDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragEnterCounter = 0;
    this.isDraggingImage.set(false);

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      this.snackBar.open('Please drop an image file', 'Close', { duration: 3000 });
      return;
    }

    await this.handleImageFile(file);
  }

  private async handleImageFile(file: File): Promise<void> {
    const oldImageUrl = this.previousCoverImage();
    this.isUploading.set(true);
    try {
      const servers = this.mediaService.mediaServers();
      if (servers.length === 0) {
        this.snackBar.open('No media servers available', 'Close', { duration: 3000 });
        return;
      }
      const result = await this.mediaService.uploadFile(file, false, servers);
      if (result.status === 'success' || result.status === 'duplicate') {
        const url = result.item?.url;
        if (url) {
          this.coverImage.set(url);
          this.playlistForm.patchValue({ imageUrl: url });
          this.snackBar.open('Cover image uploaded', 'Close', { duration: 2000 });

          // Prompt to delete old image if URL changed
          if (oldImageUrl && oldImageUrl !== url) {
            this.promptDeleteFile('cover image', oldImageUrl);
          }
          // Update previous image reference
          this.previousCoverImage.set(url);
        }
      } else {
        this.snackBar.open('Failed to upload image', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Failed to upload image:', error);
      this.snackBar.open('Error uploading image', 'Close', { duration: 3000 });
    } finally {
      this.isUploading.set(false);
    }
  }

  /**
   * Extract SHA256 hash from a blossom URL
   * URL format: https://server.com/<64-char-hex-hash>.<ext>
   */
  private extractHashFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      // Extract the filename (last segment of path)
      const segments = pathname.split('/');
      const filename = segments[segments.length - 1];
      // Remove extension and get the hash
      const hashPart = filename.split('.')[0];
      // Validate it looks like a SHA256 hash (64 hex characters)
      if (/^[a-fA-F0-9]{64}$/.test(hashPart)) {
        return hashPart;
      }
    } catch {
      // Invalid URL
    }
    return null;
  }

  /**
   * Prompt user to delete old file from blossom server
   */
  private promptDeleteFile(fileType: string, url: string): void {
    const hash = this.extractHashFromUrl(url);
    if (!hash) {
      return; // Can't extract hash, skip deletion
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete old ${fileType}?`,
        message: `You've uploaded a new ${fileType}. Would you like to delete the old one from the server to free up storage space?`,
        confirmText: 'Delete',
        cancelText: 'Keep',
        confirmColor: 'warn'
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        try {
          await this.mediaService.deleteFile(hash);
          this.snackBar.open(`Old ${fileType} deleted`, 'Close', { duration: 2000 });
        } catch (error) {
          this.logger.error(`Failed to delete old ${fileType}:`, error);
          this.snackBar.open(`Failed to delete old ${fileType}`, 'Close', { duration: 3000 });
        }
      }
    });
  }

  onImageUrlChange(): void {
    const url = this.playlistForm.get('imageUrl')?.value;
    if (url && this.isValidUrl(url)) {
      this.coverImage.set(url);
    } else if (!url) {
      this.coverImage.set(null);
    }
  }

  private isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch {
      return false;
    }
  }

  onTrackDrop(event: CdkDragDrop<TrackItem[]>): void {
    const currentTracks = [...this.tracks()];
    moveItemInArray(currentTracks, event.previousIndex, event.currentIndex);
    this.tracks.set(currentTracks);
  }

  removeTrack(index: number): void {
    const currentTracks = [...this.tracks()];
    currentTracks.splice(index, 1);
    this.tracks.set(currentTracks);
  }

  // Zap Split Management Methods

  startAddSplit(): void {
    this.isAddingSplit.set(true);
    this.newSplitInput.set('');
    setTimeout(() => {
      const input = document.querySelector('input[placeholder*="@username"]') as HTMLInputElement;
      input?.focus();
    }, 100);
  }

  cancelAddSplit(): void {
    this.isAddingSplit.set(false);
    this.newSplitInput.set('');
    this.mentionConfig.set(null);
  }

  onSplitInputChange(event: any): void {
    const input = (event.target as HTMLInputElement).value;
    this.newSplitInput.set(input);

    // Check for @ mention
    const detection = this.mentionInputService.detectMention(input, (event.target as HTMLInputElement).selectionStart || input.length);
    if (detection.isTypingMention) {
      // Calculate position for the autocomplete dropdown
      const inputElement = event.target as HTMLInputElement;
      const rect = inputElement.getBoundingClientRect();
      this.mentionPosition.set({
        top: rect.bottom + 4,
        left: rect.left
      });
      this.mentionConfig.set({
        cursorPosition: detection.cursorPosition,
        query: detection.query,
        mentionStart: detection.mentionStart
      });
    } else {
      this.mentionConfig.set(null);
    }
  }

  onSplitInputKeyDown(event: KeyboardEvent): void {
    if (this.mentionConfig()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        if (event.key === 'Escape') {
          this.mentionConfig.set(null);
        }
        return;
      }
    }
  }

  onMentionSelected(selection: MentionSelection): void {
    this.addSplitByPubkey(selection.pubkey, selection.displayName);
    this.mentionConfig.set(null);
  }

  onMentionDismissed(): void {
    this.mentionConfig.set(null);
  }

  private async addSplitByPubkey(pubkey: string, displayName?: string): Promise<void> {
    if (this.zapSplits().some(s => s.pubkey === pubkey)) {
      this.snackBar.open('Collaborator already added', 'Close', { duration: 3000 });
      return;
    }

    const profile = await this.dataService.getProfile(pubkey);
    const name = displayName || profile?.data?.name || profile?.data?.display_name || nip19.npubEncode(pubkey).slice(0, 12) + '...';
    const avatar = profile?.data?.picture || null;

    const currentSplits = this.zapSplits();
    const percentage = currentSplits.length === 0 ? 100 : 0;

    this.zapSplits.update(splits => [...splits, {
      pubkey,
      name,
      avatar,
      percentage,
      isUploader: false,
    }]);

    this.snackBar.open('Collaborator added', 'Close', { duration: 2000 });
    this.cancelAddSplit();
  }

  async confirmAddSplit(): Promise<void> {
    const input = this.newSplitInput().trim();
    if (!input) {
      this.snackBar.open('Please enter an npub or hex pubkey', 'Close', { duration: 3000 });
      return;
    }

    try {
      let pubkey: string;

      if (input.startsWith('npub')) {
        const decoded = nip19.decode(input);
        if (decoded.type !== 'npub') {
          this.snackBar.open('Invalid npub', 'Close', { duration: 3000 });
          return;
        }
        pubkey = decoded.data;
      } else {
        if (!/^[0-9a-fA-F]{64}$/.test(input)) {
          this.snackBar.open('Invalid pubkey format. Use npub or 64-character hex.', 'Close', { duration: 3000 });
          return;
        }
        pubkey = input.toLowerCase();
      }

      if (this.zapSplits().some(s => s.pubkey === pubkey)) {
        this.snackBar.open('Collaborator already added', 'Close', { duration: 3000 });
        return;
      }

      const profile = await this.dataService.getProfile(pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || nip19.npubEncode(pubkey).slice(0, 12) + '...';
      const avatar = profile?.data?.picture || null;

      const currentSplits = this.zapSplits();
      const percentage = currentSplits.length === 0 ? 100 : 0;

      this.zapSplits.update(splits => [...splits, {
        pubkey,
        name,
        avatar,
        percentage,
        isUploader: false,
      }]);

      this.snackBar.open('Collaborator added', 'Close', { duration: 2000 });
      this.cancelAddSplit();
    } catch {
      this.snackBar.open('Failed to add collaborator', 'Close', { duration: 3000 });
    }
  }

  updateSplitPercentage(index: number, percentage: number): void {
    this.zapSplits.update(splits => {
      const updated = [...splits];
      updated[index] = { ...updated[index], percentage: Math.max(0, Math.min(100, percentage)) };
      return updated;
    });
  }

  removeSplit(index: number): void {
    const splits = this.zapSplits();
    const removedPercentage = splits[index].percentage;
    const remainingSplits = splits.filter((_, i) => i !== index);

    if (remainingSplits.length > 0 && removedPercentage > 0) {
      const totalRemaining = remainingSplits.reduce((sum, s) => sum + s.percentage, 0);

      if (totalRemaining === 0) {
        const perSplit = Math.floor(removedPercentage / remainingSplits.length);
        const remainder = removedPercentage - (perSplit * remainingSplits.length);

        this.zapSplits.set(remainingSplits.map((split, i) => ({
          ...split,
          percentage: perSplit + (i === 0 ? remainder : 0)
        })));
      } else {
        this.zapSplits.set(remainingSplits.map(split => {
          const proportion = split.percentage / totalRemaining;
          const addedPercentage = Math.round(removedPercentage * proportion);
          return { ...split, percentage: split.percentage + addedPercentage };
        }));
      }
    } else {
      this.zapSplits.set(remainingSplits);
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.playlistForm.valid || this.isSaving()) return;

    // Validate split percentages
    const splits = this.zapSplits();
    if (splits.length > 0 && this.totalSplitPercentage() !== 100) {
      this.snackBar.open('Zap splits must total 100%', 'Close', { duration: 3000 });
      return;
    }

    this.isSaving.set(true);

    try {
      const formValue = this.playlistForm.value;
      const newTrackRefs = this.tracks().map(t => t.ref);

      // Build custom relay list from config
      let customRelays: string[] | undefined;
      const config = this.relayPublishConfig();
      if (config) {
        const relaySet = new Set<string>();
        for (const relay of config.accountRelays) {
          relaySet.add(relay);
        }
        if (config.includeMusicRelays) {
          for (const relay of config.musicRelays) {
            relaySet.add(relay);
          }
        }
        for (const relay of config.customRelays) {
          relaySet.add(relay);
        }
        customRelays = Array.from(relaySet);
      }

      // Build zap splits
      const zapSplitTags: string[][] = [];
      if (splits.length > 0) {
        for (const split of splits) {
          if (split.percentage > 0) {
            zapSplitTags.push(['zap', split.pubkey, 'wss://relay.damus.io', String(split.percentage)]);
          }
        }
      }

      const result = await this.musicPlaylistService.updatePlaylist(this.data().playlist.id, {
        title: formValue.title,
        description: formValue.description || undefined,
        image: formValue.imageUrl || undefined,
        isPublic: formValue.isPublic,
        isCollaborative: formValue.isCollaborative,
        trackRefs: newTrackRefs,
        zapSplits: zapSplitTags.length > 0 ? zapSplitTags : undefined,
        customRelays: customRelays && customRelays.length > 0 ? customRelays : undefined,
      });

      if (result) {
        this.snackBar.open('Playlist updated!', 'Close', { duration: 2000 });
        this.closed.emit({ updated: true, playlist: result });
      } else {
        this.snackBar.open('Failed to update playlist', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Failed to update playlist:', error);
      this.snackBar.open('Failed to update playlist', 'Close', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  onClose(): void {
    this.closed.emit(null);
  }

  // Navigate to media settings - specifically to the Media Servers tab
  navigateToMediaSettings(): void {
    this.onCancel();
    this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }

  onRelayConfigChanged(config: RelayPublishConfig): void {
    this.relayPublishConfig.set(config);
  }
}
