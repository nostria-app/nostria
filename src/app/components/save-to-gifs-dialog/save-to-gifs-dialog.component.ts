import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CollectionSetsService, EmojiSet } from '../../services/collection-sets.service';
import { AccountStateService } from '../../services/account-state.service';
import { MediaService } from '../../services/media.service';
import { LoggerService } from '../../services/logger.service';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';

export interface SaveToGifsDialogData {
  imageUrls: string[];
}

export interface SaveToGifsDialogResult {
  shortcode: string;
  imageUrl: string;
  setIdentifier: string;
  isNewSet: boolean;
  newSetName?: string;
}

@Component({
  selector: 'app-save-to-gifs-dialog',
  imports: [
    MaterialCustomDialogComponent,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule,
    ReactiveFormsModule,
  ],
  template: `
    <app-material-custom-dialog
      title="Save to Gifs Set"
      icon="gif_box"
      [showDefaultActions]="false"
      [showCloseButton]="false"
    >
      <div dialog-content>
        @if (imageUrls().length > 1) {
          <p class="subtitle">Select an image to save</p>
          <div class="image-grid">
            @for (url of imageUrls(); track url) {
              <button class="image-option" type="button" [class.selected]="selectedImageUrl() === url" (click)="selectImage(url)">
                <img [src]="url" alt="Meme" />
              </button>
            }
          </div>
        } @else if (imageUrls().length === 1) {
          <div class="image-preview">
            <img [src]="imageUrls()[0]" alt="Meme" />
          </div>
        }

        <div class="source-url">
          <mat-icon class="source-url-icon">link</mat-icon>
          <span class="source-url-text">{{ selectedImageUrl() }}</span>
        </div>

        <mat-checkbox [formControl]="uploadCopyControl" class="upload-checkbox">
          Upload a copy to my media server
        </mat-checkbox>
        @if (uploadCopyControl.value && !hasMediaServers()) {
          <p class="no-server-warning">
            <mat-icon>warning</mat-icon>
            No media servers configured. Go to Settings to add one.
          </p>
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Meme name (shortcode)</mat-label>
          <input
            matInput
            [formControl]="shortcodeControl"
            placeholder="e.g., laughing_cat, deal_with_it"
            (keyup.enter)="onSave()"
            autocomplete="off"
          />
          @if (shortcodeControl.hasError('required')) {
            <mat-error>Name is required</mat-error>
          }
          @if (shortcodeControl.hasError('pattern')) {
            <mat-error>Only letters, numbers, underscores and hyphens</mat-error>
          }
        </mat-form-field>

        @if (!creatingNewSet()) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Gifs Set</mat-label>
            <mat-select [formControl]="setControl">
              @for (set of gifsSets(); track set.identifier) {
                <mat-option [value]="set.identifier">{{ set.name }} ({{ set.emojis.length }})</mat-option>
              }
              <mat-option value="__new__">
                <mat-icon>add_circle</mat-icon> Create new gifs set
              </mat-option>
            </mat-select>
          </mat-form-field>
        }

        @if (creatingNewSet()) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>New gifs set name</mat-label>
            <input
              matInput
              [formControl]="newSetNameControl"
              placeholder="e.g., My Memes, Reaction Gifs"
              autocomplete="off"
            />
            @if (newSetNameControl.hasError('required')) {
              <mat-error>Set name is required</mat-error>
            }
          </mat-form-field>
          <button mat-button type="button" (click)="cancelNewSet()">
            <mat-icon>arrow_back</mat-icon> Choose existing set
          </button>
        }
      </div>

      <div dialog-actions>
        <button mat-button type="button" (click)="onCancel()">Cancel</button>
        <button
          mat-flat-button
          type="button"
          class="primary"
          (click)="onSave()"
          [disabled]="!canSave() || saving()"
        >
          @if (saving()) {
            <mat-spinner diameter="20"></mat-spinner>
          } @else {
            Save
          }
        </button>
      </div>
    </app-material-custom-dialog>
  `,
  styles: [`
    .subtitle {
      margin-bottom: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .image-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .image-option {
      border: 2px solid transparent;
      border-radius: var(--mat-sys-corner-small);
      padding: 2px;
      cursor: pointer;
      background: none;
      max-width: 120px;

      &.selected {
        border-color: var(--mat-sys-primary);
      }

      img {
        max-width: 100%;
        max-height: 80px;
        border-radius: var(--mat-sys-corner-extra-small);
        object-fit: cover;
      }
    }

    .image-preview {
      text-align: center;
      margin-bottom: 16px;

      img {
        max-width: 100%;
        max-height: 150px;
        border-radius: var(--mat-sys-corner-small);
        object-fit: contain;
      }
    }

    .source-url {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 10px;
      margin-bottom: 12px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-surface-container);
      border: 1px solid var(--mat-sys-outline-variant);

      .source-url-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-top: 1px;
        color: var(--mat-sys-on-surface-variant);
      }

      .source-url-text {
        font-size: 12px;
        word-break: break-all;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.4;
      }
    }

    .upload-checkbox {
      display: block;
      margin-bottom: 16px;
    }

    .no-server-warning {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--mat-sys-error);
      margin: -8px 0 12px 0;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .full-width {
      width: 100%;
    }

    .dialog-content {
      min-width: 300px;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveToGifsDialogComponent {
  private dialogRef = inject(MatDialogRef<SaveToGifsDialogComponent>);
  private dialogData = inject<SaveToGifsDialogData>(MAT_DIALOG_DATA);
  private collectionSets = inject(CollectionSetsService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private media = inject(MediaService);
  private logger = inject(LoggerService);

  imageUrls = signal<string[]>(this.dialogData.imageUrls);
  selectedImageUrl = signal<string>(this.dialogData.imageUrls[0] ?? '');
  gifsSets = signal<EmojiSet[]>([]);
  saving = signal(false);

  shortcodeControl = new FormControl('', [Validators.required, Validators.pattern(/^[a-zA-Z0-9_-]+$/)]);
  setControl = new FormControl('', Validators.required);
  newSetNameControl = new FormControl('', Validators.required);
  uploadCopyControl = new FormControl(false);

  creatingNewSet = signal(false);
  hasMediaServers = computed(() => this.media.mediaServers().length > 0);

  constructor() {
    this.loadGifsSets();

    this.setControl.valueChanges.subscribe(value => {
      if (value === '__new__') {
        this.creatingNewSet.set(true);
        this.setControl.reset('', { emitEvent: false });
      }
    });
  }

  private async loadGifsSets(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const sets = await this.collectionSets.getGifsSets(pubkey);
    this.gifsSets.set(sets);

    // If no sets exist, default to creating a new one; otherwise auto-select the first
    if (sets.length === 0) {
      this.creatingNewSet.set(true);
    } else {
      this.setControl.setValue(sets[0].identifier);
    }
  }

  selectImage(url: string): void {
    this.selectedImageUrl.set(url);
  }

  cancelNewSet(): void {
    if (this.gifsSets().length > 0) {
      this.creatingNewSet.set(false);
      this.newSetNameControl.reset('');
    }
  }

  canSave(): boolean {
    if (!this.shortcodeControl.valid) return false;
    if (!this.selectedImageUrl()) return false;
    if (this.creatingNewSet()) return this.newSetNameControl.valid;
    return this.setControl.valid;
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  async onSave(): Promise<void> {
    if (!this.canSave() || this.saving()) return;

    this.saving.set(true);

    try {
      const shortcode = this.shortcodeControl.value!.trim();
      let imageUrl = this.selectedImageUrl();

      // Upload a copy to media server if requested
      if (this.uploadCopyControl.value) {
        const uploadedUrl = await this.uploadImageCopy(imageUrl);
        if (uploadedUrl) {
          imageUrl = uploadedUrl;
        } else {
          this.snackBar.open('Failed to upload copy, using original URL', 'Close', { duration: 3000 });
        }
      }

      if (this.creatingNewSet()) {
        const newSetName = this.newSetNameControl.value!.trim();
        const identifier = this.generateRandomId();
        const success = await this.collectionSets.saveEmojiSet(
          identifier,
          newSetName,
          [{ shortcode, url: imageUrl }],
          ['gifs']
        );

        if (success) {
          this.snackBar.open(`Saved to new gifs set "${newSetName}"`, 'Close', { duration: 3000 });
          this.dialogRef.close({ shortcode, imageUrl, setIdentifier: identifier, isNewSet: true, newSetName });
        } else {
          this.snackBar.open('Failed to create gifs set', 'Close', { duration: 3000 });
        }
      } else {
        const setIdentifier = this.setControl.value!;
        const success = await this.collectionSets.addEmojiToSet(setIdentifier, { shortcode, url: imageUrl });

        if (success) {
          const set = this.gifsSets().find(s => s.identifier === setIdentifier);
          this.snackBar.open(`Saved to "${set?.name ?? 'gifs set'}"`, 'Close', { duration: 3000 });
          this.dialogRef.close({ shortcode, imageUrl, setIdentifier, isNewSet: false });
        } else {
          this.snackBar.open('Failed to save to gifs set', 'Close', { duration: 3000 });
        }
      }
    } catch {
      this.snackBar.open('Error saving to gifs set', 'Close', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  private async uploadImageCopy(url: string): Promise<string | null> {
    try {
      await this.media.load();
      const servers = this.media.mediaServers();
      if (servers.length === 0) return null;

      const response = await fetch(url);
      if (!response.ok) return null;

      const blob = await response.blob();
      const extension = url.split('?')[0].split('.').pop() || 'jpg';
      const file = new File([blob], `meme.${extension}`, { type: blob.type || 'image/jpeg' });

      const result = await this.media.uploadFile(file, false, servers);
      if ((result.status === 'success' || result.status === 'duplicate') && result.item) {
        return result.item.url;
      }
      return null;
    } catch (err) {
      this.logger.error('Failed to upload image copy:', err);
      return null;
    }
  }

  private generateRandomId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    for (const byte of array) {
      result += chars[byte % chars.length];
    }
    return result;
  }
}
