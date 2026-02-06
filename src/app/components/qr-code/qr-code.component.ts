import {
  Component,
  input,
  effect,
  signal,
  ElementRef,
  ViewChild,
  AfterViewInit,
  inject,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import encodeQR from 'qr';

@Component({
  selector: 'qr-code',
  template: `
    @if (mode() === 'canvas') {
      <canvas #qrCanvas></canvas>
    } @else {
      <div [innerHTML]="svgData()"></div>
    }
  `,
  styleUrl: './qr-code.component.scss',
})
export class QrCodeComponent implements AfterViewInit {
  @ViewChild('qrCanvas', { static: false })
  canvas!: ElementRef<HTMLCanvasElement>;

  qrdata = input.required<string>();
  width = input<number>(256);
  height = input<number>();
  errorCorrectionLevel = input<'low' | 'medium' | 'quartile' | 'high'>('medium');
  mode = input<'canvas' | 'svg'>('svg');
  border = input<number>(2);
  svgData = signal<SafeHtml>('');

  private sanitizer = inject(DomSanitizer);

  ngAfterViewInit() {
    // Generate QR code when component initializes
    this.generateQR();
  }

  constructor() {
    // React to input changes
    effect(() => {
      this.generateQR();
    });
  }

  private generateQR() {
    const data = this.qrdata();
    if (!data) return;

    try {
      if (this.mode() === 'canvas') {
        this.generateCanvasQR();
      } else {
        this.generateSvgQR();
      }
    } catch (error) {
      console.error('Error generating QR code:', error);
    }
  }

  private generateCanvasQR() {
    if (!this.canvas?.nativeElement) return;

    const canvas = this.canvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = this.qrdata();
    const size = this.width();
    const border = this.border();

    // Generate QR code as 2D boolean array
    const qrMatrix = encodeQR(data, 'raw', {
      ecc: this.errorCorrectionLevel(),
      border,
    });

    const qrSize = qrMatrix.length;
    canvas.width = size;
    canvas.height = this.height() || size;

    // Calculate cell size
    const cellSize = Math.floor(size / qrSize);
    const offset = Math.floor((size - qrSize * cellSize) / 2);

    // Clear canvas
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
  }

  private generateSvgQR() {
    const data = this.qrdata();
    const size = this.width();

    const svg = encodeQR(data, 'svg', {
      ecc: this.errorCorrectionLevel(),
      border: this.border(),
      scale: Math.floor(size / 25), // Approximate scale based on typical QR size
    });

    // Sanitize the SVG data
    this.svgData.set(this.sanitizer.bypassSecurityTrustHtml(svg));
  }
}
