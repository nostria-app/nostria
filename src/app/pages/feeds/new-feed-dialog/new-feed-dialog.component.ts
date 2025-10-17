import { Component, inject, signal } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { FeedConfig } from '../../../services/feed.service';

interface DialogData {
  icons: string[];
  feed?: FeedConfig;
}

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
    ReactiveFormsModule,
  ],
  templateUrl: './new-feed-dialog.component.html',
  styleUrls: ['./new-feed-dialog.component.scss'],
})
export class NewFeedDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<NewFeedDialogComponent>);
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

  onSubmit(): void {
    if (this.feedForm.valid) {
      const formValue = this.feedForm.value;

      // Create feed config with empty columns array
      const feedData: FeedConfig = {
        id: this.data.feed?.id || crypto.randomUUID(),
        label: formValue.label!,
        icon: formValue.icon!,
        path: formValue.path || undefined,
        description: formValue.description || `${formValue.label} feed`,
        columns: this.data.feed?.columns || [],
        createdAt: this.data.feed?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      this.dialogRef.close(feedData);
    }
  }
}
