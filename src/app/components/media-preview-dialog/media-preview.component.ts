import { CommonModule } from "@angular/common";
import { Component, Inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";

export interface MediaPreviewDialogData {
    mediaUrl: string,
    mediaType?: string,
    mediaTitle?: string
}

@Component({
    selector: 'app-media-preview-dialog',
    standalone: true,
    imports: [CommonModule, MatButtonModule, MatIconModule],
    template: `
      <div class="dialog-container">
        <button mat-icon-button class="close-button" (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
        <img [src]="data.mediaUrl" [alt]="data.mediaUrl" class="full-size-image">
      </div>
    `,
    styles: `
      .dialog-container {
        position: relative;
        padding: 0;
        overflow: hidden;
        text-align: center;
        background-color: rgba(0, 0, 0, 0.8);
        border-radius: 0;
      }
      
      .close-button {
        position: absolute;
        top: 10px;
        right: 10px;
        color: white;
        z-index: 10;
        background-color: rgba(0, 0, 0, 0.5);
      }
      
      .full-size-image {
        max-width: 90vw;
        max-height: 90vh;
        object-fit: contain;
      }
    `
})
export class MediaPreviewDialogComponent {
    constructor(
        @Inject(MAT_DIALOG_DATA) public data: MediaPreviewDialogData,
        private dialogRef: MatDialogRef<MediaPreviewDialogComponent>
    ) { }

    close(): void {
        this.dialogRef.close();
    }
}
