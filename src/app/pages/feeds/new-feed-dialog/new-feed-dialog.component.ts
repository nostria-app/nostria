import { Component, inject, signal } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { FeedService, FeedConfig, ColumnConfig } from '../../../services/feed.service';
import { kinds } from 'nostr-tools';

interface DialogData {
  icons: string[];
  feed?: FeedConfig;
}

// Predefined feed templates with default columns
const FEED_TEMPLATES = [
  {
    key: 'following',
    label: 'Following',
    icon: 'dynamic_feed',
    path: 'following',
    description: 'Content from people you follow',
    defaultColumns: [
      {
        label: 'Notes',
        icon: 'notes',
        type: 'notes',
        kinds: [kinds.ShortTextNote, kinds.Repost],
        source: 'following',
        relayConfig: 'account',
      },
      {
        label: 'Articles',
        icon: 'article',
        type: 'articles',
        kinds: [kinds.LongFormArticle],
        source: 'following',
        relayConfig: 'account',
      },
    ],
  },
  {
    key: 'media',
    label: 'Media',
    icon: 'perm_media',
    path: 'media',
    description: 'Photos, videos, and multimedia content',
    defaultColumns: [
      {
        label: 'Photos',
        icon: 'photo',
        type: 'photos',
        kinds: [20],
        source: 'following',
        relayConfig: 'discovery',
      },
      {
        label: 'Videos',
        icon: 'video_library',
        type: 'videos',
        kinds: [21, 22],
        source: 'following',
        relayConfig: 'discovery',
      },
    ],
  },
  {
    key: 'empty',
    label: 'Empty',
    icon: 'add_box',
    description: 'Start with an empty feed and add your own columns',
    defaultColumns: [],
  },
];

@Component({
  selector: 'app-new-feed-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatCardModule,
    MatDividerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './new-feed-dialog.component.html',
  styleUrls: ['./new-feed-dialog.component.scss'],
})
export class NewFeedDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<NewFeedDialogComponent>);
  private feedService = inject(FeedService);
  readonly data: DialogData = inject(MAT_DIALOG_DATA);

  // Form controls
  feedForm = this.fb.group({
    label: [this.data.feed?.label || '', Validators.required],
    icon: [this.data.feed?.icon || 'dynamic_feed'],
    description: [this.data.feed?.description || ''],
    path: [this.data.feed?.path || ''],
  });

  // Signals and state
  isEditMode = signal(!!this.data.feed);
  selectedTemplate = signal<string>('empty');
  feedTemplates = signal(FEED_TEMPLATES);

  selectTemplate(templateKey: string): void {
    this.selectedTemplate.set(templateKey);

    const template = this.getSelectedTemplateConfig();
    if (template && !this.isEditMode()) {
      // Auto-fill form with template data
      this.feedForm.patchValue({
        label: template.label,
        icon: template.icon,
        path: template.path,
        description: template.description,
      });
    }
  }

  getSelectedTemplateConfig() {
    return this.feedTemplates().find((t) => t.key === this.selectedTemplate());
  }

  getColumnTypeDescription(type: string): string {
    const typeDescriptions: Record<string, string> = {
      notes: 'Text posts and notes',
      articles: 'Long-form articles',
      photos: 'Images and photos',
      videos: 'Video content',
      custom: 'Custom content',
    };
    return typeDescriptions[type] || type;
  }

  onSubmit(): void {
    if (this.feedForm.valid) {
      debugger;
      const formValue = this.feedForm.value;
      const template = this.getSelectedTemplateConfig();

      // Create default columns based on template
      const defaultColumns: ColumnConfig[] =
        template?.defaultColumns.map((col) => ({
          id: crypto.randomUUID(),
          label: col.label,
          icon: col.icon,
          type: col.type as any,
          kinds: col.kinds,
          source: col.source as any,
          relayConfig: col.relayConfig as any,
          filters: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })) || [];

      // Create feed config
      const feedData: FeedConfig = {
        id: this.data.feed?.id || crypto.randomUUID(),
        label: formValue.label!,
        icon: formValue.icon!,
        path: formValue.path || undefined,
        description: formValue.description || `${formValue.label} feed`,
        columns: defaultColumns,
        createdAt: this.data.feed?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      this.dialogRef.close(feedData);
    }
  }
}
