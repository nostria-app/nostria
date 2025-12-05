import { Component, inject, signal, input, output, ChangeDetectionStrategy, effect } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { FeedConfig } from '../../../services/feed.service';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';

@Component({
  selector: 'app-new-feed-dialog',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    ReactiveFormsModule,
    CustomDialogComponent,
  ],
  templateUrl: './new-feed-dialog.component.html',
  styleUrls: ['./new-feed-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewFeedDialogComponent {
  private fb = inject(FormBuilder);

  // Inputs
  icons = input<string[]>([]);
  feed = input<FeedConfig | undefined>(undefined);

  // Outputs
  closed = output<FeedConfig | null>();

  // Form controls - initialized in constructor to access input signals
  feedForm = this.fb.group({
    label: ['', Validators.required],
    icon: ['dynamic_feed'],
    description: [''],
    path: [''],
  });

  // Signals and state
  isEditMode = signal(false);
  private initialized = false;

  constructor() {
    // Use effect to detect when feed input is set (signal inputs aren't available in constructor)
    effect(() => {
      const feedData = this.feed();
      if (feedData && !this.initialized) {
        this.initialized = true;
        this.feedForm.patchValue({
          label: feedData.label || '',
          icon: feedData.icon || 'dynamic_feed',
          description: feedData.description || '',
          path: feedData.path || '',
        });
        this.isEditMode.set(true);
      }
    });
  }

  onClose(): void {
    this.closed.emit(null);
  }

  onSubmit(): void {
    if (this.feedForm.valid) {
      const formValue = this.feedForm.value;
      const existingFeed = this.feed();

      // Create feed config with empty columns array
      const feedData: FeedConfig = {
        id: existingFeed?.id || crypto.randomUUID(),
        label: formValue.label!,
        icon: formValue.icon!,
        path: formValue.path || undefined,
        description: formValue.description || `${formValue.label} feed`,
        columns: existingFeed?.columns || [],
        createdAt: existingFeed?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      this.closed.emit(feedData);
    }
  }
}
