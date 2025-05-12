import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

interface DialogData {
  icons: string[];
  feed?: {
    id?: string;
    label: string;
    icon: string;
    path?: string;
    filters?: Record<string, any>;
  };
}

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
    ReactiveFormsModule
  ],
  template: `
    <h2 mat-dialog-title>{{ isEditMode() ? 'Edit Feed' : 'Add New Feed' }}</h2>
    <form [formGroup]="feedForm" (ngSubmit)="onSubmit()">
      <div mat-dialog-content>
        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Feed Name</mat-label>
          <input matInput formControlName="label" placeholder="My Custom Feed">
          <mat-error *ngIf="feedForm.get('label')?.hasError('required')">
            Feed name is required
          </mat-error>
        </mat-form-field>
        
        <mat-form-field appearance="fill" class="full-width">
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
        </mat-form-field>
        
        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Path (Optional)</mat-label>
          <input matInput formControlName="path" placeholder="custom-feed">
          <mat-hint>URL path for this feed tab</mat-hint>
        </mat-form-field>
      </div>
      
      <div mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-raised-button color="primary" type="submit" [disabled]="!feedForm.valid">
          {{ isEditMode() ? 'Save' : 'Add' }}
        </button>
      </div>
    </form>
  `,
  styles: [`
    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }
    
    .icon-option {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `]
})
export class NewFeedDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<NewFeedDialogComponent>);
  readonly data: DialogData = inject(MAT_DIALOG_DATA);
  
  isEditMode = signal(!!this.data.feed);
  
  feedForm: FormGroup = this.fb.group({
    label: [this.data.feed?.label || '', Validators.required],
    icon: [this.data.feed?.icon || this.data.icons[0]],
    path: [this.data.feed?.path || ''],
    filters: [this.data.feed?.filters || {}]
  });

  onSubmit(): void {
    if (this.feedForm.valid) {
      this.dialogRef.close(this.feedForm.value);
    }
  }
}
