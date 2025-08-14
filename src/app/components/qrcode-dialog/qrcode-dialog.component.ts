import { Component, inject, Inject, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatButtonToggleChange,
  MatButtonToggleModule,
} from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import encodeQR from 'qr';

@Component({
  selector: 'app-qrcode-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    FormsModule,
    MatIconModule,
  ],
  templateUrl: './qrcode-dialog.component.html',
  styleUrl: './qrcode-dialog.component.scss',
})
export class QRCodeDialogComponent implements AfterViewInit {
  qrStyle = 'did';

  qrValue = '';

  constructor(@Inject(MAT_DIALOG_DATA) public data: { did: string }) {}

  ngAfterViewInit() {
    this.generateQR(this.data.did);
  }

  async copyValue() {
    await navigator.clipboard.writeText(this.qrValue);
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
            ctx.fillRect(
              offset + x * cellSize,
              offset + y * cellSize,
              cellSize,
              cellSize
            );
          }
        }
      }
    } catch (error) {
      console.error('Error generating QR code: ', error);
    }
  }

  onToggleGroupChange(event: MatButtonToggleChange) {
    if (this.qrStyle == 'profile') {
      this.generateQR(`https://profile.ariton.app/?did=${this.data.did}`);
    } else {
      this.generateQR(this.data.did);
    }
  }
}
