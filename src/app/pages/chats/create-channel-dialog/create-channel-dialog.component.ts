import { Component, inject, signal, computed, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MediaService } from '../../../services/media.service';
import { CustomDialogRef, CustomDialogService } from '../../../services/custom-dialog.service';
import { AccountRelayService } from '../../../services/relays/account-relay';

export interface CreateChannelDialogData {
  name?: string;
  about?: string;
  picture?: string;
  tags?: string[];
  relays?: string[];
  isEdit?: boolean;
}

export interface CreateChannelDialogResult {
  name: string;
  about: string;
  picture: string;
  tags: string[];
  relays: string[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-create-channel-dialog',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  template: `
    <div dialog-content class="channel-dialog-content">
      <p class="dialog-description">
        {{ data?.isEdit ? 'Update your chat details.' : 'Create a new public chat.' }}
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Chat Name</mat-label>
        <input
          matInput
          [formControl]="nameControl"
          placeholder="e.g., General, Nostr Dev, Photography"
          (keyup.enter)="onSubmit()"
          autocomplete="off"
        />
        @if (nameControl.hasError('required')) {
          <mat-error>Chat name is required</mat-error>
        }
        @if (nameControl.hasError('maxlength')) {
          <mat-error>Must not exceed 100 characters</mat-error>
        }
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Description</mat-label>
        <textarea
          matInput
          [formControl]="aboutControl"
          placeholder="What is this chat about?"
          rows="3"
        ></textarea>
        @if (aboutControl.hasError('maxlength')) {
          <mat-error>Must not exceed 500 characters</mat-error>
        }
      </mat-form-field>

      <div class="picture-section">
        <label class="picture-label">Chat Picture</label>

        @if (previewImage()) {
          <div class="preview-container">
            <img [src]="previewImage()" class="picture-preview" alt="Chat picture preview" />
            <button mat-icon-button class="remove-preview" (click)="removeImage()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }

        <div class="picture-actions">
          <button mat-stroked-button type="button" (click)="pictureFileInput.click()" [disabled]="uploading()">
            <mat-icon>upload</mat-icon>
            Upload Image
          </button>
          <button mat-stroked-button type="button" (click)="openMediaLibrary()" [disabled]="uploading()">
            <mat-icon>photo_library</mat-icon>
            Media Library
          </button>
          <button mat-stroked-button type="button" (click)="showUrlInput.set(!showUrlInput())" [disabled]="uploading()">
            <mat-icon>link</mat-icon>
            Custom URL
          </button>
          <input #pictureFileInput type="file" hidden accept="image/*" (change)="onFileSelected($event)" />
        </div>

        @if (uploading()) {
          <div class="upload-progress">
            <mat-spinner diameter="20"></mat-spinner>
            <span>Uploading...</span>
          </div>
        }

        @if (showUrlInput()) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Picture URL</mat-label>
            <input
              matInput
              [formControl]="pictureControl"
              placeholder="https://example.com/image.png"
              autocomplete="off"
              (blur)="onUrlChange()"
            />
            <mat-icon matPrefix>image</mat-icon>
          </mat-form-field>
        }
      </div>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Tags</mat-label>
        <input
          matInput
          [formControl]="tagInputControl"
          placeholder="Type a tag and press Enter"
          (keydown.enter)="addTag($event)"
          autocomplete="off"
        />
        <mat-icon matPrefix>label</mat-icon>
        <mat-hint>Press Enter to add a tag</mat-hint>
      </mat-form-field>

      @if (tags().length > 0) {
        <mat-chip-set class="tags-chip-set">
          @for (tag of tags(); track tag) {
            <mat-chip (removed)="removeTag(tag)">
              {{ tag }}
              <button matChipRemove>
                <mat-icon>cancel</mat-icon>
              </button>
            </mat-chip>
          }
        </mat-chip-set>
      }

      <div class="relays-section">
        <label class="relays-label">
          <mat-icon>wifi</mat-icon>
          Chat Relays
        </label>
        <p class="relays-description">
          Make sure the first relay in the list is a publicly accessible relay, it will be used as relay hint for messages. Keep the list as low as possible, 3-5 is enough. If you add more, every user has to publish every message to all relays.
        </p>

        @if (relays().length > 0) {
          <div class="relay-chips">
            @for (relay of relays(); track relay) {
              <div class="relay-chip">
                <span class="relay-url">{{ formatRelayUrl(relay) }}</span>
                <button mat-icon-button class="remove-relay-btn" (click)="removeRelay(relay)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>
        } @else {
          <p class="no-relays-hint">No relays configured. Add at least one relay.</p>
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Add relay</mat-label>
          <input
            matInput
            [formControl]="relayInputControl"
            placeholder="wss://relay.example.com"
            (keydown.enter)="addRelay($event)"
            autocomplete="off"
          />
          <mat-icon matPrefix>dns</mat-icon>
          <mat-hint>Press Enter to add a relay</mat-hint>
        </mat-form-field>
      </div>
    </div>
    <div dialog-actions class="channel-dialog-actions">
      <span></span>
      <div class="action-buttons">
        <button mat-button (click)="onCancel()">Cancel</button>
        <button
          mat-flat-button
          (click)="onSubmit()"
          [disabled]="nameControl.invalid"
        >
          {{ data?.isEdit ? 'Save' : 'Create' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .channel-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .full-width {
      width: 100%;
    }

    .dialog-description {
      margin-bottom: 16px;
      color: var(--mat-sys-on-surface-variant);
    }

    mat-icon[matPrefix] {
      margin-right: 8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .picture-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 8px;
    }

    .picture-label {
      font-size: 14px;
      color: var(--mat-sys-on-surface-variant);
    }

    .preview-container {
      position: relative;
      display: inline-block;
      align-self: center;
    }

    .picture-preview {
      max-width: 120px;
      max-height: 120px;
      border-radius: 8px;
      object-fit: cover;
    }

    .remove-preview {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 24px;
      height: 24px;
      line-height: 24px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .picture-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .picture-actions button {
      font-size: 13px;
    }

    .upload-progress {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px;
    }

    .tags-chip-set {
      margin-bottom: 8px;
    }

    .relays-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }

    .relays-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .relays-description {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .relay-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .relay-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 12px;
      border-radius: 16px;
      font-size: 0.875rem;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);

      .relay-url {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .remove-relay-btn {
        width: 24px;
        height: 24px;
        padding: 0 !important;
        display: flex !important;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }
    }

    .no-relays-hint {
      font-size: 12px;
      color: var(--mat-sys-error);
      margin: 0;
      font-style: italic;
    }

    .channel-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .action-buttons {
      display: flex;
      gap: 8px;
    }
  `],
})
export class CreateChannelDialogComponent implements OnInit {
  dialogRef?: CustomDialogRef<CreateChannelDialogComponent, CreateChannelDialogResult>;

  private _data: CreateChannelDialogData = {};
  get data(): CreateChannelDialogData { return this._data; }
  set data(value: CreateChannelDialogData) {
    this._data = value;
    if (value) {
      this.nameControl.setValue(value.name ?? '');
      this.aboutControl.setValue(value.about ?? '');
      this.pictureControl.setValue(value.picture ?? '');
      this.tags.set(value.tags ?? []);
      this.previewImage.set(value.picture || null);
      if (value.relays && value.relays.length > 0) {
        this.relays.set([...value.relays]);
      } else {
        // Pre-populate with user's account relays
        this.relays.set([...this.accountRelay.getRelayUrls()]);
      }
      this.relaysInitialized = true;
    }
  }

  private mediaService = inject(MediaService);
  private customDialog = inject(CustomDialogService);
  private snackBar = inject(MatSnackBar);
  private accountRelay = inject(AccountRelayService);

  nameControl = new FormControl('', [
    Validators.required,
    Validators.maxLength(100),
  ]);

  aboutControl = new FormControl('', [
    Validators.maxLength(500),
  ]);

  pictureControl = new FormControl('');

  tagInputControl = new FormControl('');

  relayInputControl = new FormControl('');

  tags = signal<string[]>([]);
  relays = signal<string[]>([]);
  relaysInitialized = false;
  previewImage = signal<string | null>(null);
  showUrlInput = signal(false);
  uploading = signal(false);

  hasMediaServers = computed(() => this.mediaService.mediaServers().length > 0);

  ngOnInit(): void {
    // For the create case (no data set), pre-populate relays with account relays
    if (!this.relaysInitialized) {
      this.relays.set([...this.accountRelay.getRelayUrls()]);
    }
  }

  addTag(event: Event): void {
    event.preventDefault();
    const value = this.tagInputControl.value?.trim().toLowerCase();
    if (value && !this.tags().includes(value)) {
      this.tags.update(tags => [...tags, value]);
    }
    this.tagInputControl.setValue('');
  }

  removeTag(tag: string): void {
    this.tags.update(tags => tags.filter(t => t !== tag));
  }

  addRelay(event: Event): void {
    event.preventDefault();
    let url = this.relayInputControl.value?.trim() ?? '';
    if (!url) return;

    // Add wss:// if missing
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = 'wss://' + url;
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      this.snackBar.open('Invalid relay URL', 'Close', { duration: 3000 });
      return;
    }

    // Normalize: ensure trailing slash for comparison
    const normalized = url.endsWith('/') ? url : url + '/';

    // Check if already exists (compare with and without trailing slash)
    const exists = this.relays().some(r => {
      const rNorm = r.endsWith('/') ? r : r + '/';
      return rNorm === normalized;
    });

    if (!exists) {
      this.relays.update(relays => [...relays, url]);
    }
    this.relayInputControl.setValue('');
  }

  removeRelay(relay: string): void {
    this.relays.update(relays => relays.filter(r => r !== relay));
  }

  formatRelayUrl(url: string): string {
    return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      this.snackBar.open('Please select a valid image file', 'Close', { duration: 3000 });
      return;
    }

    this.uploadFile(file);
    input.value = '';
  }

  async uploadFile(file: File): Promise<void> {
    if (!this.hasMediaServers()) {
      this.snackBar.open('No media servers configured. Go to Media settings to add one.', 'Close', { duration: 5000 });
      return;
    }

    this.uploading.set(true);
    try {
      const result = await this.mediaService.uploadFile(file, false, []);
      if (result.status === 'success' || result.status === 'duplicate') {
        const url = result.item?.url ?? '';
        if (url) {
          this.pictureControl.setValue(url);
          this.previewImage.set(url);
          this.showUrlInput.set(false);
        }
      } else {
        this.snackBar.open(result.message || 'Upload failed', 'Close', { duration: 5000 });
      }
    } catch (err) {
      this.snackBar.open('Failed to upload image', 'Close', { duration: 3000 });
    } finally {
      this.uploading.set(false);
    }
  }

  async openMediaLibrary(): Promise<void> {
    const { MediaChooserDialogComponent } = await import('../../../components/media-chooser-dialog/media-chooser-dialog.component');
    type MediaChooserResult = import('../../../components/media-chooser-dialog/media-chooser-dialog.component').MediaChooserResult;

    const dialogRef = this.customDialog.open<typeof MediaChooserDialogComponent.prototype, MediaChooserResult>(MediaChooserDialogComponent, {
      title: 'Choose from Library',
      width: '700px',
      maxWidth: '95vw',
      data: { multiple: false, mediaType: 'images' },
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result?.items?.length) {
        const url = result.items[0].url;
        this.pictureControl.setValue(url);
        this.previewImage.set(url);
        this.showUrlInput.set(false);
      }
    });
  }

  onUrlChange(): void {
    const url = this.pictureControl.value?.trim();
    this.previewImage.set(url || null);
  }

  removeImage(): void {
    this.pictureControl.setValue('');
    this.previewImage.set(null);
  }

  onSubmit(): void {
    if (this.nameControl.valid) {
      const result: CreateChannelDialogResult = {
        name: this.nameControl.value!.trim(),
        about: this.aboutControl.value?.trim() ?? '',
        picture: this.pictureControl.value?.trim() ?? '',
        tags: this.tags(),
        relays: this.relays(),
      };
      this.dialogRef?.close(result);
    }
  }

  onCancel(): void {
    this.dialogRef?.close();
  }
}
