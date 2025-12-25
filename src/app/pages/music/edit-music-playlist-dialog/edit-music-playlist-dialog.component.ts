import { Component, inject, signal, computed, input, output, effect, untracked, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Event, Filter } from 'nostr-tools';
import { MusicPlaylistService, MusicPlaylist } from '../../../services/music-playlist.service';
import { MediaService } from '../../../services/media.service';
import { DataService } from '../../../services/data.service';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UtilitiesService } from '../../../services/utilities.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { NostrRecord } from '../../../interfaces';

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
    DragDropModule,
    ReactiveFormsModule,
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
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  // Media server availability
  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);

  playlistForm: FormGroup;
  isSaving = signal(false);
  isUploading = signal(false);
  coverImage = signal<string | null>(null);
  tracks = signal<TrackItem[]>([]);
  loadingTracks = signal(true);

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
          }

          // Load track details
          this.loadTrackDetails();
        });
      }
    });
  }

  private getRandomGradient(): string {
    return this.gradients[Math.floor(Math.random() * this.gradients.length)];
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
          console.error('No media servers available');
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
        console.error('Failed to upload image:', error);
      } finally {
        this.isUploading.set(false);
      }
    };

    input.click();
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

  async onSubmit(): Promise<void> {
    if (!this.playlistForm.valid || this.isSaving()) return;

    this.isSaving.set(true);

    try {
      const formValue = this.playlistForm.value;
      const newTrackRefs = this.tracks().map(t => t.ref);

      const result = await this.musicPlaylistService.updatePlaylist(this.data().playlist.id, {
        title: formValue.title,
        description: formValue.description || undefined,
        image: formValue.imageUrl || undefined,
        isPublic: formValue.isPublic,
        isCollaborative: formValue.isCollaborative,
        trackRefs: newTrackRefs,
      });

      if (result) {
        this.snackBar.open('Playlist updated!', 'Close', { duration: 2000 });
        this.closed.emit({ updated: true, playlist: result });
      } else {
        this.snackBar.open('Failed to update playlist', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Failed to update playlist:', error);
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
}
