import { Component, inject, signal, computed, output, input, effect } from '@angular/core';
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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
import { parseBlob, selectCover } from 'music-metadata';
import { MediaService } from '../../../services/media.service';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { RelaysService } from '../../../services/relays/relays';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { MusicTermsDialogComponent } from '../music-terms-dialog/music-terms-dialog.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { MentionAutocompleteComponent, MentionAutocompleteConfig, MentionSelection } from '../../../components/mention-autocomplete/mention-autocomplete.component';
import { MentionInputService } from '../../../services/mention-input.service';

const MUSIC_KIND = 36787;

export interface MusicTrackDialogData {
  track?: Event; // If provided, we're editing an existing track
}

interface ZapSplit {
  pubkey: string;
  name: string;
  avatar: string | null;
  percentage: number;
  isUploader: boolean;
}

@Component({
  selector: 'app-music-track-dialog',
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
    MatDialogModule,
    ReactiveFormsModule,
    MusicTermsDialogComponent,
    MentionAutocompleteComponent,
  ],
  templateUrl: './music-track-dialog.component.html',
  styleUrl: './music-track-dialog.component.scss',
})
export class MusicTrackDialogComponent {
  data = input<MusicTrackDialogData>({});
  closed = output<{ published: boolean; updated?: boolean; event?: Event } | null>();

  private fb = inject(FormBuilder);
  private mediaService = inject(MediaService);
  private accountState = inject(AccountStateService);
  private nostrService = inject(NostrService);
  private relaysService = inject(RelaysService);
  private pool = inject(RelayPoolService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  // Computed mode based on whether we have track data
  isEditMode = computed(() => !!this.data()?.track);
  dialogTitle = computed(() => this.isEditMode() ? 'Edit Track' : 'Upload Music Track');

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
  originalDTag = signal<string>('');

  // Track previous URLs for cleanup
  previousAudioUrl = signal<string | null>(null);
  previousCoverImage = signal<string | null>(null);

  // Zap splits
  zapSplits = signal<ZapSplit[]>([]);
  currentUserProfile = signal<{ name: string; avatar: string | null }>({ name: '', avatar: null });

  // Add split form state
  isAddingSplit = signal(false);
  newSplitInput = signal('');

  // Mention autocomplete for @ search
  private mentionInputService = inject(MentionInputService);
  mentionConfig = signal<MentionAutocompleteConfig | null>(null);
  mentionPosition = signal({ top: 0, left: 0 });

  // Available genres for music
  availableGenres = [
    'Electronic', 'Rock', 'Pop', 'Hip Hop', 'R&B', 'Jazz', 'Classical',
    'Country', 'Folk', 'Metal', 'Punk', 'Alternative', 'Indie',
    'Dance', 'House', 'Techno', 'Ambient', 'Experimental', 'Soul',
    'Reggae', 'Blues', 'Latin', 'World', 'Soundtrack', 'Lo-Fi',
    'Trap', 'Dubstep', 'Drum & Bass', 'Synthwave', 'Other'
  ];

  // Available license options
  licenseOptions = [
    { value: '', label: 'None', url: '' },
    { value: 'All Rights Reserved', label: 'All Rights Reserved', url: '' },
    { value: 'CC0 1.0', label: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    { value: 'CC-BY 4.0', label: 'CC-BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    { value: 'CC BY-SA 4.0', label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    { value: 'CC BY-ND 4.0', label: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/' },
    { value: 'CC BY-NC 4.0', label: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    { value: 'CC BY-NC-SA 4.0', label: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
    { value: 'CC BY-NC-ND 4.0', label: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' },
    { value: 'custom', label: 'Custom', url: '' },
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
    const splits = this.zapSplits();
    // If no splits, consider it valid (100% goes to author)
    if (splits.length === 0) return 100;
    return splits.reduce((sum, split) => sum + split.percentage, 0);
  });

  private initialized = false;

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
      license: [''], // License selection
      customLicense: [''], // Custom license name
      customLicenseUrl: [''], // Custom license URL
    });

    // Initialize based on mode
    effect(() => {
      const trackData = this.data();
      if (trackData?.track && !this.initialized) {
        this.initialized = true;
        this.initializeFromTrack(trackData.track);
        // In edit mode, terms are already agreed
        this.agreedToTerms.set(true);
      } else if (!trackData?.track && !this.initialized) {
        this.initialized = true;
        this.loadCurrentUserProfile();
      }
    });

    // Auto-fill artist name when npub is entered
    this.trackForm.get('artistNpub')?.valueChanges.subscribe(async (npub: string) => {
      if (npub && npub.startsWith('npub')) {
        await this.autoFillArtistName(npub);
      }
    });
  }

  private async initializeFromTrack(track: Event): Promise<void> {
    // Extract d tag
    const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
    this.originalDTag.set(dTag);

    // Extract title
    const title = track.tags.find(t => t[0] === 'title')?.[1] || '';

    // Extract audio URL and store as previous for potential cleanup
    const url = track.tags.find(t => t[0] === 'url')?.[1] || '';
    this.audioUrl.set(url);
    this.previousAudioUrl.set(url);

    // Extract image and store as previous for potential cleanup
    const image = track.tags.find(t => t[0] === 'image')?.[1] || null;
    this.coverImage.set(image);
    this.previousCoverImage.set(image);

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
    let license = '';
    let customLicense = '';
    let customLicenseUrl = '';

    if (track.content) {
      // Try to parse content for Lyrics:, Credits:, and License: sections
      const lyricsMatch = track.content.match(/Lyrics:\n([\s\S]*?)(?=\n\n(?:Credits:|License:)|$)/);
      const creditsMatch = track.content.match(/Credits:\n([\s\S]*?)(?=\n\nLicense:|$)/);
      const licenseMatch = track.content.match(/License:\n([^\n]+)(?:\n(https?:\/\/[^\s]+))?/);

      if (lyricsMatch) {
        lyrics = lyricsMatch[1].trim();
      } else if (!track.content.startsWith('Credits:') && !track.content.startsWith('License:')) {
        // If no explicit Lyrics: header and doesn't start with Credits: or License:, assume first part is lyrics
        const creditsIndex = track.content.indexOf('\n\nCredits:');
        const licenseIndex = track.content.indexOf('\n\nLicense:');
        const firstSectionIndex = Math.min(
          creditsIndex > -1 ? creditsIndex : Infinity,
          licenseIndex > -1 ? licenseIndex : Infinity
        );
        if (firstSectionIndex < Infinity) {
          lyrics = track.content.substring(0, firstSectionIndex).trim();
        } else {
          lyrics = track.content.trim();
        }
      }

      if (creditsMatch) {
        credits = creditsMatch[1].trim();
      }

      if (licenseMatch) {
        const licenseName = licenseMatch[1].trim();
        const licenseUrl = licenseMatch[2]?.trim() || '';

        // Check if it's a standard license
        const matchedOption = this.licenseOptions.find(opt => opt.value === licenseName && opt.value !== 'custom');
        if (matchedOption) {
          license = matchedOption.value;
        } else if (licenseName) {
          // It's a custom license
          license = 'custom';
          customLicense = licenseName;
          customLicenseUrl = licenseUrl;
        }
      }
    }

    // Fallback: check for legacy lyrics tag
    if (!lyrics) {
      lyrics = track.tags.find(t => t[0] === 'lyrics')?.[1] || '';
    }

    // Fallback: check for legacy license tag
    if (!license) {
      const licenseTag = track.tags.find(t => t[0] === 'license');
      if (licenseTag) {
        const licenseName = licenseTag[1] || '';
        const licenseUrl = licenseTag[2] || '';

        // Check if it's a standard license
        const matchedOption = this.licenseOptions.find(opt => opt.value === licenseName && opt.value !== 'custom');
        if (matchedOption) {
          license = matchedOption.value;
        } else if (licenseName) {
          // It's a custom license
          license = 'custom';
          customLicense = licenseName;
          customLicenseUrl = licenseUrl;
        }
      }
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
      license,
      customLicense,
      customLicenseUrl,
    });

    // Extract zap splits
    await this.initializeZapSplitsFromTrack(track);
  }

  private async initializeZapSplitsFromTrack(track: Event): Promise<void> {
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

  // Extract SHA256 hash from a blossom URL
  private extractHashFromUrl(url: string): string | null {
    if (!url) return null;

    // Blossom URLs typically have format: https://server.com/<sha256hash>.<ext>
    // or https://server.com/<sha256hash>
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1];

    // Remove extension if present
    const hashPart = lastPart.split('.')[0];

    // SHA256 hash is 64 hex characters
    if (/^[a-f0-9]{64}$/i.test(hashPart)) {
      return hashPart.toLowerCase();
    }

    return null;
  }

  private async promptDeleteFile(fileType: string, url: string): Promise<void> {
    const hash = this.extractHashFromUrl(url);
    if (!hash) {
      console.log(`Could not extract hash from ${fileType} URL:`, url);
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete old ${fileType}?`,
        message: `Would you like to delete the previous ${fileType} file from your media server? This will free up storage space.`,
        confirmText: 'Delete',
        cancelText: 'Keep',
        confirmColor: 'warn',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        await this.mediaService.deleteFile(hash);
        this.snackBar.open(`Previous ${fileType} deleted`, 'Close', { duration: 2000 });
      } catch (error) {
        console.error(`Failed to delete ${fileType}:`, error);
        this.snackBar.open(`Failed to delete ${fileType}`, 'Close', { duration: 3000 });
      }
    }
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
    const previousUrl = this.audioUrl();
    const isReupload = this.isEditMode() && !!previousUrl;
    this.audioFile.set(file);

    // Extract metadata from audio file (title, album art, etc.)
    // When re-uploading, force update all metadata fields
    await this.extractAudioMetadata(file, isReupload);

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

          // If this was a re-upload (edit mode with different URL), ask to delete old file
          if (previousUrl && previousUrl !== url && this.isEditMode()) {
            // Wait for the snackbar to be seen, then prompt
            setTimeout(() => this.promptDeleteFile('audio track', previousUrl), 500);
          }
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

  private async extractAudioMetadata(file: File, forceUpdate = false): Promise<void> {
    try {
      const metadata = await parseBlob(file);

      // Auto-fill title from metadata or filename (update if forceUpdate or empty)
      const currentTitle = this.trackForm.get('title')?.value;
      if (forceUpdate || !currentTitle) {
        const title = metadata.common.title;
        if (title) {
          this.trackForm.patchValue({ title });
        } else {
          // Fallback to filename
          const fileName = file.name.replace(/\.[^/.]+$/, '');
          const cleanTitle = fileName.replace(/[_-]/g, ' ').trim();
          this.trackForm.patchValue({ title: cleanTitle });
        }
      }

      // Auto-fill artist name (update if forceUpdate or empty)
      const currentArtist = this.trackForm.get('artistName')?.value;
      if ((forceUpdate || !currentArtist) && metadata.common.artist) {
        this.trackForm.patchValue({ artistName: metadata.common.artist });
      }

      // Auto-fill album (update if forceUpdate or empty)
      const currentAlbum = this.trackForm.get('album')?.value;
      if ((forceUpdate || !currentAlbum) && metadata.common.album) {
        this.trackForm.patchValue({ album: metadata.common.album });
      }

      // Auto-fill year/release date (update if forceUpdate or empty)
      const currentReleaseDate = this.trackForm.get('releaseDate')?.value;
      if ((forceUpdate || !currentReleaseDate) && metadata.common.year) {
        const year = metadata.common.year;
        this.trackForm.patchValue({ releaseDate: `${year}-01-01` });
      }

      // Auto-fill track number (update if forceUpdate or empty)
      const currentTrackNumber = this.trackForm.get('trackNumber')?.value;
      if ((forceUpdate || !currentTrackNumber) && metadata.common.track?.no) {
        this.trackForm.patchValue({ trackNumber: metadata.common.track.no.toString() });
      }

      // Auto-fill genre (update if forceUpdate or empty)
      const currentGenres = this.trackForm.get('genres')?.value;
      if ((forceUpdate || !currentGenres || currentGenres.length === 0) && metadata.common.genre && metadata.common.genre.length > 0) {
        const matchedGenres = metadata.common.genre
          .map(g => this.availableGenres.find(ag => ag.toLowerCase() === g.toLowerCase()))
          .filter((g): g is string => g !== undefined);

        if (matchedGenres.length > 0) {
          this.trackForm.patchValue({ genres: matchedGenres });
        }
      }

      // Check for AI-generated music sources (e.g., Suno.com)
      const nativeTags = metadata.native;
      let isAiGenerated = false;

      for (const tagType of Object.keys(nativeTags)) {
        const tags = nativeTags[tagType];
        for (const tag of tags) {
          if (tag.id === 'WWWAUDIOSOURCE' || tag.id === 'WOAS' || tag.id === 'website' || tag.id === 'WOAF') {
            const value = typeof tag.value === 'string' ? tag.value : '';
            if (value.toLowerCase().includes('suno.com')) {
              isAiGenerated = true;
              break;
            }
          }
          if (tag.id === 'COMM' || tag.id === 'comment') {
            const value = typeof tag.value === 'string' ? tag.value :
              (tag.value && typeof tag.value === 'object' && 'text' in tag.value ? String(tag.value.text) : '');
            if (value.toLowerCase().includes('suno.com')) {
              isAiGenerated = true;
              break;
            }
          }
        }
        if (isAiGenerated) break;
      }

      if (isAiGenerated) {
        this.trackForm.patchValue({ aiGenerated: true });
      }

      // Extract and upload album art (always extract if forceUpdate or no cover image)
      if (forceUpdate || !this.coverImage()) {
        const cover = selectCover(metadata.common.picture);
        if (cover) {
          await this.uploadExtractedCoverArt(cover);
        }
      }
    } catch (error) {
      console.error('Error extracting audio metadata:', error);
      // Fallback to filename for title
      const currentTitle = this.trackForm.get('title')?.value;
      if (forceUpdate || !currentTitle) {
        const fileName = file.name.replace(/\.[^/.]+$/, '');
        const cleanTitle = fileName.replace(/[_-]/g, ' ').trim();
        this.trackForm.patchValue({ title: cleanTitle });
      }
    }
  }

  private async uploadExtractedCoverArt(cover: { format: string; data: Uint8Array }): Promise<void> {
    try {
      const buffer = new Uint8Array(cover.data).buffer;
      const blob = new Blob([buffer], { type: cover.format });
      const extension = cover.format.split('/')[1] || 'jpg';
      const file = new File([blob], `cover.${extension}`, { type: cover.format });

      await this.handleImageFile(file);
      this.snackBar.open('Album art extracted and uploaded', 'Close', { duration: 2000 });
    } catch (error) {
      console.error('Error uploading extracted cover art:', error);
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
    const previousImage = this.coverImage();
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

          // If this was a re-upload (with different URL), ask to delete old file
          if (previousImage && previousImage !== url && this.isEditMode()) {
            setTimeout(() => this.promptDeleteFile('album art', previousImage), 500);
          }
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

  toggleAddSplit(): void {
    this.isAddingSplit.update(v => !v);
    if (!this.isAddingSplit()) {
      this.newSplitInput.set('');
    }
  }

  cancelAddSplit(): void {
    this.isAddingSplit.set(false);
    this.newSplitInput.set('');
    this.mentionConfig.set(null);
  }

  onSplitInputChange(event: globalThis.Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    this.newSplitInput.set(value);

    // Check for @ mention
    const detection = this.mentionInputService.detectMention(value, input.selectionStart || value.length);
    if (detection.isTypingMention) {
      // Calculate position for the autocomplete dropdown
      const rect = input.getBoundingClientRect();
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
    // Let the mention autocomplete handle arrow keys and enter when visible
    if (this.mentionConfig()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        // Don't prevent default for Escape - let it also close the form
        if (event.key === 'Escape') {
          this.mentionConfig.set(null);
        }
        // Let the mention autocomplete component handle these
        return;
      }
    }
  }

  onMentionSelected(selection: MentionSelection): void {
    // Add the selected user as a split
    this.addSplitByPubkey(selection.pubkey, selection.displayName);
    this.mentionConfig.set(null);
  }

  onMentionDismissed(): void {
    this.mentionConfig.set(null);
  }

  private async addSplitByPubkey(pubkey: string, displayName?: string): Promise<void> {
    // Check if already added
    if (this.zapSplits().some(s => s.pubkey === pubkey)) {
      this.snackBar.open('Collaborator already added', 'Close', { duration: 3000 });
      return;
    }

    // Load profile for avatar
    const profile = await this.dataService.getProfile(pubkey);
    const name = displayName || profile?.data?.name || profile?.data?.display_name || nip19.npubEncode(pubkey).slice(0, 12) + '...';
    const avatar = profile?.data?.picture || null;

    // If this is the first split being added, give it 100%
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

      // Check if it's an npub
      if (input.startsWith('npub')) {
        const decoded = nip19.decode(input);
        if (decoded.type !== 'npub') {
          this.snackBar.open('Invalid npub', 'Close', { duration: 3000 });
          return;
        }
        pubkey = decoded.data;
      } else {
        // Assume it's a hex pubkey - validate it's 64 hex characters
        if (!/^[0-9a-fA-F]{64}$/.test(input)) {
          this.snackBar.open('Invalid pubkey format. Use npub or 64-character hex.', 'Close', { duration: 3000 });
          return;
        }
        pubkey = input.toLowerCase();
      }

      // Check if already added
      if (this.zapSplits().some(s => s.pubkey === pubkey)) {
        this.snackBar.open('Collaborator already added', 'Close', { duration: 3000 });
        return;
      }

      // Load profile
      const profile = await this.dataService.getProfile(pubkey);
      const name = profile?.data?.name || profile?.data?.display_name || nip19.npubEncode(pubkey).slice(0, 12) + '...';
      const avatar = profile?.data?.picture || null;

      // If this is the first split being added, give it 100%
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

    // If there are remaining splits and removed split had a percentage, redistribute it
    if (remainingSplits.length > 0 && removedPercentage > 0) {
      const totalRemaining = remainingSplits.reduce((sum, s) => sum + s.percentage, 0);

      if (totalRemaining === 0) {
        // Distribute removed percentage equally among remaining splits
        const perSplit = Math.floor(removedPercentage / remainingSplits.length);
        const remainder = removedPercentage - (perSplit * remainingSplits.length);

        this.zapSplits.set(remainingSplits.map((split, i) => ({
          ...split,
          percentage: perSplit + (i === 0 ? remainder : 0)
        })));
      } else {
        // Distribute proportionally based on existing percentages
        this.zapSplits.set(remainingSplits.map(split => {
          const proportion = split.percentage / totalRemaining;
          const addedPercentage = Math.round(removedPercentage * proportion);
          return {
            ...split,
            percentage: split.percentage + addedPercentage
          };
        }));

        // Adjust for rounding errors to ensure total is 100%
        const currentTotal = this.zapSplits().reduce((sum, s) => sum + s.percentage, 0);
        if (currentTotal !== 100) {
          const diff = 100 - currentTotal;
          this.zapSplits.update(splits => {
            const updated = [...splits];
            updated[0] = { ...updated[0], percentage: updated[0].percentage + diff };
            return updated;
          });
        }
      }
    } else {
      this.zapSplits.set(remainingSplits);
    }
  }

  async submitTrack(): Promise<void> {
    if (!this.trackForm.valid || !this.audioUrl() || (!this.isEditMode() && !this.agreedToTerms())) {
      return;
    }

    // Validate split percentages (empty list is valid - 100% goes to author)
    const splits = this.zapSplits();
    if (splits.length > 0 && this.totalSplitPercentage() !== 100) {
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

      // Use original d tag if editing, otherwise generate new one
      const dTag = this.isEditMode() && this.originalDTag()
        ? this.originalDTag()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Build tags
      const tags: string[][] = [
        ['d', dTag],
        ['title', formValue.title],
        ['url', this.audioUrl()!],
        ['t', 'music'],
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

      // Build content (lyrics, credits, and license go here)
      const contentParts: string[] = [];

      if (formValue.lyrics) {
        contentParts.push(`Lyrics:\n${formValue.lyrics}`);
      }

      if (formValue.credits) {
        contentParts.push(`Credits:\n${formValue.credits}`);
      }

      // Add license to content
      if (formValue.license) {
        const licenseName = formValue.license === 'custom'
          ? formValue.customLicense
          : formValue.license;
        const licenseUrl = formValue.license === 'custom'
          ? formValue.customLicenseUrl
          : this.licenseOptions.find(opt => opt.value === formValue.license)?.url || '';

        if (licenseName) {
          if (licenseUrl) {
            contentParts.push(`License:\n${licenseName}\n${licenseUrl}`);
          } else {
            contentParts.push(`License:\n${licenseName}`);
          }
        }
      }

      const content = contentParts.join('\n\n');

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
        const message = this.isEditMode() ? 'Track updated successfully!' : 'Track published successfully!';
        this.snackBar.open(message, 'Close', { duration: 3000 });
        this.closed.emit({
          published: true,
          updated: this.isEditMode(),
          event: signedEvent
        });
      } else {
        const message = this.isEditMode() ? 'Failed to update track' : 'Failed to publish track';
        this.snackBar.open(message, 'Close', { duration: 3000 });
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

  navigateToMediaSettings(): void {
    this.cancel();
    this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }
}
