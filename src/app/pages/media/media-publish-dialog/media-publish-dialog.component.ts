import { Component, inject, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MediaItem } from '../../../services/media.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface MediaPublishDialogData {
  mediaItem: MediaItem;
}

export interface MediaPublishOptions {
  kind: 20 | 21 | 22; // 20 = picture, 21 = video, 22 = short video
  title: string;
  content: string;
  alt?: string;
  contentWarning?: string;
  hashtags: string[];
  location?: string;
  geohash?: string;
  duration?: number; // For videos (in seconds)
}

@Component({
  selector: 'app-media-publish-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatIconModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
  ],
  templateUrl: './media-publish-dialog.component.html',
  styleUrls: ['./media-publish-dialog.component.scss'],
})
export class MediaPublishDialogComponent {
  private dialogRef = inject(MatDialogRef<MediaPublishDialogComponent>);
  data: MediaPublishDialogData = inject(MAT_DIALOG_DATA);

  // Form fields
  kind = signal<20 | 21 | 22>(this.getDefaultKind());
  title = signal('');
  content = signal('');
  alt = signal('');
  contentWarning = signal('');
  hashtags = signal<string[]>([]);
  location = signal('');
  geohash = signal('');
  duration = signal<number | undefined>(undefined);

  // UI state
  hashtagInput = signal('');
  publishing = signal(false);

  // Computed
  isImage = (): boolean => {
    return this.data.mediaItem.type?.startsWith('image') || false;
  };

  isVideo = (): boolean => {
    return this.data.mediaItem.type?.startsWith('video') || false;
  };

  canPublish = (): boolean => {
    return this.title().trim().length > 0 && !this.publishing();
  };

  private getDefaultKind(): 20 | 21 | 22 {
    const mediaType = this.data.mediaItem.type;

    if (mediaType?.startsWith('image')) {
      return 20; // Picture event
    } else if (mediaType?.startsWith('video')) {
      // Default to kind 21 (normal video), user can change to 22 (short video)
      return 21;
    }

    // Default to picture
    return 20;
  }

  getAvailableKinds(): { value: 20 | 21 | 22; label: string; description: string }[] {
    if (this.isImage()) {
      return [
        { value: 20, label: 'Picture (kind 20)', description: 'Standard image post' }
      ];
    } else if (this.isVideo()) {
      return [
        { value: 21, label: 'Video (kind 21)', description: 'Normal/horizontal video' },
        { value: 22, label: 'Short Video (kind 22)', description: 'Short/vertical video (stories, reels)' }
      ];
    }

    return [
      { value: 20, label: 'Picture (kind 20)', description: 'Standard image post' }
    ];
  }

  addHashtag(): void {
    const tag = this.hashtagInput().trim();
    if (tag && !this.hashtags().includes(tag)) {
      this.hashtags.set([...this.hashtags(), tag]);
      this.hashtagInput.set('');
    }
  }

  removeHashtag(tag: string): void {
    this.hashtags.set(this.hashtags().filter(t => t !== tag));
  }

  onHashtagInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addHashtag();
    }
  }

  onDurationInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    this.duration.set(value ? parseFloat(value) : undefined);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  publish(): void {
    if (!this.canPublish()) {
      return;
    }

    const options: MediaPublishOptions = {
      kind: this.kind(),
      title: this.title().trim(),
      content: this.content().trim(),
      hashtags: this.hashtags(),
    };

    // Add optional fields if provided
    if (this.alt().trim()) {
      options.alt = this.alt().trim();
    }

    if (this.contentWarning().trim()) {
      options.contentWarning = this.contentWarning().trim();
    }

    if (this.location().trim()) {
      options.location = this.location().trim();
    }

    if (this.geohash().trim()) {
      options.geohash = this.geohash().trim();
    }

    if (this.duration() !== undefined && this.duration()! > 0) {
      options.duration = this.duration();
    }

    this.dialogRef.close(options);
  }
}
