import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';

export interface ImageCropperDialogData {
  /** The image file to crop */
  file: File;
  /** Visual shape of the crop area. Output is always rectangular. */
  shape?: 'circle' | 'rect';
  /** Width / height ratio of the crop area. Defaults to 1. */
  aspectRatio?: number;
  /** Dialog title */
  title?: string;
  /** Maximum width of the produced image in pixels. Defaults to 1024. */
  maxOutputWidth?: number;
}

export interface ImageCropperResult {
  /** The cropped image, ready for upload */
  file: File;
  /** Object URL preview of the cropped image. Caller owns revocation. */
  previewUrl: string;
  /** True when the user chose to keep the original file untouched */
  usedOriginal: boolean;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

@Component({
  selector: 'app-image-cropper-dialog',
  imports: [
    FormsModule,
    MaterialCustomDialogComponent,
    MatButtonModule,
    MatIconModule,
    MatSliderModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './image-cropper-dialog.component.html',
  styleUrl: './image-cropper-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageCropperDialogComponent implements OnDestroy {
  private readonly dialogRef = inject(MatDialogRef<ImageCropperDialogComponent, ImageCropperResult>);
  private readonly data = inject<ImageCropperDialogData>(MAT_DIALOG_DATA);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');

  readonly title = this.data.title ?? 'Adjust image';
  readonly shape = this.data.shape ?? 'circle';
  readonly aspectRatio = this.data.aspectRatio && this.data.aspectRatio > 0 ? this.data.aspectRatio : 1;
  private readonly maxOutputWidth = this.data.maxOutputWidth ?? 1024;

  /** Animated images cannot be cropped without losing the animation */
  readonly isAnimated = /gif|apng/i.test(this.data.file.type);

  readonly imageUrl = signal<string | null>(null);
  readonly loading = signal(true);
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);

  /** Natural image size */
  private readonly naturalWidth = signal(0);
  private readonly naturalHeight = signal(0);

  /** Crop viewport size in CSS pixels */
  private readonly viewportWidth = signal(0);
  private readonly viewportHeight = signal(0);

  /** User controlled zoom, relative to the "cover" fit */
  readonly zoom = signal(1);
  /** Rotation in degrees, always a multiple of 90 */
  readonly rotation = signal(0);
  /** Offset of the image center from the viewport center, in CSS pixels */
  private readonly offsetX = signal(0);
  private readonly offsetY = signal(0);

  readonly minZoom = MIN_ZOOM;
  readonly maxZoom = MAX_ZOOM;

  /** Image size after rotation is applied (swapped for 90/270 degrees) */
  private readonly rotatedWidth = computed(() =>
    this.isQuarterTurned() ? this.naturalHeight() : this.naturalWidth()
  );
  private readonly rotatedHeight = computed(() =>
    this.isQuarterTurned() ? this.naturalWidth() : this.naturalHeight()
  );

  private isQuarterTurned(): boolean {
    return this.rotation() % 180 !== 0;
  }

  /** Scale that makes the rotated image exactly cover the viewport */
  private readonly coverScale = computed(() => {
    const w = this.rotatedWidth();
    const h = this.rotatedHeight();
    const vw = this.viewportWidth();
    const vh = this.viewportHeight();
    if (!w || !h || !vw || !vh) return 1;
    return Math.max(vw / w, vh / h);
  });

  private readonly scale = computed(() => this.coverScale() * this.zoom());

  /** CSS transform applied to the <img> element */
  readonly imageTransform = computed(() => {
    const s = this.scale();
    return `translate(-50%, -50%) translate(${this.offsetX()}px, ${this.offsetY()}px) rotate(${this.rotation()}deg) scale(${s})`;
  });

  private resizeObserver?: ResizeObserver;
  private objectUrl?: string;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; ox: number; oy: number } | null = null;
  private pinchStart: { distance: number; zoom: number; midX: number; midY: number; ox: number; oy: number } | null =
    null;

  constructor() {
    if (this.isBrowser) {
      this.objectUrl = URL.createObjectURL(this.data.file);
      this.imageUrl.set(this.objectUrl);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }

  onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    this.naturalWidth.set(img.naturalWidth);
    this.naturalHeight.set(img.naturalHeight);
    this.loading.set(false);
    this.observeViewport();
  }

  onImageError(): void {
    this.loading.set(false);
    this.error.set('The selected image could not be loaded.');
  }

  private observeViewport(): void {
    if (this.resizeObserver || !this.isBrowser) return;
    const element = this.viewportRef().nativeElement;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      this.viewportWidth.set(rect.width);
      this.viewportHeight.set(rect.height);
      this.clampOffset();
    };
    measure();
    this.resizeObserver = new ResizeObserver(measure);
    this.resizeObserver.observe(element);
  }

  // ---------------------------------------------------------------- gestures

  onPointerDown(event: PointerEvent): void {
    if (this.loading() || this.error()) return;
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 1) {
      this.dragStart = { x: event.clientX, y: event.clientY, ox: this.offsetX(), oy: this.offsetY() };
    } else if (this.pointers.size === 2) {
      this.dragStart = null;
      this.beginPinch();
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    if (!this.dragStart) return;
    event.preventDefault();
    this.offsetX.set(this.dragStart.ox + (event.clientX - this.dragStart.x));
    this.offsetY.set(this.dragStart.oy + (event.clientY - this.dragStart.y));
    this.clampOffset();
  }

  onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    this.pinchStart = null;
    if (this.pointers.size === 1) {
      const [remaining] = [...this.pointers.values()];
      this.dragStart = { x: remaining.x, y: remaining.y, ox: this.offsetX(), oy: this.offsetY() };
    } else {
      this.dragStart = null;
    }
  }

  onWheel(event: WheelEvent): void {
    if (this.loading() || this.error()) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY / 500);
    const rect = this.viewportRef().nativeElement.getBoundingClientRect();
    this.zoomAround(
      this.zoom() * factor,
      event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2
    );
  }

  onKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 20 : 5;
    switch (event.key) {
      case 'ArrowLeft':
        this.offsetX.update(v => v + step);
        break;
      case 'ArrowRight':
        this.offsetX.update(v => v - step);
        break;
      case 'ArrowUp':
        this.offsetY.update(v => v + step);
        break;
      case 'ArrowDown':
        this.offsetY.update(v => v - step);
        break;
      case '+':
      case '=':
        this.zoomAround(this.zoom() * 1.1, 0, 0);
        return;
      case '-':
      case '_':
        this.zoomAround(this.zoom() / 1.1, 0, 0);
        return;
      default:
        return;
    }
    event.preventDefault();
    this.clampOffset();
  }

  onZoomSliderChange(value: number): void {
    this.zoomAround(value, 0, 0);
  }

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    const rect = this.viewportRef().nativeElement.getBoundingClientRect();
    this.pinchStart = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: this.zoom(),
      midX: (a.x + b.x) / 2 - rect.left - rect.width / 2,
      midY: (a.y + b.y) / 2 - rect.top - rect.height / 2,
      ox: this.offsetX(),
      oy: this.offsetY(),
    };
  }

  private updatePinch(): void {
    if (!this.pinchStart) {
      this.beginPinch();
      return;
    }
    const [a, b] = [...this.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    this.offsetX.set(this.pinchStart.ox);
    this.offsetY.set(this.pinchStart.oy);
    this.zoom.set(this.pinchStart.zoom);
    this.zoomAround(
      this.pinchStart.zoom * (distance / this.pinchStart.distance),
      this.pinchStart.midX,
      this.pinchStart.midY
    );
  }

  /** Zoom while keeping the image point under (cx, cy) — relative to viewport center — fixed. */
  private zoomAround(nextZoom: number, cx: number, cy: number): void {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    const ratio = clamped / this.zoom();
    this.zoom.set(clamped);
    this.offsetX.set(cx - (cx - this.offsetX()) * ratio);
    this.offsetY.set(cy - (cy - this.offsetY()) * ratio);
    this.clampOffset();
  }

  rotate(): void {
    this.rotation.update(v => (v + 90) % 360);
    this.offsetX.set(0);
    this.offsetY.set(0);
    this.clampOffset();
  }

  reset(): void {
    this.zoom.set(1);
    this.rotation.set(0);
    this.offsetX.set(0);
    this.offsetY.set(0);
  }

  /** Keep the image covering the whole crop area */
  private clampOffset(): void {
    const s = this.scale();
    const maxX = Math.max(0, (this.rotatedWidth() * s - this.viewportWidth()) / 2);
    const maxY = Math.max(0, (this.rotatedHeight() * s - this.viewportHeight()) / 2);
    this.offsetX.update(v => Math.min(maxX, Math.max(-maxX, v)));
    this.offsetY.update(v => Math.min(maxY, Math.max(-maxY, v)));
  }

  // ------------------------------------------------------------------ output

  cancel(): void {
    this.dialogRef.close();
  }

  useOriginal(): void {
    this.dialogRef.close({
      file: this.data.file,
      previewUrl: URL.createObjectURL(this.data.file),
      usedOriginal: true,
    });
  }

  async apply(): Promise<void> {
    if (this.processing() || this.loading() || this.error()) return;
    this.processing.set(true);
    try {
      const blob = await this.renderCrop();
      const file = new File([blob], this.outputFileName(blob.type), {
        type: blob.type,
        lastModified: Date.now(),
      });
      this.dialogRef.close({ file, previewUrl: URL.createObjectURL(blob), usedOriginal: false });
    } catch {
      this.error.set('Failed to process the image. Try using the original instead.');
      this.processing.set(false);
    }
  }

  private async renderCrop(): Promise<Blob> {
    const vw = this.viewportWidth();
    const vh = this.viewportHeight();
    const s = this.scale();
    if (!vw || !vh || !s) throw new Error('Cropper is not ready');

    // Crop rectangle expressed in the rotated image coordinate system.
    const sw = vw / s;
    const sh = vh / s;
    const sx = this.rotatedWidth() / 2 - (vw / 2 + this.offsetX()) / s;
    const sy = this.rotatedHeight() / 2 - (vh / 2 + this.offsetY()) / s;

    const outWidth = Math.max(1, Math.round(Math.min(this.maxOutputWidth, sw)));
    const outHeight = Math.max(1, Math.round(outWidth / this.aspectRatio));

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not supported');
    ctx.imageSmoothingQuality = 'high';

    const image = await this.loadImageElement();

    // Draw into the rotated coordinate space so the source rect maths stay simple.
    ctx.save();
    ctx.translate(outWidth / 2, outHeight / 2);
    ctx.scale(outWidth / sw, outHeight / sh);
    ctx.translate(-(sx + sw / 2), -(sy + sh / 2));
    ctx.translate(this.rotatedWidth() / 2, this.rotatedHeight() / 2);
    ctx.rotate((this.rotation() * Math.PI) / 180);
    ctx.drawImage(image, -this.naturalWidth() / 2, -this.naturalHeight() / 2);
    ctx.restore();

    const type = this.data.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, type, type === 'image/jpeg' ? 0.92 : undefined)
    );
    if (!blob) throw new Error('Failed to encode image');
    return blob;
  }

  private loadImageElement(): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = this.imageUrl();
      if (!url) {
        reject(new Error('No image'));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
  }

  private outputFileName(type: string): string {
    const extension = type === 'image/png' ? 'png' : 'jpg';
    const base = this.data.file.name.replace(/\.[^.]+$/, '') || 'image';
    return `${base}-cropped.${extension}`;
  }
}
