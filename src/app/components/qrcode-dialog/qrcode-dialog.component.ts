import { ChangeDetectionStrategy, Component, AfterViewInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import encodeQR from 'qr';
import { ClipboardService } from '../../services/clipboard.service';

export interface QRCodeDialogData {
  did: string;
  hideToggle?: boolean;
  title?: string;
  mode?: 'default' | 'login' | 'remote-signer';
}

@Component({
  selector: 'app-qrcode-dialog',
  imports: [MatDialogModule, MatButtonModule, MatButtonToggleModule, FormsModule, MatIconModule],
  templateUrl: './qrcode-dialog.component.html',
  styleUrl: './qrcode-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QRCodeDialogComponent implements AfterViewInit {
  private clipboard = inject(ClipboardService);
  data = inject<QRCodeDialogData>(MAT_DIALOG_DATA);

  qrStyle = 'did';

  qrValue = '';

  ngAfterViewInit() {
    this.generateQR(this.data.did);
  }

  async copyValue() {
    await this.clipboard.copyText(this.qrValue);
  }

  generateQR(data: string) {
    this.qrValue = data;

    const canvas = document.querySelector('canvas');
    if (!canvas) {
      console.error('Canvas element not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Could not get canvas context');
      return;
    }

    try {
      // Generate QR code as 2D boolean array
      const qrMatrix = encodeQR(data, 'raw', {
        ecc: 'medium',
        border: 2,
      });

      const qrSize = qrMatrix.length;
      const canvasSize = 256;
      canvas.width = canvasSize;
      canvas.height = canvasSize;

      // Calculate cell size
      const cellSize = Math.floor(canvasSize / qrSize);
      const offset = Math.floor((canvasSize - qrSize * cellSize) / 2);

      // Clear canvas with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw QR code
      ctx.fillStyle = '#000000';
      for (let y = 0; y < qrSize; y++) {
        for (let x = 0; x < qrSize; x++) {
          if (qrMatrix[y][x]) {
            ctx.fillRect(offset + x * cellSize, offset + y * cellSize, cellSize, cellSize);
          }
        }
      }
    } catch (error) {
      console.error('Error generating QR code: ', error);
    }
  }

  onToggleGroupChange() {
    if (this.qrStyle == 'profile') {
      this.generateQR(`https://nostria.app/p/${this.data.did}`);
    } else {
      this.generateQR(this.data.did);
    }
  }
}
