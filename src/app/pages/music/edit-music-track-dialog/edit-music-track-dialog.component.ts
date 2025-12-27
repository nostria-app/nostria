import { Component, inject, signal, computed, output, input, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
import { MediaService } from '../../../services/media.service';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { RelaysService } from '../../../services/relays/relays';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';

const MUSIC_KIND = 36787;

export interface EditMusicTrackDialogData {
  track: Event;
}

interface ZapSplit {
  pubkey: string;
  name: string;
  avatar: string | null;
  percentage: number;
  isUploader: boolean;
}

@Component({
  selector: 'app-edit-music-track-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    ReactiveFormsModule,
  ],
  templateUrl: './edit-music-track-dialog.component.html',
  styleUrl: './edit-music-track-dialog.component.scss',
})
export class EditMusicTrackDialogComponent {
  data = input.required<EditMusicTrackDialogData>();
  closed = output<{ updated: boolean; event?: Event } | null>();

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
  isSaving = signal(false);
  isUploadingImage = signal(false);
  coverImage = signal<string | null>(null);
  audioUrl = signal<string | null>(null);
  originalDTag = signal<string>('');
  private initialized = false;

  // Zap splits
  zapSplits = signal<ZapSplit[]>([]);

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

  currentGradient = signal(this.gradients[0]);

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
      customTags: [''], // Custom tags as comma-separated values
    });

    // Initialize form with track data when data input changes
    effect(() => {
      const trackData = this.data();
      if (trackData?.track && !this.initialized) {
        this.initialized = true;
        this.initializeFromTrack(trackData.track);
      }
    });

    // Auto-fill artist name when npub is entered
    this.trackForm.get('artistNpub')?.valueChanges.subscribe(async (npub: string) => {
      if (npub && npub.startsWith('npub')) {
        await this.autoFillArtistName(npub);
      }
    });
  }

  private initializeFromTrack(track: Event): void {
    // Extract d tag
    const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
    this.originalDTag.set(dTag);

    // Extract title
    const title = track.tags.find(t => t[0] === 'title')?.[1] || '';

    // Extract audio URL
    const url = track.tags.find(t => t[0] === 'url')?.[1] || '';
    this.audioUrl.set(url);

    // Extract image
    const image = track.tags.find(t => t[0] === 'image')?.[1] || null;
    this.coverImage.set(image);

    // Extract gradient
    const gradientTag = track.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      this.currentGradient.set(gradientTag[2]);
    }

    // Extract genres from t tags (exclude reserved tags)
    const reservedTTags = ['music', 'ai-generated'];
    const allTTags = track.tags.filter(t => t[0] === 't').map(t => t[1]);

    const genres = allTTags
      .filter(tag => !reservedTTags.includes(tag.toLowerCase()))
      .filter(tag => this.availableGenres.some(g => g.toLowerCase() === tag.toLowerCase()))
      .map(tag => this.availableGenres.find(g => g.toLowerCase() === tag.toLowerCase()) || tag);

    // Extract custom tags (t tags that are not genres or reserved)
    const genreLowerCase = this.availableGenres.map(g => g.toLowerCase());
    const customTags = allTTags
      .filter(tag => !reservedTTags.includes(tag.toLowerCase()))
      .filter(tag => !genreLowerCase.includes(tag.toLowerCase()));

    // Extract artist npub from p tag
    const artistPubkey = track.tags.find(t => t[0] === 'p')?.[1];
    let artistNpub = '';
    if (artistPubkey) {
      try {
        artistNpub = nip19.npubEncode(artistPubkey);
      } catch {
        // Invalid pubkey
      }
    }

    // Extract artist name
    const artistName = track.tags.find(t => t[0] === 'artist')?.[1] || '';

    // Extract AI flag (check both 'ai-generated' and legacy 'ai' tag)
    const aiGenerated = track.tags.find(t => t[0] === 'ai-generated')?.[1] === 'true' ||
      track.tags.find(t => t[0] === 'ai')?.[1] === 'true';

    // Extract advanced settings
    const album = track.tags.find(t => t[0] === 'album')?.[1] || '';
    const trackNumber = track.tags.find(t => t[0] === 'track_number')?.[1] || '';
    const releaseDate = track.tags.find(t => t[0] === 'released')?.[1] || '';
    const language = track.tags.find(t => t[0] === 'language')?.[1] || 'en';
    const explicitContent = track.tags.some(t => t[0] === 'explicit' && t[1] === 'true');

    // Extract lyrics and credits from content (per spec, both go in content field)
    let lyrics = '';
    let credits = '';
    if (track.content) {
      // Try to parse content for Lyrics: and Credits: sections
      const lyricsMatch = track.content.match(/Lyrics:\n([\s\S]*?)(?=\n\nCredits:|$)/);
      const creditsMatch = track.content.match(/Credits:\n([\s\S]*)$/);

      if (lyricsMatch) {
        lyrics = lyricsMatch[1].trim();
      } else if (!track.content.startsWith('Credits:')) {
        // If no explicit Lyrics: header and doesn't start with Credits:, assume entire content is lyrics
        const creditsIndex = track.content.indexOf('\n\nCredits:');
        if (creditsIndex > -1) {
          lyrics = track.content.substring(0, creditsIndex).trim();
        } else {
          lyrics = track.content.trim();
        }
      }

      if (creditsMatch) {
        credits = creditsMatch[1].trim();
      }
    }

    // Fallback: check for legacy lyrics tag
    if (!lyrics) {
      lyrics = track.tags.find(t => t[0] === 'lyrics')?.[1] || '';
    }

    // Set form values
    this.trackForm.patchValue({
      title,
      genres,
      artistNpub,
      artistName,
      aiGenerated,
      album,
      trackNumber,
      releaseDate,
      language,
      explicitContent,
      lyrics,
      credits,
      imageUrl: image || '',
      customTags: customTags.join(', '),
    });

    // Extract zap splits
    this.initializeZapSplits(track);
  }

  private async initializeZapSplits(track: Event): Promise<void> {
    const zapTags = track.tags.filter(t => t[0] === 'zap');
    const splits: ZapSplit[] = [];

    // Add track owner first
    const ownerPubkey = track.pubkey;
    const ownerProfile = await this.dataService.getProfile(ownerPubkey);
    const ownerName = ownerProfile?.data?.name || ownerProfile?.data?.display_name || 'You';
    const ownerAvatar = ownerProfile?.data?.picture || null;

    // Check if owner is in zap tags
    const ownerZapTag = zapTags.find(t => t[1] === ownerPubkey);
    const ownerPercentage = ownerZapTag ? parseInt(ownerZapTag[3], 10) || 0 : 100;

    splits.push({
      pubkey: ownerPubkey,
      name: ownerName,
      avatar: ownerAvatar,
      percentage: ownerPercentage,
      isUploader: true,
    });

    // Add other collaborators
    for (const zapTag of zapTags) {
      const pubkey = zapTag[1];
      if (pubkey === ownerPubkey) continue;

      const percentage = parseInt(zapTag[3], 10) || 0;
      const profile = await this.dataService.getProfile(pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || 'Unknown';
      const avatar = profile?.data?.picture || null;

      splits.push({
        pubkey,
        name,
        avatar,
        percentage,
        isUploader: false,
      });
    }

    // If no zap tags, uploader gets 100%
    if (zapTags.length === 0) {
      splits[0].percentage = 100;
    }

    this.zapSplits.set(splits);
  }

  private async autoFillArtistName(npub: string): Promise<void> {
    try {
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

  private getRandomGradient(): string {
    return this.gradients[Math.floor(Math.random() * this.gradients.length)];
  }

  randomizeGradient(): void {
    this.currentGradient.set(this.getRandomGradient());
    this.coverImage.set(null);
    this.trackForm.patchValue({ imageUrl: '' });
  }

  async uploadImage(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

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
            this.snackBar.open('Image uploaded successfully', 'Close', { duration: 2000 });
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
    };

    input.click();
  }

  onImageUrlChange(): void {
    const url = this.trackForm.get('imageUrl')?.value;
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      this.coverImage.set(url);
    }
  }

  async addZapSplit(): Promise<void> {
    const npub = prompt('Enter collaborator npub:');
    if (!npub || !npub.startsWith('npub')) {
      this.snackBar.open('Invalid npub', 'Close', { duration: 3000 });
      return;
    }

    try {
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

      // Fetch profile
      const profile = await this.dataService.getProfile(pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || 'Unknown';
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

  async saveTrack(): Promise<void> {
    if (!this.trackForm.valid) {
      return;
    }

    // Validate split percentages
    if (this.totalSplitPercentage() !== 100) {
      this.snackBar.open('Zap splits must total 100%', 'Close', { duration: 3000 });
      return;
    }

    this.isSaving.set(true);

    try {
      const formValue = this.trackForm.value;
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.snackBar.open('Not authenticated', 'Close', { duration: 3000 });
        return;
      }

      // Use original d tag to update the same event
      const dTag = this.originalDTag();

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
        tags.push(['ai-generated', 'true']);
      }

      // Advanced settings
      if (formValue.album) {
        tags.push(['album', formValue.album]);
      }

      if (formValue.trackNumber) {
        tags.push(['track_number', String(formValue.trackNumber)]);
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

      // Add custom tags
      if (formValue.customTags) {
        const customTagsList = formValue.customTags
          .split(',')
          .map((t: string) => t.trim().toLowerCase())
          .filter((t: string) => t.length > 0);
        for (const tag of customTagsList) {
          tags.push(['t', tag]);
        }
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

      // Build content (lyrics and credits go here per spec)
      let content = '';
      if (formValue.lyrics && formValue.credits) {
        content = `Lyrics:\n${formValue.lyrics}\n\nCredits:\n${formValue.credits}`;
      } else if (formValue.lyrics) {
        content = `Lyrics:\n${formValue.lyrics}`;
      } else if (formValue.credits) {
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
        this.snackBar.open('Track updated successfully!', 'Close', { duration: 3000 });
        this.closed.emit({ updated: true, event: signedEvent });
      } else {
        this.snackBar.open('Failed to update track', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Error updating track:', error);
      this.snackBar.open('Error updating track', 'Close', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel(): void {
    this.closed.emit(null);
  }

  onClose(): void {
    if (!this.isSaving()) {
      this.closed.emit(null);
    }
  }

  // Navigate to media settings - specifically to the Media Servers tab
  navigateToMediaSettings(): void {
    this.cancel();
    this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }
}
