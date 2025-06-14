import { Component, inject, signal } from '@angular/core';

import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ZXingScannerModule } from '@sondreb/ngx-scanner';

@Component({
  selector: 'app-qrcode-scan-dialog',
  templateUrl: './qrcode-scan-dialog.component.html',
  styleUrls: ['./qrcode-scan-dialog.component.scss'],
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, ZXingScannerModule]
})
export class QrcodeScanDialogComponent {
  private dialogRef = inject(MatDialogRef<QrcodeScanDialogComponent>);
  
  availableCameras = signal<MediaDeviceInfo[]>([]);
  currentCameraIndex = signal<number>(0);
  currentDevice = signal<MediaDeviceInfo | null>(null);

  scanSuccessHandler(result: string) {
    this.dialogRef.close(result);
  }

  scanErrorHandler(error: Error) {
    console.error('Scan error:', error);
  }

  scanFailureHandler(error: any) {
    console.warn('Scan failure:', error);
  }

  scanCompleteHandler(result: any) {
    // Optional handling for scan complete
  }

  camerasFoundHandler(devices: MediaDeviceInfo[]) {
    if (devices && devices.length > 0) {
      this.availableCameras.set(devices);
      this.currentDevice.set(devices[this.currentCameraIndex()]);
    }
  }

  switchCamera() {
    const cameras = this.availableCameras();
    if (cameras.length <= 1) return;
    
    const nextIndex = (this.currentCameraIndex() + 1) % cameras.length;
    this.currentCameraIndex.set(nextIndex);
    this.currentDevice.set(cameras[nextIndex]);
  }
}
