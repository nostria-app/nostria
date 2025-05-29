import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { FeedService, FeedConfig, ColumnConfig } from '../../../services/feed.service';

interface DialogData {
  icons: string[];
  feed?: FeedConfig;
}

// Predefined feed templates with default columns
const FEED_TEMPLATES = [
  {
    key: 'news',
    label: 'News',
    icon: 'newspaper',
    description: 'Stay updated with the latest news and articles',
    defaultColumns: [
      {
        label: 'Articles',
        icon: 'article',
        type: 'articles',
        kinds: [30023], // Long-form content
        relayConfig: 'discovery'
      },
      {
        label: 'Breaking News',
        icon: 'flash_on',
        type: 'notes',
        kinds: [1], // Text notes with news hashtags
        relayConfig: 'discovery'
      }
    ]
  },
  {
    key: 'following',
    label: 'Following',
    icon: 'people',
    description: 'Content from people you follow',
    defaultColumns: [
      {
        label: 'Timeline',
        icon: 'timeline',
        type: 'notes',
        kinds: [1], // Text notes
        relayConfig: 'user'
      },
      {
        label: 'Updates',
        icon: 'update',
        type: 'notes',
        kinds: [0], // Metadata updates
        relayConfig: 'user'
      }
    ]
  },
  {
    key: 'media',
    label: 'Media',
    icon: 'perm_media',
    description: 'Photos, videos, and multimedia content',
    defaultColumns: [
      {
        label: 'Photos',
        icon: 'photo',
        type: 'photos',
        kinds: [1, 20], // Text notes with images, picture events
        relayConfig: 'discovery'
      },
      {
        label: 'Videos',
        icon: 'video_library',
        type: 'videos',
        kinds: [1, 21], // Text notes with videos, video events
        relayConfig: 'discovery'
      }
    ]
  },
  {
    key: 'empty',
    label: 'Empty',
    icon: 'add_box',
    description: 'Start with an empty feed and add your own columns',
    defaultColumns: []
  }
];

@Component({
  selector: 'app-new-feed-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatCardModule,
    MatDividerModule,
    ReactiveFormsModule
  ],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 mat-dialog-title>
          <mat-icon>{{ isEditMode() ? 'edit' : 'stacks' }}</mat-icon>
          {{ isEditMode() ? 'Edit Feed' : 'Create New Feed' }}
        </h2>
        <p class="dialog-subtitle">Choose a feed template or create a custom feed</p>
      </div>

      <form [formGroup]="feedForm" (ngSubmit)="onSubmit()">
        <div class="dialog-content">
          @if (!isEditMode()) {
            <!-- Feed Template Selection -->
            <div class="template-selection">
              <h3>Feed Templates</h3>
              <p class="section-description">Select a template to get started quickly</p>
              
              <div class="template-cards">
                @for (template of feedTemplates(); track template.key) {
                  <mat-card 
                    class="template-card" 
                    [class.selected]="selectedTemplate() === template.key"
                    (click)="selectTemplate(template.key)">
                    <mat-card-content>
                      <div class="template-header">
                        <mat-icon>{{ template.icon }}</mat-icon>
                        <h4>{{ template.label }}</h4>
                      </div>
                      <p class="template-description">{{ template.description }}</p>
                      @if (template.defaultColumns.length > 0) {
                        <div class="template-columns">
                          <span class="columns-label">Includes:</span>
                          @for (column of template.defaultColumns; track $index) {
                            <span class="column-chip">{{ column.label }}</span>
                          }
                        </div>
                      }
                    </mat-card-content>
                  </mat-card>
                }
              </div>
            </div>

            <mat-divider></mat-divider>
          }

          <!-- Basic Feed Configuration -->
          <div class="basic-config">
            <h3>Feed Information</h3>
            
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Feed Name</mat-label>
              <input matInput formControlName="label" placeholder="My Custom Feed">
              <mat-icon matSuffix>label</mat-icon>
              @if (feedForm.get('label')?.hasError('required')) {
                <mat-error>Feed name is required</mat-error>
              }
            </mat-form-field>
            
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Icon</mat-label>
              <mat-select formControlName="icon">
                @for (icon of data.icons; track icon) {
                  <mat-option [value]="icon">
                    <div class="icon-option">
                      <mat-icon>{{ icon }}</mat-icon>
                      <span>{{ icon }}</span>
                    </div>
                  </mat-option>
                }
              </mat-select>
              <mat-icon matSuffix>{{ feedForm.get('icon')?.value || 'dynamic_feed' }}</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Description (Optional)</mat-label>
              <input matInput formControlName="description" placeholder="Brief description of this feed">
              <mat-icon matSuffix>description</mat-icon>
            </mat-form-field>
          </div>          @if (selectedTemplate() && getSelectedTemplateConfig()?.defaultColumns && getSelectedTemplateConfig()!.defaultColumns.length > 0) {
            <mat-divider></mat-divider>
            
            <!-- Template Preview -->
            <div class="template-preview">
              <h3>Columns to be Created</h3>
              <p class="section-description">These columns will be automatically added to your feed</p>
              
              <div class="preview-columns">
                @for (column of getSelectedTemplateConfig()!.defaultColumns; track $index) {
                  <div class="preview-column">
                    <mat-icon>{{ column.icon }}</mat-icon>
                    <div class="column-info">
                      <span class="column-name">{{ column.label }}</span>
                      <span class="column-type">{{ getColumnTypeDescription(column.type) }}</span>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>
        
        <div class="dialog-actions" mat-dialog-actions>
          <button mat-button mat-dialog-close type="button">Cancel</button>
          <button mat-flat-button color="primary" type="submit" [disabled]="!feedForm.valid">
            {{ isEditMode() ? 'Save Changes' : 'Create Feed' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`    .dialog-container {
      width: 100%;
      max-width: 100%;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }

    .dialog-header {
      padding: 24px 24px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.12);

      h2 {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0 0 8px 0;
        font-size: 1.5rem;
        font-weight: 500;
      }

      .dialog-subtitle {
        margin: 0;
        opacity: 0.7;
        font-size: 0.875rem;
      }
    }

    .dialog-content {
      padding: 24px;
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .full-width {
      width: 100%;
    }

    .template-selection {
      h3 {
        margin: 0 0 8px 0;
        font-size: 1.1rem;
        font-weight: 500;
      }

      .section-description {
        margin: 0 0 16px 0;
        opacity: 0.7;
        font-size: 0.875rem;
      }
    }

    .template-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .template-card {
      cursor: pointer;
      transition: all 0.2s ease;
      border: 2px solid transparent;
      height: auto;

      &:hover {
        transform: translateY(-2px);
        box-shadow: var(--mat-sys-level2);
      }

      &.selected {
        border-color: var(--mat-sys-primary);
        background-color: rgba(var(--mat-sys-primary-rgb), 0.04);
      }

      mat-card-content {
        padding: 16px;
      }

      .template-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;

        mat-icon {
          font-size: 1.5rem;
          width: 1.5rem;
          height: 1.5rem;
          color: var(--mat-sys-primary);
        }

        h4 {
          margin: 0;
          font-size: 1rem;
          font-weight: 500;
        }
      }

      .template-description {
        margin: 0 0 12px 0;
        font-size: 0.875rem;
        opacity: 0.7;
        line-height: 1.4;
      }

      .template-columns {
        .columns-label {
          font-size: 0.75rem;
          font-weight: 500;
          opacity: 0.8;
          display: block;
          margin-bottom: 4px;
        }

        .column-chip {
          display: inline-block;
          background-color: rgba(var(--mat-sys-primary-rgb), 0.1);
          color: var(--mat-sys-primary);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 0.7rem;
          margin: 2px 4px 2px 0;
        }
      }
    }

    .basic-config {
      h3 {
        margin: 0 0 16px 0;
        font-size: 1.1rem;
        font-weight: 500;
      }

      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .icon-option {
      display: flex;
      align-items: center;
      gap: 12px;

      mat-icon {
        color: var(--mat-sys-primary);
      }

      span {
        font-weight: 500;
      }
    }

    .template-preview {
      h3 {
        margin: 0 0 8px 0;
        font-size: 1.1rem;
        font-weight: 500;
      }

      .section-description {
        margin: 0 0 16px 0;
        opacity: 0.7;
        font-size: 0.875rem;
      }
    }

    .preview-columns {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .preview-column {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 8px;
      background-color: rgba(0, 0, 0, 0.02);

      mat-icon {
        color: var(--mat-sys-primary);
        font-size: 1.25rem;
        width: 1.25rem;
        height: 1.25rem;
      }

      .column-info {
        display: flex;
        flex-direction: column;
        gap: 2px;

        .column-name {
          font-weight: 500;
          font-size: 0.9rem;
        }

        .column-type {
          font-size: 0.8rem;
          opacity: 0.7;
        }
      }
    }

    .dialog-actions {
      padding: 16px 24px;
      border-top: 1px solid rgba(0, 0, 0, 0.12);
      display: flex;
      gap: 12px;
      justify-content: flex-end;

      button {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    }

    mat-divider {
      margin: 0;
    }
  `]
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
    description: [this.data.feed?.description || '']
  });

  // Signals and state
  isEditMode = signal(!!this.data.feed);
  selectedTemplate = signal<string>('news');
  feedTemplates = signal(FEED_TEMPLATES);

  selectTemplate(templateKey: string): void {
    this.selectedTemplate.set(templateKey);
    
    const template = this.getSelectedTemplateConfig();
    if (template && !this.isEditMode()) {
      // Auto-fill form with template data
      this.feedForm.patchValue({
        label: template.label,
        icon: template.icon,
        description: template.description
      });
    }
  }

  getSelectedTemplateConfig() {
    return this.feedTemplates().find(t => t.key === this.selectedTemplate());
  }

  getColumnTypeDescription(type: string): string {
    const typeDescriptions: Record<string, string> = {
      'notes': 'Text posts and notes',
      'articles': 'Long-form articles',
      'photos': 'Images and photos',
      'videos': 'Video content',
      'custom': 'Custom content'
    };
    return typeDescriptions[type] || type;
  }

  onSubmit(): void {
    if (this.feedForm.valid) {
      const formValue = this.feedForm.value;
      const template = this.getSelectedTemplateConfig();
      
      // Create default columns based on template
      const defaultColumns: ColumnConfig[] = template?.defaultColumns.map(col => ({
        id: crypto.randomUUID(),
        label: col.label,
        icon: col.icon,
        type: col.type as any,
        kinds: col.kinds,
        relayConfig: col.relayConfig as any,
        filters: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      })) || [];

      // Create feed config
      const feedData: FeedConfig = {
        id: this.data.feed?.id || crypto.randomUUID(),
        label: formValue.label!,
        icon: formValue.icon!,
        description: formValue.description || `${formValue.label} feed`,
        columns: defaultColumns,
        createdAt: this.data.feed?.createdAt || Date.now(),
        updatedAt: Date.now()
      };

      this.dialogRef.close(feedData);
    }
  }
}
