import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';

@Component({
  selector: 'app-image-url-dialog',
  imports: [
    FormsModule,
    MaterialCustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <app-material-custom-dialog
      title="Enter Image URL"
      icon="image"
      [showDefaultActions]="false"
      [showCloseButton]="false"
    >
      <div dialog-content>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Image URL</mat-label>
          <input
            matInput
            [(ngModel)]="imageUrl"
            placeholder="https://example.com/image.jpg"
            type="url"
          />
        </mat-form-field>
      </div>

      <div dialog-actions>
        <button mat-button type="button" (click)="onCancel()">Cancel</button>
        <button mat-flat-button type="button" class="primary" (click)="onConfirm()" [disabled]="!imageUrl.trim()">
          Add Image
        </button>
      </div>
    </app-material-custom-dialog>
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
