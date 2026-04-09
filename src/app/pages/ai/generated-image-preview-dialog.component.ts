import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CustomDialogRef } from '../../services/custom-dialog.service';
import { AiGeneratedImage } from '../../services/ai.service';

interface GeneratedImagePreviewDialogData {
  image: AiGeneratedImage;
}

@Component({
  selector: 'app-generated-image-preview-dialog',
  imports: [CommonModule],
  template: `
    <div dialog-content class="generated-image-preview-dialog">
      @if (data?.image; as image) {
      <img class="generated-image-preview-dialog-image" [src]="image.src" [alt]="image.revisedPrompt || image.prompt" />
      <div class="generated-image-preview-dialog-copy">
        <div class="generated-image-preview-dialog-meta">
          <span>{{ image.providerLabel }}</span>
          <span>{{ image.model }}</span>
        </div>
        <p>{{ image.revisedPrompt || image.prompt }}</p>
      </div>
      }
    </div>
  `,
  styles: `
    .generated-image-preview-dialog {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 0;
      background: var(--mat-sys-surface);
    }

    .generated-image-preview-dialog-image {
      display: block;
      width: 100%;
      max-height: min(76vh, 960px);
      object-fit: contain;
      border-radius: 18px;
      background: var(--mat-sys-surface-container);
    }

    .generated-image-preview-dialog-copy {
      display: flex;
      flex-direction: column;
      gap: 8px;
      color: var(--mat-sys-on-surface);
    }

    .generated-image-preview-dialog-copy p {
      margin: 0;
    }

    .generated-image-preview-dialog-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.84rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneratedImagePreviewDialogComponent {
  readonly dialogRef = inject(CustomDialogRef<GeneratedImagePreviewDialogComponent, void>);

  data: GeneratedImagePreviewDialogData | null = null;
}