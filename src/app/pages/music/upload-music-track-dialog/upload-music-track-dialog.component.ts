import { Component, inject, signal, computed, output } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Event } from 'nostr-tools';
import { MediaService } from '../../../services/media.service';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { RelaysService } from '../../../services/relays/relays';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { MusicTermsDialogComponent } from '../music-terms-dialog/music-terms-dialog.component';

const MUSIC_KIND = 36787;

interface ZapSplit {
  pubkey: string;
  name: string;
  avatar: string | null;
  percentage: number;
  isUploader: boolean;
}

@Component({
  selector: 'app-upload-music-track-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatSnackBarModule,
    ReactiveFormsModule,
    MusicTermsDialogComponent,
  ],
  templateUrl: './upload-music-track-dialog.component.html',
  styleUrl: './upload-music-track-dialog.component.scss',
})
export class UploadMusicTrackDialogComponent {
  closed = output<{ published: boolean; event?: Event } | null>();

  private fb = inject(FormBuilder);
  private mediaService = inject(MediaService);
  private accountState = inject(AccountStateService);
  private nostrService = inject(NostrService);
  private relaysService = inject(RelaysService);
  private pool = inject(RelayPoolService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  // Media server availability
  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);

  trackForm: FormGroup;
  isPublishing = signal(false);
  isUploadingAudio = signal(false);
  isUploadingImage = signal(false);
  isDraggingAudio = signal(false);
  isDraggingImage = signal(false);
  audioFile = signal<File | null>(null);
  audioUrl = signal<string | null>(null);
  coverImage = signal<string | null>(null);
  agreedToTerms = signal(false);
  showTermsDialog = signal(false);

  // Zap splits
  zapSplits = signal<ZapSplit[]>([]);
  currentUserProfile = signal<{ name: string; avatar: string | null }>({ name: '', avatar: null });

  // Available genres for music
  availableGenres = [
    'Electronic', 'Rock', 'Pop', 'Hip Hop', 'R&B', 'Jazz', 'Classical',
    'Country', 'Folk', 'Metal', 'Punk', 'Alternative', 'Indie',
    'Dance', 'House', 'Techno', 'Ambient', 'Experimental', 'Soul',
    'Reggae', 'Blues', 'Latin', 'World', 'Soundtrack', 'Lo-Fi',
    'Trap', 'Dubstep', 'Drum & Bass', 'Synthwave', 'Other'
  ];

  // Random gradients for default cover
  private gradients = [
    '#e040fb, #7c4dff',
    '#ff6b6b, #feca57',
    '#00d2d3, #54a0ff',
    '#5f27cd, #00d2d3',
    '#ff9ff3, #feca57',
    '#1dd1a1, #00d2d3',
    '#ff6b6b, #ee5a24',
    '#c8d6e5, #576574',
  ];

  currentGradient = signal(this.getRandomGradient());

  totalSplitPercentage = computed(() => {
    return this.zapSplits().reduce((sum, split) => sum + split.percentage, 0);
  });

  constructor() {
    this.trackForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(1)]],
      genres: [[]],
      artistNpub: [''],
      artistName: [''],
      aiGenerated: [false],
      // Advanced settings
      album: [''],
      trackNumber: [''],
      releaseDate: [''],
      language: ['en'],
      explicitContent: [false],
      lyrics: [''],
      credits: [''],
      imageUrl: [''],
    });

    // Initialize with current user as uploader
    this.loadCurrentUserProfile();

    // Auto-fill artist name when npub is entered
    this.trackForm.get('artistNpub')?.valueChanges.subscribe(async (npub: string) => {
      if (npub && npub.startsWith('npub')) {
        await this.autoFillArtistName(npub);
      }
    });
  }

  private async autoFillArtistName(npub: string): Promise<void> {
    try {
      const { nip19 } = await import('nostr-tools');
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') return;

      const pubkey = decoded.data;
      const profile = await this.dataService.getProfile(pubkey);
      if (profile?.data) {
        const name = profile.data.name || profile.data.display_name;
        if (name && !this.trackForm.get('artistName')?.value) {
          this.trackForm.patchValue({ artistName: name });
        }
      }
    } catch {
      // Invalid npub, ignore
    }
  }

  private async loadCurrentUserProfile(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const profile = await this.dataService.getProfile(pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || 'You';
      const avatar = profile?.data?.picture || null;
      this.currentUserProfile.set({ name, avatar });

      // Initialize zap splits with uploader getting 100%
      this.zapSplits.set([{
        pubkey,
        name,
        avatar,
        percentage: 100,
        isUploader: true,
      }]);
    }
  }

  private getRandomGradient(): string {
    return this.gradients[Math.floor(Math.random() * this.gradients.length)];
  }

  randomizeGradient(): void {
    this.currentGradient.set(this.getRandomGradient());
    this.coverImage.set(null);
    this.trackForm.patchValue({ imageUrl: '' });
  }

  async selectAudioFile(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        await this.handleAudioFile(file);
      }
    };

    input.click();
  }

  onAudioDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingAudio.set(true);
  }

  onAudioDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingAudio.set(false);
  }

  async onAudioDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingAudio.set(false);

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('audio/')) {
      this.snackBar.open('Please drop an audio file', 'Close', { duration: 3000 });
      return;
    }

    await this.handleAudioFile(file);
  }

  private async handleAudioFile(file: File): Promise<void> {
    this.audioFile.set(file);

    // Auto-fill title from filename if empty
    const currentTitle = this.trackForm.get('title')?.value;
    if (!currentTitle) {
      // Remove file extension and clean up the filename
      const fileName = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
      // Replace underscores and hyphens with spaces, then trim
      const cleanTitle = fileName.replace(/[_-]/g, ' ').trim();
      this.trackForm.patchValue({ title: cleanTitle });
    }

    // Upload the audio file
    this.isUploadingAudio.set(true);
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
          this.audioUrl.set(url);
          this.snackBar.open('Audio uploaded successfully', 'Close', { duration: 2000 });
        }
      } else {
        this.snackBar.open('Failed to upload audio', 'Close', { duration: 3000 });
        this.audioFile.set(null);
      }
    } catch (error) {
      console.error('Error uploading audio:', error);
      this.snackBar.open('Error uploading audio', 'Close', { duration: 3000 });
      this.audioFile.set(null);
    } finally {
      this.isUploadingAudio.set(false);
    }
  }

  async uploadImage(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        await this.handleImageFile(file);
      }
    };

    input.click();
  }

  onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingImage.set(true);
  }

  onImageDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingImage.set(false);
  }

  async onImageDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
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
    this.isUploadingImage.set(true);
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
          this.trackForm.patchValue({ imageUrl: url });
        }
      } else {
        this.snackBar.open('Failed to upload image', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      this.snackBar.open('Error uploading image', 'Close', { duration: 3000 });
    } finally {
      this.isUploadingImage.set(false);
    }
  }

  onImageUrlChange(): void {
    const url = this.trackForm.get('imageUrl')?.value;
    if (url) {
      this.coverImage.set(url);
    }
  }

  async addZapSplit(): Promise<void> {
    // Prompt for npub
    const npub = prompt('Enter the npub of the collaborator:');
    if (!npub || !npub.startsWith('npub')) {
      this.snackBar.open('Invalid npub', 'Close', { duration: 3000 });
      return;
    }

    try {
      const { nip19 } = await import('nostr-tools');
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') {
        this.snackBar.open('Invalid npub', 'Close', { duration: 3000 });
        return;
      }

      const pubkey = decoded.data;

      // Check if already added
      if (this.zapSplits().some(s => s.pubkey === pubkey)) {
        this.snackBar.open('Collaborator already added', 'Close', { duration: 3000 });
        return;
      }

      // Load profile
      const profile = await this.dataService.getProfile(pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || npub.slice(0, 12) + '...';
      const avatar = profile?.data?.picture || null;

      // Add with 0% initially
      this.zapSplits.update(splits => [...splits, {
        pubkey,
        name,
        avatar,
        percentage: 0,
        isUploader: false,
      }]);

      this.snackBar.open('Collaborator added', 'Close', { duration: 2000 });
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
    const split = this.zapSplits()[index];
    if (split.isUploader) {
      this.snackBar.open('Cannot remove uploader', 'Close', { duration: 3000 });
      return;
    }
    this.zapSplits.update(splits => splits.filter((_, i) => i !== index));
  }

  async publishTrack(): Promise<void> {
    if (!this.trackForm.valid || !this.audioUrl() || !this.agreedToTerms()) {
      return;
    }

    // Validate split percentages
    if (this.totalSplitPercentage() !== 100) {
      this.snackBar.open('Zap splits must total 100%', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);

    try {
      const formValue = this.trackForm.value;
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.snackBar.open('Not authenticated', 'Close', { duration: 3000 });
        return;
      }

      // Generate unique identifier
      const dTag = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Build tags
      const tags: string[][] = [
        ['d', dTag],
        ['title', formValue.title],
        ['url', this.audioUrl()!],
        ['t', 'music'], // Required per spec
        ['client', 'nostria'],
      ];

      // Add image or gradient
      if (this.coverImage()) {
        tags.push(['image', this.coverImage()!]);
      } else {
        tags.push(['gradient', 'colors', this.currentGradient()]);
      }

      // Add genres
      if (formValue.genres && formValue.genres.length > 0) {
        for (const genre of formValue.genres) {
          tags.push(['t', genre.toLowerCase()]);
        }
      }

      // Add artist info
      if (formValue.artistNpub) {
        try {
          const artistPubkey = this.utilities.getPubkeyFromNpub(formValue.artistNpub);
          if (artistPubkey && artistPubkey.length === 64) {
            tags.push(['p', artistPubkey]);
          }
        } catch {
          // Invalid npub, skip
        }
      }

      if (formValue.artistName) {
        tags.push(['artist', formValue.artistName]);
      }

      // Add AI generated flag
      if (formValue.aiGenerated) {
        tags.push(['ai', 'true']);
      }

      // Advanced settings
      if (formValue.album) {
        tags.push(['album', formValue.album]);
      }

      if (formValue.trackNumber) {
        tags.push(['track_number', formValue.trackNumber]);
      }

      if (formValue.releaseDate) {
        tags.push(['released', formValue.releaseDate]);
      }

      if (formValue.language) {
        tags.push(['language', formValue.language]);
      }

      if (formValue.explicitContent) {
        tags.push(['explicit', 'true']);
      }

      if (formValue.lyrics) {
        tags.push(['lyrics', formValue.lyrics]);
      }

      // Add zap splits
      const splits = this.zapSplits();
      if (splits.length > 0) {
        for (const split of splits) {
          if (split.percentage > 0) {
            tags.push(['zap', split.pubkey, 'wss://relay.damus.io', String(split.percentage)]);
          }
        }
      }

      // Add alt tag for accessibility
      const artistDisplay = formValue.artistName || 'Unknown Artist';
      tags.push(['alt', `Music track: ${formValue.title} by ${artistDisplay}`]);

      // Build content (credits go here)
      let content = '';
      if (formValue.credits) {
        content = `Credits:\n${formValue.credits}`;
      }

      // Create and sign the event
      const eventTemplate = {
        kind: MUSIC_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      };

      const signedEvent = await this.nostrService.signEvent(eventTemplate);
      if (!signedEvent) {
        this.snackBar.open('Failed to sign event', 'Close', { duration: 3000 });
        return;
      }

      // Publish to relays
      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      if (relayUrls.length === 0) {
        this.snackBar.open('No relays available', 'Close', { duration: 3000 });
        return;
      }

      let published = false;
      try {
        await this.pool.publish(relayUrls, signedEvent);
        published = true;
      } catch (error) {
        console.warn('Failed to publish:', error);
      }

      if (published) {
        this.snackBar.open('Track published successfully!', 'Close', { duration: 3000 });
        this.closed.emit({ published: true, event: signedEvent });
      } else {
        this.snackBar.open('Failed to publish track', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Error publishing track:', error);
      this.snackBar.open('Error publishing track', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }

  cancel(): void {
    this.closed.emit(null);
  }

  // Navigate to media settings - specifically to the Media Servers tab
  navigateToMediaSettings(): void {
    this.cancel();
    this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }
}
