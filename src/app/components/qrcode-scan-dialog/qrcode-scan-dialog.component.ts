import {
  Component,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { frontalCamera, QRCanvas, frameLoop } from 'qr/dom';

@Component({
  selector: 'app-qrcode-scan-dialog',
  templateUrl: './qrcode-scan-dialog.component.html',
  styleUrls: ['./qrcode-scan-dialog.component.scss'],
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
})
export class QrcodeScanDialogComponent implements AfterViewInit, OnDestroy {
  private dialogRef = inject(MatDialogRef<QrcodeScanDialogComponent>);

  @ViewChild('videoElement', { static: false })
  videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement', { static: false })
  canvasElement!: ElementRef<HTMLCanvasElement>;

  availableCameras = signal<{ deviceId: string; label: string }[]>([]);
  currentCameraIndex = signal<number>(0);
  currentDevice = signal<{ deviceId: string; label: string } | null>(null);
  isScanning = signal<boolean>(false);
  errorMessage = signal<string>('');

  private camera: any = null;
  private qrCanvas: QRCanvas | null = null;
  private frameLoopCancel: (() => void) | null = null;

  async ngAfterViewInit() {
    // Add a small delay to ensure the dialog is fully rendered
    setTimeout(async () => {
      try {
        await this.initializeCamera();
      } catch (error) {
        console.error('Failed to initialize camera:', error);

        // Provide more specific error messages
        if (error instanceof Error) {
          if (error.name === 'NotAllowedError') {
            this.errorMessage.set(
              'Camera access denied. Please allow camera permissions and try again.'
            );
          } else if (error.name === 'NotFoundError') {
            this.errorMessage.set(
              'No camera found. Please ensure a camera is connected.'
            );
          } else if (error.name === 'NotSupportedError') {
            this.errorMessage.set('Camera not supported in this browser.');
          } else if (error.name === 'NotReadableError') {
            this.errorMessage.set(
              'Camera is already in use by another application. Close other apps using the camera and try a different camera below.'
            );
          } else {
            this.errorMessage.set(`Camera error: ${error.message}`);
          }
        } else {
          this.errorMessage.set(
            'Failed to access camera. Please ensure camera permissions are granted.'
          );
        }

        // Try to list available cameras even if initialization failed
        try {
          await this.listAvailableCameras();
        } catch (listError) {
          console.error('Failed to list cameras:', listError);
        }
      }
    }, 100);
  }

  ngOnDestroy() {
    this.stopScanning();
  }

  private async listAvailableCameras() {
    try {
      // Get available media devices without initializing a camera
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${devices.indexOf(device) + 1}`,
        }));

      this.availableCameras.set(videoDevices);
      console.log('Available cameras (fallback):', videoDevices);
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
    }
  }

  private async initializeCamera() {
    try {
      console.log('Initializing camera...');
      const video = this.videoElement.nativeElement;
      const canvas = this.canvasElement.nativeElement;

      console.log('Video element:', video);
      console.log('Canvas element:', canvas);

      // Initialize QR canvas
      this.qrCanvas = new QRCanvas({ overlay: canvas });
      console.log('QR Canvas initialized');

      // Initialize camera with retry logic
      console.log('Calling frontalCamera...');
      this.camera = await this.initializeCameraWithRetry(video);
      console.log('Camera initialized:', this.camera);

      // Get available cameras
      console.log('Getting device list...');
      const devices = await this.camera.listDevices();
      console.log('Available devices:', devices);
      this.availableCameras.set(devices);

      if (devices.length > 0) {
        this.currentDevice.set(devices[0]);
        console.log('Setting device to:', devices[0]);
        await this.camera.setDevice(devices[0].deviceId);
      }

      // Start scanning
      console.log('Starting scanning...');
      this.startScanning();
    } catch (error) {
      console.error('Error in initializeCamera:', error);
      throw error;
    }
  }

  private async initializeCameraWithRetry(
    video: HTMLVideoElement,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Camera initialization attempt ${attempt}/${maxRetries}`);

        // If this is a retry, wait a bit before trying again
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }

        const camera = await frontalCamera(video);
        console.log(`Camera initialized successfully on attempt ${attempt}`);
        return camera;
      } catch (error) {
        console.error(
          `Camera initialization attempt ${attempt} failed:`,
          error
        );
        lastError = error as Error;

        // If it's a NotReadableError, try to list available devices and suggest switching
        if (error instanceof Error && error.name === 'NotReadableError') {
          await this.listAvailableCameras();

          // If we have multiple cameras available, don't retry with the same one
          if (this.availableCameras().length > 1 && attempt < maxRetries) {
            console.log(
              'Multiple cameras available, will try with different camera on next attempt'
            );
          }
        }

        // Don't retry for permission errors
        if (error instanceof Error && error.name === 'NotAllowedError') {
          throw error;
        }
      }
    }

    // If all retries failed, throw the last error
    throw (
      lastError ||
      new Error('Camera initialization failed after multiple attempts')
    );
  }

  private startScanning() {
    if (!this.camera || !this.qrCanvas) return;

    this.isScanning.set(true);

    this.frameLoopCancel = frameLoop(() => {
      if (!this.camera || !this.qrCanvas) return;

      try {
        const result = this.camera.readFrame(this.qrCanvas);
        if (result) {
          this.onScanSuccess(result);
        }
      } catch (error) {
        console.error('Scan error:', error);
      }
    });
  }

  private stopScanning() {
    this.isScanning.set(false);

    if (this.frameLoopCancel) {
      this.frameLoopCancel();
      this.frameLoopCancel = null;
    }

    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }
  }

  private onScanSuccess(result: string) {
    this.stopScanning();
    this.dialogRef.close(result);
  }

  async switchCamera() {
    const cameras = this.availableCameras();
    if (cameras.length <= 1 || !this.camera) return;

    const nextIndex = (this.currentCameraIndex() + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];

    try {
      await this.camera.setDevice(nextCamera.deviceId);
      this.currentCameraIndex.set(nextIndex);
      this.currentDevice.set(nextCamera);
    } catch (error) {
      console.error('Failed to switch camera:', error);
      this.errorMessage.set('Failed to switch camera');
    }
  }

  async tryDifferentCamera(deviceId?: string) {
    this.errorMessage.set('');

    try {
      // Stop current camera if it exists
      if (this.camera) {
        this.camera.stop();
        this.camera = null;
      }

      const video = this.videoElement.nativeElement;

      if (deviceId) {
        // Try specific camera
        console.log('Trying specific camera:', deviceId);

        // Create camera with specific device
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
        });

        video.srcObject = stream;
        await video.play();

        // Initialize with the existing stream
        this.camera = {
          readFrame: (canvas: any) =>
            canvas.drawImage(video, video.videoHeight, video.videoWidth),
          stop: () => {
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
          },
          listDevices: () => this.listAvailableCameras(),
          setDevice: (newDeviceId: string) =>
            this.tryDifferentCamera(newDeviceId),
        };

        // Update current device
        const device = this.availableCameras().find(
          d => d.deviceId === deviceId
        );
        if (device) {
          this.currentDevice.set(device);
          this.currentCameraIndex.set(this.availableCameras().indexOf(device));
        }
      } else {
        // Try default camera initialization
        this.camera = await frontalCamera(video);
        const devices = await this.camera.listDevices();
        this.availableCameras.set(devices);

        if (devices.length > 0) {
          this.currentDevice.set(devices[0]);
          this.currentCameraIndex.set(0);
        }
      }

      // Initialize QR canvas if not already done
      if (!this.qrCanvas) {
        const canvas = this.canvasElement.nativeElement;
        this.qrCanvas = new QRCanvas({ overlay: canvas });
      }

      // Start scanning
      this.startScanning();
    } catch (error) {
      console.error('Failed to switch to different camera:', error);
      if (error instanceof Error) {
        this.errorMessage.set(`Failed to switch camera: ${error.message}`);
      } else {
        this.errorMessage.set('Failed to switch camera');
      }
    }
  }
}
