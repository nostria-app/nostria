import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-image-url-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Enter Image URL</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Image URL</mat-label>
        <input
          matInput
          [(ngModel)]="imageUrl"
          placeholder="https://example.com/image.jpg"
          type="url"
        />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-flat-button color="primary" (click)="onConfirm()" [disabled]="!imageUrl.trim()">
        Add Image
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .full-width {
      width: 100%;
      min-width: 400px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageUrlDialogComponent {
  private dialogRef = inject(MatDialogRef<ImageUrlDialogComponent>);

  imageUrl = '';

  onCancel(): void {
    this.dialogRef.close();
  }

  onConfirm(): void {
    if (this.imageUrl.trim()) {
      this.dialogRef.close(this.imageUrl.trim());
    }
  }
}
