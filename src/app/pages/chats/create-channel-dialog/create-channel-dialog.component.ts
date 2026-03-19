import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';

export interface CreateChannelDialogData {
  name?: string;
  about?: string;
  picture?: string;
  tags?: string[];
  isEdit?: boolean;
}

export interface CreateChannelDialogResult {
  name: string;
  about: string;
  picture: string;
  tags: string[];
}

@Component({
  selector: 'app-create-channel-dialog',
  imports: [
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data?.isEdit ? 'Edit Channel' : 'Create Channel' }}</h2>
    <mat-dialog-content>
      <p class="dialog-description">
        {{ data?.isEdit ? 'Update your channel details.' : 'Create a new public chat channel.' }}
      </p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Channel Name</mat-label>
        <input
          matInput
          [formControl]="nameControl"
          placeholder="e.g., General, Nostr Dev, Photography"
          (keyup.enter)="onSubmit()"
          autocomplete="off"
        />
        @if (nameControl.hasError('required')) {
          <mat-error>Channel name is required</mat-error>
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
          placeholder="What is this channel about?"
          rows="3"
        ></textarea>
        @if (aboutControl.hasError('maxlength')) {
          <mat-error>Must not exceed 500 characters</mat-error>
        }
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Picture URL</mat-label>
        <input
          matInput
          [formControl]="pictureControl"
          placeholder="https://example.com/image.png"
          autocomplete="off"
        />
        <mat-icon matPrefix>image</mat-icon>
      </mat-form-field>

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
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-flat-button
        (click)="onSubmit()"
        [disabled]="nameControl.invalid"
      >
        {{ data?.isEdit ? 'Save' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
    }

    mat-dialog-content {
      min-width: 400px;
      padding-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .dialog-description {
      margin-bottom: 16px;
      color: var(--mat-sys-on-surface-variant);
    }

    mat-icon[matPrefix] {
      margin-right: 8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .tags-chip-set {
      margin-bottom: 8px;
    }

    @media (max-width: 500px) {
      mat-dialog-content {
        min-width: unset;
      }
    }
  `],
})
export class CreateChannelDialogComponent {
  private dialogRef = inject(MatDialogRef<CreateChannelDialogComponent>);
  readonly data = inject<CreateChannelDialogData>(MAT_DIALOG_DATA, { optional: true });

  nameControl = new FormControl(this.data?.name ?? '', [
    Validators.required,
    Validators.maxLength(100),
  ]);

  aboutControl = new FormControl(this.data?.about ?? '', [
    Validators.maxLength(500),
  ]);

  pictureControl = new FormControl(this.data?.picture ?? '');

  tagInputControl = new FormControl('');

  tags = signal<string[]>(this.data?.tags ?? []);

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

  onSubmit(): void {
    if (this.nameControl.valid) {
      const result: CreateChannelDialogResult = {
        name: this.nameControl.value!.trim(),
        about: this.aboutControl.value?.trim() ?? '',
        picture: this.pictureControl.value?.trim() ?? '',
        tags: this.tags(),
      };
      this.dialogRef.close(result);
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}
