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
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
import { parseBlob, selectCover, type IAudioMetadata } from 'music-metadata';
import { MediaService } from '../../../services/media.service';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { RelaysService } from '../../../services/relays/relays';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { UtilitiesService } from '../../../services/utilities.service';
import { DataService } from '../../../services/data.service';
import { LoggerService } from '../../../services/logger.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { MusicTermsDialogComponent } from '../music-terms-dialog/music-terms-dialog.component';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { MentionAutocompleteComponent, MentionAutocompleteConfig, MentionSelection } from '../../../components/mention-autocomplete/mention-autocomplete.component';
import { MentionInputService } from '../../../services/mention-input.service';
import { RelayPublishSelectorComponent, RelayPublishConfig } from '../../../components/relay-publish-selector/relay-publish-selector.component';
import { formatDuration } from '../../../utils/format-duration';
import { shouldAutoMarkTrackAsAiGenerated } from './music-track-metadata.util';

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
    MatChipsModule,
    MatAutocompleteModule,
    MatExpansionModule,
    MatSnackBarModule,
    MatDialogModule,
    ReactiveFormsModule,
    MusicTermsDialogComponent,
    MentionAutocompleteComponent,
    RelayPublishSelectorComponent,
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
  private readonly logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  // Computed mode based on whether we have track data
  isEditMode = computed(() => !!this.data()?.track);
  dialogTitle = computed(() => this.isEditMode() ? 'Edit Track' : 'Upload Music Track');

  // Show full form when in edit mode or when an audio source is ready locally/remotely.
  showFullForm = computed(() => this.isEditMode() || !!this.audioUrl() || !!this.audioFile());
  hasAudioSource = computed(() => !!this.audioUrl() || !!this.audioFile());
  audioPreviewUrl = computed(() => this.audioUrl() || this.localAudioPreviewUrl());

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
  pendingCoverFile = signal<File | null>(null);
  coverImage = signal<string | null>(null);
  showExternalUrlInput = signal(false);
  externalUrlValue = signal('');
  externalCoverUrlValue = signal('');
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

  // Relay publishing configuration
  relayPublishConfig = signal<RelayPublishConfig | null>(null);

  // Mention autocomplete for @ search
  private mentionInputService = inject(MentionInputService);
  mentionConfig = signal<MentionAutocompleteConfig | null>(null);
  mentionPosition = signal({ top: 0, left: 0 });

  // Genre tags for the track (free-form, user can add any value)
  genres = signal<string[]>([]);
  genreInput = signal('');
  parsedAudioMetadataDebug = signal('');
  parsedTrackMetadataSummary = signal<string | null>(null);

  readonly suggestedGenres = [
    'Electronic', 'Rock', 'Pop', 'Hip Hop', 'R&B', 'Jazz', 'Classical',
    'Country', 'Folk', 'Metal', 'Punk', 'Alternative', 'Indie',
    'Dance', 'House', 'Techno', 'Ambient', 'Experimental', 'Soul',
    'Reggae', 'Blues', 'Latin', 'World', 'Soundtrack', 'Lo-Fi',
    'Trap', 'Dubstep', 'Drum & Bass', 'Synthwave',
  ];

  filteredGenres = computed(() => {
    const input = this.genreInput().toLowerCase();
    const current = this.genres().map(g => g.toLowerCase());
    return this.suggestedGenres
      .filter(g => !current.includes(g.toLowerCase()))
      .filter(g => !input || g.toLowerCase().includes(input));
  });

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
  private localAudioPreviewUrl = signal<string | null>(null);
  private localAudioPreviewObjectUrl: string | null = null;
  private extractedCoverPreviewObjectUrl: string | null = null;

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
      duration: ['', [this.durationValidator]],
      artist: [''],
      aiGenerated: [false],
      // Advanced settings
      album: [''],
      video: [''],
      trackNumber: [''],
      releaseDate: [''],
      language: ['en'],
      explicitContent: [false],
      lyrics: [''],
      credits: [''],
      imageUrl: [''],
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

  }

  private async initializeFromTrack(track: Event): Promise<void> {
    // Extract d tag
    const dTag = track.tags.find(t => t[0] === 'd')?.[1] || '';
    this.originalDTag.set(dTag);

    // Extract title
    const title = track.tags.find(t => t[0] === 'title')?.[1] || '';

    // Extract audio URL and store as previous for potential cleanup
    const url = this.utilities.getUrlWithImetaFallback(track) || '';
    this.audioUrl.set(url);
    this.previousAudioUrl.set(url);

    // Extract image and store as previous for potential cleanup
    const image = track.tags.find(t => t[0] === 'image')?.[1] || null;
    this.clearExtractedCoverPreview();
    this.coverImage.set(image);
    this.previousCoverImage.set(image);

    // Extract gradient
    const gradientTag = track.tags.find(t => t[0] === 'gradient' && t[1] === 'colors');
    if (gradientTag?.[2]) {
      this.currentGradient.set(gradientTag[2]);
    }

    // Extract genres from t tags (exclude reserved tags)
    const reservedTTags = ['music', 'ai_generated', 'ai-generated'];
    const allTTags = track.tags.filter(t => t[0] === 't').map(t => t[1]);

    const genres = allTTags
      .filter(tag => !reservedTTags.includes(tag.toLowerCase()));

    this.genres.set(genres);

    // Extract artist name
    const artistName = track.tags.find(t => t[0] === 'artist')?.[1] || '';

    // Extract duration from tag (stored in seconds)
    const durationSeconds = this.utilities.getDurationTag(track);
    const duration = durationSeconds && durationSeconds > 0
      ? formatDuration(durationSeconds)
      : '';

    // Extract AI flag (check standard and legacy rendering tags)
    const aiGenerated = track.tags.find(t => t[0] === 'ai_generated')?.[1] === 'true' ||
      track.tags.find(t => t[0] === 'ai-generated')?.[1] === 'true' ||
      track.tags.find(t => t[0] === 'ai')?.[1] === 'true';

    // Extract advanced settings
    const album = track.tags.find(t => t[0] === 'album')?.[1] || '';
    const video = track.tags.find(t => t[0] === 'video')?.[1] || '';
    const trackNumber = track.tags.find(t => t[0] === 'track_number')?.[1] || '';
    const releaseDate = track.tags.find(t => t[0] === 'released')?.[1] || '';
    const language = track.tags.find(t => t[0] === 'language')?.[1] || 'en';
    const explicitContent = track.tags.some(t => t[0] === 'explicit' && t[1] === 'true');

    // Extract license - prioritize tag, fall back to content
    let license = '';
    let customLicense = '';
    let customLicenseUrl = '';

    const licenseTag = track.tags.find(t => t[0] === 'license');
    if (licenseTag) {
      const licenseName = licenseTag[1] || '';
      const matchedOption = this.licenseOptions.find(opt => opt.value === licenseName && opt.value !== 'custom');
      if (matchedOption) {
        license = matchedOption.value;
      } else if (licenseName) {
        license = 'custom';
        customLicense = licenseName;
      }
    }

    // Fallback: check content for License: section (legacy format)
    if (!license && track.content) {
      const licenseMatch = track.content.match(/License:\n([^\n]+)(?:\n(https?:\/\/[^\s]+))?/);
      if (licenseMatch) {
        const licenseName = licenseMatch[1].trim();
        const licenseUrl = licenseMatch[2]?.trim() || '';
        const matchedOption = this.licenseOptions.find(opt => opt.value === licenseName && opt.value !== 'custom');
        if (matchedOption) {
          license = matchedOption.value;
        } else if (licenseName) {
          license = 'custom';
          customLicense = licenseName;
          customLicenseUrl = licenseUrl;
        }
      }
    }

    // Extract lyrics and credits from content
    let lyrics = '';
    let credits = '';

    if (track.content) {
      const lyricsMatch = track.content.match(/Lyrics:\n([\s\S]*?)(?=\n\n(?:Credits:|License:)|$)/);
      const creditsMatch = track.content.match(/Credits:\n([\s\S]*?)(?=\n\nLicense:|$)/);

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
    }

    // Fallback: check for legacy lyrics tag
    if (!lyrics) {
      lyrics = track.tags.find(t => t[0] === 'lyrics')?.[1] || '';
    }

    // Set form values
    this.trackForm.patchValue({
      title,
      duration,
      artist: artistName,
      aiGenerated,
      album,
      video,
      trackNumber,
      releaseDate,
      language,
      explicitContent,
      lyrics,
      credits,
      imageUrl: image || '',
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

    if (zapTags.length === 0) {
      // No zap tags, uploader gets 100%
      splits.push({
        pubkey: ownerPubkey,
        name: ownerName,
        avatar: ownerAvatar,
        percentage: 100,
        isUploader: true,
      });
    } else {
      // Parse weights from zap tags
      const rawSplits = zapTags.map(tag => ({
        pubkey: tag[1],
        weight: tag[3] ? parseFloat(tag[3]) : 0
      }));

      // Calculate total weight for normalization (NIP-57 Appendix G)
      const totalWeight = rawSplits.reduce((sum, s) => sum + s.weight, 0);

      // Normalize weights to percentages
      const normalizedSplits = rawSplits.map(split => ({
        pubkey: split.pubkey,
        percentage: totalWeight > 0 ? Math.round((split.weight / totalWeight) * 100) : 0
      }));

      // Ensure percentages add up to exactly 100 due to rounding
      const totalPercentage = normalizedSplits.reduce((sum, s) => sum + s.percentage, 0);
      if (totalPercentage !== 100 && normalizedSplits.length > 0) {
        normalizedSplits[0].percentage += (100 - totalPercentage);
      }

      // Load profiles for all splits
      for (const normalizedSplit of normalizedSplits) {
        const profile = await this.dataService.getProfile(normalizedSplit.pubkey);
        const name = profile?.data?.name || profile?.data?.display_name ||
          (normalizedSplit.pubkey === ownerPubkey ? 'You' : 'Unknown');
        const avatar = profile?.data?.picture || null;

        splits.push({
          pubkey: normalizedSplit.pubkey,
          name,
          avatar,
          percentage: normalizedSplit.percentage,
          isUploader: normalizedSplit.pubkey === ownerPubkey,
        });
      }
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

  private getRandomGradient(): string {
    return this.gradients[Math.floor(Math.random() * this.gradients.length)];
  }

  randomizeGradient(): void {
    this.pendingCoverFile.set(null);
    this.currentGradient.set(this.getRandomGradient());
    this.coverImage.set(null);
    this.trackForm.patchValue({ imageUrl: '' });
    this.clearExtractedCoverPreview();
  }

  private durationValidator(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value || '').trim();
    if (!value) {
      return null;
    }

    // Accept formats like "3:45", "1:23:45", or "225" (seconds)
    const durationPattern = /^(\d+:)?\d{1,2}:\d{2}$|^\d+$/;

    return durationPattern.test(value) ? null : { invalidDuration: true };
  }

  private parseDurationToSeconds(duration: string): number | null {
    const value = duration.trim();
    if (!value) {
      return null;
    }

    if (value.includes(':')) {
      const parts = value.split(':').map(part => parseInt(part, 10));
      if (parts.some(part => Number.isNaN(part))) {
        return null;
      }

      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      }

      if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }

      return null;
    }

    const seconds = parseInt(value, 10);
    return Number.isNaN(seconds) ? null : seconds;
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
      this.logger.debug(`Could not extract hash from ${fileType} URL:`, url);
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
        this.logger.error(`Failed to delete ${fileType}:`, error);
        this.snackBar.open(`Failed to delete ${fileType}`, 'Close', { duration: 3000 });
      }
    }
  }

  toggleExternalUrlInput(event: MouseEvent): void {
    event.stopPropagation();
    this.showExternalUrlInput.update(v => !v);
    if (!this.showExternalUrlInput()) {
      this.externalUrlValue.set('');
      this.externalCoverUrlValue.set('');
    }
  }

  async applyExternalUrls(): Promise<void> {
    const audioUrl = this.externalUrlValue().trim();
    if (!audioUrl) return;

    try {
      new URL(audioUrl);
    } catch {
      this.snackBar.open('Please enter a valid audio URL', 'Close', { duration: 3000 });
      return;
    }

    this.clearLocalAudioPreview();
    const coverUrl = this.externalCoverUrlValue().trim();
    this.audioFile.set(null);
    this.audioUrl.set(audioUrl);
    this.pendingCoverFile.set(null);

    if (coverUrl) {
      try {
        new URL(coverUrl);
      } catch {
        this.snackBar.open('Please enter a valid cover image URL', 'Close', { duration: 3000 });
        return;
      }
      this.clearExtractedCoverPreview();
      this.coverImage.set(coverUrl);
      this.trackForm.patchValue({ imageUrl: coverUrl });
    } else {
      this.trackForm.patchValue({ imageUrl: '' });
      this.clearExtractedCoverPreview();
      this.coverImage.set(null);
    }

    const shouldForceMetadataUpdate = this.isEditMode() || !this.trackForm.get('title')?.value;
    await this.extractAudioMetadataFromUrl(audioUrl, shouldForceMetadataUpdate);

    this.showExternalUrlInput.set(false);
    this.externalUrlValue.set('');
    this.externalCoverUrlValue.set('');
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
    const isReupload = this.isEditMode() && !!this.previousAudioUrl();

    this.clearLocalAudioPreview();
    this.audioFile.set(file);
    this.audioUrl.set(null);
    this.localAudioPreviewObjectUrl = URL.createObjectURL(file);
    this.localAudioPreviewUrl.set(this.localAudioPreviewObjectUrl);

    this.isUploadingAudio.set(true);
    try {
      await this.extractAudioMetadata(file, isReupload);
      this.snackBar.open('Audio ready. It will upload when you publish.', 'Close', { duration: 2500 });
    } catch (error) {
      this.logger.error('Error preparing audio:', error);
      this.snackBar.open('Error preparing audio', 'Close', { duration: 3000 });
      this.clearLocalAudioPreview();
      this.audioFile.set(null);
    } finally {
      this.isUploadingAudio.set(false);
    }
  }

  private async extractAudioMetadata(file: File, forceUpdate = false): Promise<void> {
    await this.extractAudioMetadataFromBlob(file, {
      forceUpdate,
      fallbackTitle: file.name,
    });
  }

  private async extractAudioMetadataFromUrl(url: string, forceUpdate = false): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      await this.extractAudioMetadataFromBlob(blob, {
        forceUpdate,
        fallbackTitle: this.getFilenameFromUrl(url),
      });
    } catch (error) {
      this.logger.warn('Could not extract metadata from external audio URL:', error);
      this.snackBar.open('Using external URL directly. Could not auto-extract full metadata.', 'Close', { duration: 3500 });
    }
  }

  private getFilenameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const rawName = parsed.pathname.split('/').pop() || 'Track';
      const decodedName = decodeURIComponent(rawName);
      return decodedName || 'Track';
    } catch {
      return 'Track';
    }
  }

  private clearExtractedCoverPreview(): void {
    if (this.extractedCoverPreviewObjectUrl) {
      URL.revokeObjectURL(this.extractedCoverPreviewObjectUrl);
      this.extractedCoverPreviewObjectUrl = null;
    }
  }

  private clearLocalAudioPreview(): void {
    if (this.localAudioPreviewObjectUrl) {
      URL.revokeObjectURL(this.localAudioPreviewObjectUrl);
      this.localAudioPreviewObjectUrl = null;
    }
    this.localAudioPreviewUrl.set(null);
  }

  private updateParsedMetadataDebug(metadata: IAudioMetadata): void {
    const metadataJson = JSON.stringify(metadata, this.metadataJsonReplacer, 2);
    this.parsedAudioMetadataDebug.set(metadataJson);
    this.parsedTrackMetadataSummary.set(this.describeTrackMetadataSource(metadata));
    this.logger.debug('Parsed audio metadata:', metadata);
  }

  private metadataJsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof ArrayBuffer) {
      return {
        type: 'ArrayBuffer',
        byteLength: value.byteLength,
      };
    }

    if (value instanceof Uint8Array) {
      return {
        type: 'Uint8Array',
        byteLength: value.byteLength,
      };
    }

    return value;
  }

  private describeTrackMetadataSource(metadata: IAudioMetadata): string | null {
    const details: string[] = [];

    if (metadata.common.track?.no != null) {
      details.push(`common.track.no=${metadata.common.track.no}`);
    }

    if (metadata.common.track?.of != null) {
      details.push(`common.track.of=${metadata.common.track.of}`);
    }

    const nativeTrackTags = Object.entries(metadata.native).flatMap(([container, tags]) =>
      (tags || [])
        .filter(tag => this.isTrackMetadataTag(tag.id))
        .map(tag => `${container}.${tag.id}=${this.stringifyMetadataValue(tag.value)}`)
    );

    if (nativeTrackTags.length > 0) {
      details.push(`native tags: ${nativeTrackTags.join(', ')}`);
    }

    return details.length > 0 ? details.join(' | ') : null;
  }

  private isTrackMetadataTag(id: string): boolean {
    const normalizedId = id.trim().toLowerCase();
    return normalizedId === 'trck'
      || normalizedId === 'track'
      || normalizedId.includes('tracknumber')
      || normalizedId.includes('track_number')
      || normalizedId.includes('track no')
      || normalizedId.includes('track');
  }

  private stringifyMetadataValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return JSON.stringify(value, this.metadataJsonReplacer, 0);
  }

  private normalizeMetadataReleaseDate(metadata: IAudioMetadata): string | null {
    const rawDate = metadata.common.releasedate || metadata.common.date || metadata.common.originaldate;
    if (rawDate) {
      const trimmed = rawDate.trim();
      const isoDate = trimmed.replace(/\//g, '-').split('T')[0];

      if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        return isoDate;
      }

      if (/^\d{4}-\d{2}$/.test(isoDate)) {
        return `${isoDate}-01`;
      }

      if (/^\d{4}$/.test(isoDate)) {
        return `${isoDate}-01-01`;
      }
    }

    if (metadata.common.year) {
      return `${metadata.common.year}-01-01`;
    }

    return null;
  }

  private extractLyrics(metadata: IAudioMetadata): string | null {
    const lyricEntries = metadata.common.lyrics || [];
    for (const entry of lyricEntries) {
      const unsyncedText = entry.text?.trim();
      if (unsyncedText) {
        return unsyncedText;
      }

      const syncedText = entry.syncText
        .map(line => line.text.trim())
        .filter(line => line.length > 0)
        .join('\n')
        .trim();
      if (syncedText) {
        return syncedText;
      }
    }

    return null;
  }

  private extractMetadataLanguage(metadata: IAudioMetadata): string | null {
    const commonLanguage = metadata.common.language?.trim();
    if (commonLanguage) {
      return commonLanguage;
    }

    const lyricLanguage = metadata.common.lyrics
      ?.map(entry => entry.language?.trim() || '')
      .find(language => language.length > 0);
    if (lyricLanguage) {
      return lyricLanguage;
    }

    const commentLanguage = metadata.common.comment
      ?.map(entry => entry.language?.trim() || '')
      .find(language => language.length > 0);
    if (commentLanguage) {
      return commentLanguage;
    }

    return null;
  }

  private buildMetadataCredits(metadata: IAudioMetadata): string | null {
    const lines: string[] = [];
    const pushList = (label: string, values?: string[]) => {
      const filteredValues = values?.map(value => value.trim()).filter(value => value.length > 0) || [];
      if (filteredValues.length > 0) {
        lines.push(`${label}: ${filteredValues.join(', ')}`);
      }
    };

    pushList('Composer', metadata.common.composer);
    pushList('Lyricist', metadata.common.lyricist);
    pushList('Writer', metadata.common.writer);
    pushList('Producer', metadata.common.producer);
    pushList('Engineer', metadata.common.engineer);
    pushList('Mixer', metadata.common.mixer);
    pushList('Arranger', metadata.common.arranger);
    pushList('Publisher', metadata.common.publisher);
    pushList('Label', metadata.common.label);

    const copyright = metadata.common.copyright?.trim();
    if (copyright) {
      lines.push(`Copyright: ${copyright}`);
    }

    const website = metadata.common.website?.trim();
    if (website) {
      lines.push(`Website: ${website}`);
    }

    const comments = metadata.common.comment
      ?.map(entry => entry.text?.trim() || '')
      .filter(text => text.length > 0) || [];
    if (comments.length > 0) {
      lines.push(`Comment: ${comments.join(' | ')}`);
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  private applyMetadataLicense(metadata: IAudioMetadata, forceUpdate: boolean): void {
    const currentLicense = String(this.trackForm.get('license')?.value || '').trim();
    if (!forceUpdate && currentLicense) {
      return;
    }

    const metadataLicense = metadata.common.license?.trim();
    if (!metadataLicense) {
      return;
    }

    const matchedOption = this.licenseOptions.find(option => option.value === metadataLicense && option.value !== 'custom');
    if (matchedOption) {
      this.trackForm.patchValue({
        license: matchedOption.value,
        customLicense: '',
        customLicenseUrl: matchedOption.url || '',
      });
      return;
    }

    this.trackForm.patchValue({
      license: 'custom',
      customLicense: metadataLicense,
    });
  }

  private async extractAudioMetadataFromBlob(
    blob: Blob,
    options: { forceUpdate: boolean; fallbackTitle: string }
  ): Promise<void> {
    const { forceUpdate, fallbackTitle } = options;

    try {
      const metadata = await parseBlob(blob);
      this.updateParsedMetadataDebug(metadata);

      // Auto-fill title from metadata or filename (update if forceUpdate or empty)
      const currentTitle = this.trackForm.get('title')?.value;
      if (forceUpdate || !currentTitle) {
        const title = metadata.common.title;
        if (title) {
          this.trackForm.patchValue({ title });
        } else {
          // Fallback to filename
          const fileName = fallbackTitle.replace(/\.[^/.]+$/, '');
          const cleanTitle = fileName.replace(/[_-]/g, ' ').trim();
          this.trackForm.patchValue({ title: cleanTitle });
        }
      }

      // Auto-fill artist name (update if forceUpdate or empty)
      const currentArtist = this.trackForm.get('artist')?.value;
      if ((forceUpdate || !currentArtist) && metadata.common.artist) {
        this.trackForm.patchValue({ artist: metadata.common.artist });
      }

      // Auto-fill duration from audio metadata (update if forceUpdate or empty)
      const currentDuration = this.trackForm.get('duration')?.value;
      const durationSeconds = metadata.format.duration ? Math.round(metadata.format.duration) : 0;
      if ((forceUpdate || !currentDuration) && durationSeconds > 0) {
        this.trackForm.patchValue({ duration: formatDuration(durationSeconds) });
      }

      // Auto-fill album (update if forceUpdate or empty)
      const currentAlbum = this.trackForm.get('album')?.value;
      if ((forceUpdate || !currentAlbum) && metadata.common.album) {
        this.trackForm.patchValue({ album: metadata.common.album });
      }

      // Auto-fill year/release date (update if forceUpdate or empty)
      const currentReleaseDate = this.trackForm.get('releaseDate')?.value;
      const metadataReleaseDate = this.normalizeMetadataReleaseDate(metadata);
      if ((forceUpdate || !currentReleaseDate) && metadataReleaseDate) {
        this.trackForm.patchValue({ releaseDate: metadataReleaseDate });
      }

      // Auto-fill track number (update if forceUpdate or empty)
      const currentTrackNumber = this.trackForm.get('trackNumber')?.value;
      if ((forceUpdate || !currentTrackNumber) && metadata.common.track?.no) {
        this.trackForm.patchValue({ trackNumber: metadata.common.track.no.toString() });
      }

      // Auto-fill genre (update if forceUpdate or empty)
      const currentGenres = this.genres();
      if ((forceUpdate || currentGenres.length === 0) && metadata.common.genre && metadata.common.genre.length > 0) {
        this.genres.set(metadata.common.genre);
      }

      const currentLanguage = this.trackForm.get('language')?.value;
      const metadataLanguage = this.extractMetadataLanguage(metadata);
      if ((forceUpdate || !currentLanguage || currentLanguage === 'en') && metadataLanguage) {
        this.trackForm.patchValue({ language: metadataLanguage });
      }

      const currentLyrics = this.trackForm.get('lyrics')?.value;
      const metadataLyrics = this.extractLyrics(metadata);
      if ((forceUpdate || !currentLyrics) && metadataLyrics) {
        this.trackForm.patchValue({ lyrics: metadataLyrics });
      }

      const currentCredits = this.trackForm.get('credits')?.value;
      const metadataCredits = this.buildMetadataCredits(metadata);
      if ((forceUpdate || !currentCredits) && metadataCredits) {
        this.trackForm.patchValue({ credits: metadataCredits });
      }

      this.applyMetadataLicense(metadata, forceUpdate);

      // Only auto-mark AI when the file contains an explicit AI metadata flag.
      // Source/comment heuristics were causing false positives for normal uploads.
      if (shouldAutoMarkTrackAsAiGenerated(metadata.native)) {
        this.trackForm.patchValue({ aiGenerated: true });
      }

      // Extract album art into local pending state so it uploads together with publish.
      if (forceUpdate || !this.coverImage()) {
        const cover = selectCover(metadata.common.picture);
        if (cover) {
          await this.stageExtractedCoverArt(cover);
        }
      }
    } catch (error) {
      this.logger.error('Error extracting audio metadata:', error);
      // Fallback to filename for title
      const currentTitle = this.trackForm.get('title')?.value;
      if (forceUpdate || !currentTitle) {
        const fileName = fallbackTitle.replace(/\.[^/.]+$/, '');
        const cleanTitle = fileName.replace(/[_-]/g, ' ').trim();
        this.trackForm.patchValue({ title: cleanTitle });
      }
    }
  }

  private setExtractedCoverPreview(cover: { format: string; data: Uint8Array }): void {
    this.clearExtractedCoverPreview();
    const buffer = new Uint8Array(cover.data).buffer;
    const blob = new Blob([buffer], { type: cover.format });
    const objectUrl = URL.createObjectURL(blob);
    this.extractedCoverPreviewObjectUrl = objectUrl;
    this.coverImage.set(objectUrl);
  }

  private async stageExtractedCoverArt(cover: { format: string; data: Uint8Array }): Promise<void> {
    try {
      const buffer = new Uint8Array(cover.data).buffer;
      const blob = new Blob([buffer], { type: cover.format });
      const extension = cover.format.split('/')[1] || 'jpg';
      const file = new File([blob], `cover.${extension}`, { type: cover.format });

      this.pendingCoverFile.set(file);
      this.trackForm.patchValue({ imageUrl: '' });
      this.setExtractedCoverPreview(cover);
      this.snackBar.open('Album art extracted. It will upload when you publish.', 'Close', { duration: 2500 });
    } catch (error) {
      this.logger.error('Error staging extracted cover art:', error);
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
      this.pendingCoverFile.set(file);
      this.trackForm.patchValue({ imageUrl: '' });
      this.clearExtractedCoverPreview();
      this.extractedCoverPreviewObjectUrl = URL.createObjectURL(file);
      this.coverImage.set(this.extractedCoverPreviewObjectUrl);
      this.snackBar.open('Cover image ready. It will upload when you publish.', 'Close', { duration: 2500 });
    } catch (error) {
      this.logger.error('Error preparing image:', error);
      this.snackBar.open('Error preparing image', 'Close', { duration: 3000 });
    } finally {
      this.isUploadingImage.set(false);
    }
  }

  onImageUrlChange(): void {
    const url = String(this.trackForm.get('imageUrl')?.value || '').trim();
    if (url) {
      this.pendingCoverFile.set(null);
      this.clearExtractedCoverPreview();
      this.coverImage.set(url);
    }
  }

  private async uploadPendingAudioIfNeeded(): Promise<{ url: string | null; replacedUrl: string | null }> {
    const file = this.audioFile();
    if (!file) {
      return { url: this.audioUrl(), replacedUrl: null };
    }

    const servers = this.mediaService.mediaServers();
    if (servers.length === 0) {
      this.snackBar.open('No media servers available', 'Close', { duration: 3000 });
      return { url: null, replacedUrl: null };
    }

    this.isUploadingAudio.set(true);
    try {
      const result = await this.mediaService.uploadFile(file, false, servers);
      if (result.status !== 'success' && result.status !== 'duplicate') {
        this.snackBar.open('Failed to upload audio', 'Close', { duration: 3000 });
        return { url: null, replacedUrl: null };
      }

      const url = result.item?.url || null;
      if (!url) {
        this.snackBar.open('Failed to upload audio', 'Close', { duration: 3000 });
        return { url: null, replacedUrl: null };
      }

      const previousUrl = this.previousAudioUrl();
      this.audioUrl.set(url);
      this.audioFile.set(null);
      this.clearLocalAudioPreview();

      return {
        url,
        replacedUrl: this.isEditMode() && previousUrl && previousUrl !== url ? previousUrl : null,
      };
    } catch (error) {
      this.logger.error('Error uploading audio:', error);
      this.snackBar.open('Error uploading audio', 'Close', { duration: 3000 });
      return { url: null, replacedUrl: null };
    } finally {
      this.isUploadingAudio.set(false);
    }
  }

  private async uploadPendingCoverIfNeeded(): Promise<{ url: string | null; replacedUrl: string | null; failed: boolean }> {
    const file = this.pendingCoverFile();
    if (!file) {
      return {
        url: String(this.trackForm.get('imageUrl')?.value || '').trim() || null,
        replacedUrl: null,
        failed: false,
      };
    }

    const servers = this.mediaService.mediaServers();
    if (servers.length === 0) {
      this.snackBar.open('No media servers available', 'Close', { duration: 3000 });
      return { url: null, replacedUrl: null, failed: true };
    }

    this.isUploadingImage.set(true);
    try {
      const result = await this.mediaService.uploadFile(file, false, servers);
      if (result.status !== 'success' && result.status !== 'duplicate') {
        this.snackBar.open('Failed to upload image', 'Close', { duration: 3000 });
        return { url: null, replacedUrl: null, failed: true };
      }

      const url = result.item?.url || null;
      if (!url) {
        this.snackBar.open('Failed to upload image', 'Close', { duration: 3000 });
        return { url: null, replacedUrl: null, failed: true };
      }

      const previousImage = this.previousCoverImage();
      this.pendingCoverFile.set(null);
      this.clearExtractedCoverPreview();
      this.coverImage.set(url);
      this.trackForm.patchValue({ imageUrl: url });

      return {
        url,
        replacedUrl: this.isEditMode() && previousImage && previousImage !== url ? previousImage : null,
        failed: false,
      };
    } catch (error) {
      this.logger.error('Error uploading image:', error);
      this.snackBar.open('Error uploading image', 'Close', { duration: 3000 });
      return { url: null, replacedUrl: null, failed: true };
    } finally {
      this.isUploadingImage.set(false);
    }
  }

  addGenre(value: string): void {
    const trimmed = value.trim();
    if (trimmed && !this.genres().some(g => g.toLowerCase() === trimmed.toLowerCase())) {
      this.genres.update(genres => [...genres, trimmed]);
    }
    this.genreInput.set('');
  }

  onGenreSelected(event: MatAutocompleteSelectedEvent): void {
    this.addGenre(event.option.viewValue);
    event.option.deselect();
  }

  removeGenre(genre: string): void {
    this.genres.update(genres => genres.filter(g => g !== genre));
  }

  async onArtistInputBlur(): Promise<void> {
    await this.resolveArtistFieldFromNpub();
  }

  private normalizeArtistPubkeyInput(value: string): string | null {
    const normalized = value.trim().replace(/^nostr:/i, '').replace(/^@/, '');
    if (!normalized.startsWith('npub1')) {
      return null;
    }

    try {
      const decoded = nip19.decode(normalized);
      if (decoded.type !== 'npub') {
        return null;
      }
      return decoded.data;
    } catch {
      return null;
    }
  }

  private async resolveArtistFieldFromNpub(): Promise<void> {
    const artistControl = this.trackForm.get('artist');
    const artistValue = String(artistControl?.value || '').trim();
    if (!artistValue) {
      return;
    }

    const pubkey = this.normalizeArtistPubkeyInput(artistValue);
    if (!pubkey) {
      return;
    }

    try {
      const profile = await this.dataService.getProfile(pubkey, { deepResolve: true, allowDeepResolve: true });
      const resolvedName = profile?.data?.display_name?.trim() || profile?.data?.name?.trim();
      if (resolvedName) {
        artistControl?.setValue(resolvedName);
      } else {
        this.snackBar.open('Could not resolve artist name from npub', 'Close', { duration: 2500 });
      }
    } catch {
      this.snackBar.open('Could not resolve artist name from npub', 'Close', { duration: 2500 });
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
    if (!this.trackForm.valid || !this.hasAudioSource() || (!this.isEditMode() && !this.agreedToTerms())) {
      return;
    }

    await this.resolveArtistFieldFromNpub();

    // Validate split percentages (empty list is valid - 100% goes to author)
    const splits = this.zapSplits();
    if (splits.length > 0 && this.totalSplitPercentage() !== 100) {
      this.snackBar.open('Zap splits must total 100%', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);

    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.snackBar.open('Not authenticated', 'Close', { duration: 3000 });
        return;
      }

      const uploadedAudio = await this.uploadPendingAudioIfNeeded();
      if (!uploadedAudio.url) {
        return;
      }

      const uploadedCover = await this.uploadPendingCoverIfNeeded();
      if (uploadedCover.failed) {
        return;
      }

      const formValue = this.trackForm.value;

      // In edit mode always preserve the original d tag, including empty values for legacy events.
      // This keeps the same addressable coordinate and prevents duplicates after edits.
      const dTag = this.isEditMode()
        ? this.originalDTag()
        : `track-${Date.now()}`;

      // Build tags
      const tags: string[][] = [
        ['d', dTag],
        ['title', formValue.title],
        ['url', uploadedAudio.url],
        ['t', 'music'],
      ];

      // Add image or gradient
      const imageUrl = uploadedCover.url || String(formValue.imageUrl || '').trim();
      if (imageUrl) {
        tags.push(['image', imageUrl]);
      } else {
        tags.push(['gradient', 'colors', this.currentGradient()]);
      }

      // Add genres
      const genres = this.genres();
      if (genres.length > 0) {
        for (const genre of genres) {
          tags.push(['t', genre.toLowerCase()]);
        }
      }

      // Add artist info
      const artistInput = String(formValue.artist || '').trim();
      let artistDisplay = 'Unknown Artist';

      if (artistInput) {
        tags.push(['artist', artistInput]);
        artistDisplay = artistInput;
      }

      // Add AI generated flag
      if (formValue.aiGenerated) {
        tags.push(['ai_generated', 'true']);
      }

      // Advanced settings
      if (formValue.album) {
        tags.push(['album', formValue.album]);
      }

      const videoUrl = String(formValue.video || '').trim();
      if (videoUrl) {
        tags.push(['video', videoUrl]);
      }

      if (formValue.trackNumber) {
        tags.push(['track_number', String(formValue.trackNumber)]);
      }

      const durationSeconds = formValue.duration
        ? this.parseDurationToSeconds(String(formValue.duration))
        : null;
      if (durationSeconds && durationSeconds > 0) {
        tags.push(['duration', String(durationSeconds)]);
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

      // Add zap splits
      const splits = this.zapSplits();
      if (splits.length > 0) {
        for (const split of splits) {
          if (split.percentage > 0) {
            tags.push(['zap', split.pubkey, 'wss://relay.damus.io', String(split.percentage)]);
          }
        }
      }

      // Add license tag
      if (formValue.license) {
        const licenseName = formValue.license === 'custom'
          ? formValue.customLicense
          : formValue.license;
        if (licenseName) {
          tags.push(['license', licenseName]);
        }
      }

      // Add alt tag for accessibility
      tags.push(['alt', `Music track: ${formValue.title} by ${artistDisplay}`]);

      // Build content (lyrics and credits go here)
      const contentParts: string[] = [];

      if (formValue.lyrics) {
        contentParts.push(`Lyrics:\n${formValue.lyrics}`);
      }

      if (formValue.credits) {
        contentParts.push(`Credits:\n${formValue.credits}`);
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

      // Publish to relays - use custom selection if available, otherwise fall back to preferred relays
      let relayUrls: string[] = [];
      const config = this.relayPublishConfig();
      if (config) {
        // Build unique list from selected config
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
        relayUrls = Array.from(relaySet);
      }

      // Fallback to preferred relays if no custom selection
      if (relayUrls.length === 0) {
        relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      }

      if (relayUrls.length === 0) {
        this.snackBar.open('No relays available', 'Close', { duration: 3000 });
        return;
      }

      let published = false;
      try {
        await this.pool.publish(relayUrls, signedEvent);
        published = true;
      } catch (error) {
        this.logger.warn('Failed to publish:', error);
      }

      if (published) {
        if (uploadedAudio.replacedUrl) {
          setTimeout(() => this.promptDeleteFile('audio track', uploadedAudio.replacedUrl!), 500);
        }

        if (uploadedCover.replacedUrl) {
          setTimeout(() => this.promptDeleteFile('album art', uploadedCover.replacedUrl!), 500);
        }

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
      this.logger.error('Error publishing track:', error);
      this.snackBar.open('Error publishing track', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }

  cancel(): void {
    this.clearLocalAudioPreview();
    this.clearExtractedCoverPreview();
    this.closed.emit(null);
  }

  navigateToMediaSettings(): void {
    this.cancel();
    this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }

  onRelayConfigChanged(config: RelayPublishConfig): void {
    this.relayPublishConfig.set(config);
  }
}
