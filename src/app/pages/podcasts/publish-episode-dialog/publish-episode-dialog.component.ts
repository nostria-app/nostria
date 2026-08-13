import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { ImageInputComponent } from '../../../components/image-input/image-input.component';
import { AccountStateService } from '../../../services/account-state.service';
import { MediaService } from '../../../services/media.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DatabaseService } from '../../../services/database.service';
import { NostrService } from '../../../services/nostr.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import {
  buildPodcastEpisodeTags,
  isValidHttpUrl,
  PODCAST_EPISODE_KIND,
} from '../../../utils/podcast';

@Component({
  selector: 'app-publish-episode-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CustomDialogComponent,
    ImageInputComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './publish-episode-dialog.component.html',
  styleUrl: './publish-episode-dialog.component.scss',
})
export class PublishEpisodeDialogComponent implements OnDestroy {
  closed = output<{ published: boolean } | null>();

  private fb = inject(FormBuilder);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private podcastData = inject(PodcastDataService);
  private media = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  readonly title = $localize`:@@podcasts.publish.dialogTitle:Publish episode`;
  readonly coverLabel = $localize`:@@podcasts.publish.cover:Cover image`;
  readonly changeAudioLabel = $localize`:@@podcasts.publish.changeAudio:Change file`;
  readonly isSaving = signal(false);
  readonly isUploadingAudio = signal(false);
  readonly isDraggingAudio = signal(false);
  readonly audioFile = signal<File | null>(null);
  readonly audioUrl = signal('');
  readonly audioType = signal('');
  readonly coverImage = signal('');
  readonly showExternalUrlInput = signal(false);
  readonly externalUrlValue = signal('');
  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: [''],
    content: [''],
  });

  readonly hasMediaServers = computed(() => this.media.mediaServers().length > 0);
  readonly showFullForm = computed(() => !!this.audioFile() || !!this.audioUrl());
  readonly audioPreviewUrl = computed(() => this.audioUrl() || this.localAudioPreviewUrl());

  private localAudioPreviewUrl = signal('');
  private localAudioPreviewObjectUrl: string | null = null;

  ngOnDestroy(): void {
    this.clearLocalAudioPreview();
  }

  selectAudioFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        this.handleAudioFile(file);
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

  onAudioDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingAudio.set(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('audio/')) {
      this.snackBar.open($localize`:@@podcasts.publish.dropAudio:Drop an audio file`, '', { duration: 3000 });
      return;
    }
    this.handleAudioFile(file);
  }

  toggleExternalUrlInput(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.showExternalUrlInput.update(value => !value);
  }

  applyExternalUrl(): void {
    const url = this.externalUrlValue().trim();
    if (!isValidHttpUrl(url)) {
      this.snackBar.open($localize`:@@podcasts.publish.invalidAudio:Enter a valid audio URL`, '', { duration: 3000 });
      return;
    }

    this.setRemoteAudio(url);
    this.showExternalUrlInput.set(false);
    this.externalUrlValue.set('');
    this.prefillTitleFromName(this.filenameFromUrl(url));
  }

  async openAudioLibrary(): Promise<void> {
    if (!this.requireMediaServer()) {
      return;
    }

    const { MediaChooserDialogComponent } = await import(
      '../../../components/media-chooser-dialog/media-chooser-dialog.component'
    );
    type MediaChooserResult = import(
      '../../../components/media-chooser-dialog/media-chooser-dialog.component'
    ).MediaChooserResult;

    const dialogRef = this.dialog.open(MediaChooserDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'media-chooser-dialog-panel'],
      width: '700px',
      maxWidth: '95vw',
      data: { multiple: false, mediaType: 'files' },
    });

    dialogRef.afterClosed().subscribe((result: MediaChooserResult | undefined) => {
      const selected = result?.items?.[0];
      if (!selected?.url) {
        return;
      }

      this.setRemoteAudio(selected.url, selected.type);
      this.prefillTitleFromName(this.filenameFromUrl(selected.url));
    });
  }

  navigateToMediaSettings(): void {
    this.close(null);
    void this.router.navigate(['/media'], { queryParams: { tab: 'servers' } });
  }

  async publish(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open($localize`:@@podcasts.publish.signIn:Sign in to publish an episode`, '', { duration: 3000 });
      return;
    }

    this.isSaving.set(true);
    try {
      const audio = await this.resolveAudioUrl();
      if (!audio) {
        return;
      }

      const value = this.form.getRawValue();
      const tags = buildPodcastEpisodeTags({
        title: value.title,
        audioUrl: audio.url,
        audioType: audio.type,
        imageUrl: this.coverImage(),
        description: value.description,
      });

      const signed = await this.nostr.signEvent({
        kind: PODCAST_EPISODE_KIND,
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        content: value.content.trim(),
        tags,
      });
      await this.database.saveEvent(signed);
      this.podcastData.addEpisode(signed);
      await this.accountRelay.publish(signed);
      this.close({ published: true });
    } catch {
      this.snackBar.open($localize`:@@podcasts.publish.failed:Failed to publish episode`, '', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  close(result: { published: boolean } | null): void {
    this.closed.emit(result);
  }

  private handleAudioFile(file: File): void {
    this.clearLocalAudioPreview();
    this.audioFile.set(file);
    this.audioUrl.set('');
    this.audioType.set(file.type);
    this.localAudioPreviewObjectUrl = URL.createObjectURL(file);
    this.localAudioPreviewUrl.set(this.localAudioPreviewObjectUrl);
    this.prefillTitleFromName(file.name);
    this.snackBar.open(
      $localize`:@@podcasts.publish.audioReady:Audio ready. It will upload when you publish.`,
      '',
      { duration: 2500 }
    );
  }

  private setRemoteAudio(url: string, type?: string): void {
    this.clearLocalAudioPreview();
    this.audioFile.set(null);
    this.audioUrl.set(url);
    this.audioType.set(type || '');
  }

  private async resolveAudioUrl(): Promise<{ url: string; type?: string } | null> {
    const existingUrl = this.audioUrl().trim();
    const file = this.audioFile();
    if (!file) {
      if (!isValidHttpUrl(existingUrl)) {
        this.snackBar.open($localize`:@@podcasts.publish.invalidAudio:Enter a valid audio URL`, '', { duration: 3000 });
        return null;
      }
      return { url: existingUrl, type: this.audioType() || undefined };
    }

    if (!this.requireMediaServer()) {
      return null;
    }

    this.isUploadingAudio.set(true);
    try {
      const result = await this.media.uploadFile(file, false, this.media.mediaServers());
      if ((result.status !== 'success' && result.status !== 'duplicate') || !result.item?.url) {
        this.snackBar.open(result.message || $localize`:@@podcasts.publish.uploadFailed:Failed to upload audio`, '', {
          duration: 4000,
        });
        return null;
      }

      this.setRemoteAudio(result.item.url, file.type);
      return { url: result.item.url, type: file.type || undefined };
    } finally {
      this.isUploadingAudio.set(false);
    }
  }

  private requireMediaServer(): boolean {
    if (this.hasMediaServers()) {
      return true;
    }

    this.snackBar
      .open($localize`:@@podcasts.publish.needMediaServer:Configure a media server to upload audio`, $localize`:@@podcasts.publish.configure:Configure`, {
        duration: 5000,
      })
      .onAction()
      .subscribe(() => this.navigateToMediaSettings());
    return false;
  }

  private prefillTitleFromName(name: string): void {
    if (this.form.controls.title.value.trim()) {
      return;
    }

    const cleaned = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    if (cleaned) {
      this.form.controls.title.setValue(cleaned);
    }
  }

  private filenameFromUrl(url: string): string {
    try {
      const rawName = new URL(url).pathname.split('/').pop() || '';
      return decodeURIComponent(rawName) || url;
    } catch {
      return url;
    }
  }

  private clearLocalAudioPreview(): void {
    if (this.localAudioPreviewObjectUrl) {
      URL.revokeObjectURL(this.localAudioPreviewObjectUrl);
      this.localAudioPreviewObjectUrl = null;
    }
    this.localAudioPreviewUrl.set('');
  }
}
