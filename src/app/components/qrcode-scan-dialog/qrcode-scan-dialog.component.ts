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
import { frontalCamera, QRCanvas, frameLoop } from 'qr/dom.js';
import { nip19 } from 'nostr-tools';
import { UtilitiesService } from '../../services/utilities.service';
import { LoggerService } from '../../services/logger.service';

// Define interface for QR camera to avoid 'any' type
interface QRCamera {
  readFrame(canvas: QRCanvas, fullSize?: boolean): string | undefined;
  stop(): void;
  listDevices(): Promise<{ deviceId: string; label: string }[]>;
  setDevice(deviceId: string): Promise<void>;
}

@Component({
  selector: 'app-qrcode-scan-dialog',
  templateUrl: './qrcode-scan-dialog.component.html',
  styleUrls: ['./qrcode-scan-dialog.component.scss'],
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
})
export class
  QrcodeScanDialogComponent implements AfterViewInit, OnDestroy {
  private dialogRef = inject(MatDialogRef<QrcodeScanDialogComponent>);
  private utilities = inject(UtilitiesService);
  private logger = inject(LoggerService);

  @ViewChild('videoElement', { static: false })
  videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement', { static: false })
  canvasElement!: ElementRef<HTMLCanvasElement>;

  availableCameras = signal<{ deviceId: string; label: string }[]>([]);
  currentCameraIndex = signal<number>(0);
  currentDevice = signal<{ deviceId: string; label: string } | null>(null);
  isScanning = signal<boolean>(false);
  errorMessage = signal<string>('');

  private camera: QRCamera | null = null;
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
            this.errorMessage.set('No camera found. Please ensure a camera is connected.');
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

  private async listAvailableCameras(): Promise<{ deviceId: string; label: string }[]> {
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
      return videoDevices;
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      return [];
    }
  }

  private async initializeCamera() {
    try {
      const video = this.videoElement.nativeElement;
      const canvas = this.canvasElement.nativeElement;

      // Initialize QR canvas
      this.qrCanvas = new QRCanvas(
        { overlay: canvas },
        {
          overlayMainColor: 'rgba(0, 255, 0, 0.2)',
          overlayFinderColor: 'rgba(0, 0, 255, 0.4)',
          overlaySideColor: 'rgba(0, 0, 0, 0.3)',
          overlayTimeout: 2000,
          cropToSquare: true
        }
      );

      // Initialize camera with retry logic
      this.camera = await this.initializeCameraWithRetry(video);

      // Get available cameras
      const devices = await this.camera!.listDevices();
      this.availableCameras.set(devices);

      if (devices.length > 0) {
        this.currentDevice.set(devices[0]);
        await this.camera!.setDevice(devices[0].deviceId);
      }

      // Start scanning
      this.startScanning();
    } catch (error) {
      console.error('Error in initializeCamera:', error);
      throw error;
    }
  }

  private async initializeCameraWithRetry(video: HTMLVideoElement, maxRetries = 3): Promise<QRCamera> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // If this is a retry, wait a bit before trying again
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }

        const camera = await frontalCamera(video);
        return camera;
      } catch (error) {
        lastError = error as Error;

        // If it's a NotReadableError, try to list available devices and suggest switching
        if (error instanceof Error && error.name === 'NotReadableError') {
          await this.listAvailableCameras();
        }

        // Don't retry for permission errors
        if (error instanceof Error && error.name === 'NotAllowedError') {
          throw error;
        }
      }
    }

    // If all retries failed, throw the last error
    throw lastError || new Error('Camera initialization failed after multiple attempts');
  }

  private startScanning() {
    if (!this.camera || !this.qrCanvas) {
      this.logger.error('Cannot start scanning: camera or canvas not available');
      return;
    }

    this.isScanning.set(true);
    this.logger.info('QR scanning started');

    this.frameLoopCancel = frameLoop(() => {
      if (!this.camera || !this.qrCanvas) {
        return;
      }

      try {
        const video = this.videoElement.nativeElement;

        // Only attempt to scan if video is ready and has dimensions
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          // Try both full size and element size frame reading
          let result = this.camera.readFrame(this.qrCanvas, true);

          if (!result) {
            result = this.camera.readFrame(this.qrCanvas, false);
          }

          if (result) {
            this.logger.info('QR code detected:', result);
            this.onScanSuccess(result);
          }
        }
      } catch (error) {
        this.logger.error('Frame scanning error:', error);
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
    this.logger.info('QR code scanned:', result);

    // Process the scanned result to handle different Nostr entity formats
    const processedResult = this.processScannedResult(result);

    this.logger.info('Processed QR result:', processedResult);

    this.stopScanning();
    this.dialogRef.close(processedResult);
  }

  /**
   * Process scanned QR code result to handle different Nostr entity formats
   */
  private processScannedResult(rawResult: string): string {
    if (!rawResult || typeof rawResult !== 'string') {
      return rawResult;
    }

    const trimmedResult = rawResult.trim();
    this.logger.debug('Processing scanned result:', trimmedResult);

    // Handle different formats of Nostr entities

    // 1. Handle "nostr:" prefixed URIs (standard format)
    if (trimmedResult.startsWith('nostr:')) {
      const entity = trimmedResult.substring(6); // Remove "nostr:" prefix
      this.logger.debug('Found nostr: prefixed entity:', entity);
      return this.normalizeNostrEntity(entity);
    }

    // 2. Handle direct Nostr entities (npub, nprofile, note, nevent, naddr, etc.)
    if (this.isNostrEntity(trimmedResult)) {
      this.logger.debug('Found direct nostr entity:', trimmedResult);
      return this.normalizeNostrEntity(trimmedResult);
    }

    // 3. Handle other special formats
    if (trimmedResult.startsWith('bunker://') ||
      trimmedResult.startsWith('nostr+walletconnect://') ||
      trimmedResult.startsWith('nostr+')) {
      this.logger.debug('Found special protocol:', trimmedResult);
      return trimmedResult;
    }

    // 4. Check if it's a raw hex pubkey
    if (this.utilities.isValidHexPubkey(trimmedResult)) {
      this.logger.debug('Found raw hex pubkey, converting to npub');
      return this.utilities.getNpubFromPubkey(trimmedResult);
    }

    // Return as-is if no special processing needed
    this.logger.debug('No special processing needed, returning as-is');
    return trimmedResult;
  }

  /**
   * Check if a string is a Nostr entity
   */
  private isNostrEntity(value: string): boolean {
    return (
      value.startsWith('npub') ||
      value.startsWith('nprofile') ||
      value.startsWith('nevent') ||
      value.startsWith('note') ||
      value.startsWith('naddr') ||
      value.startsWith('nsec')
    );
  }

  /**
   * Normalize a Nostr entity to ensure it's in the correct format
   */
  private normalizeNostrEntity(entity: string): string {
    try {
      // Validate the entity by trying to decode it
      if (entity.startsWith('npub') || entity.startsWith('nprofile')) {
        const decoded = nip19.decode(entity);
        if (decoded.type === 'npub' || decoded.type === 'nprofile') {
          this.logger.debug('Valid Nostr entity confirmed:', entity);
          return entity;
        }
      } else if (entity.startsWith('note') || entity.startsWith('nevent')) {
        const decoded = nip19.decode(entity);
        if (decoded.type === 'note' || decoded.type === 'nevent') {
          this.logger.debug('Valid Nostr entity confirmed:', entity);
          return entity;
        }
      } else if (entity.startsWith('naddr')) {
        const decoded = nip19.decode(entity);
        if (decoded.type === 'naddr') {
          this.logger.debug('Valid Nostr entity confirmed:', entity);
          return entity;
        }
      }

      // If we reach here, the entity might be malformed
      this.logger.warn('Potentially malformed Nostr entity:', entity);
      return entity; // Return as-is, let the consuming code handle it
    } catch (error) {
      this.logger.warn('Error validating Nostr entity:', entity, error);
      return entity; // Return as-is if validation fails
    }
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
          readFrame: (canvas: QRCanvas, fullSize?: boolean) => {
            const size = fullSize ?
              { height: video.videoHeight, width: video.videoWidth } :
              { height: video.clientHeight, width: video.clientWidth };
            return canvas.drawImage(video, size.height, size.width);
          },
          stop: () => {
            stream.getTracks().forEach(track => track.stop());
            video.srcObject = null;
          },
          listDevices: () => this.listAvailableCameras(),
          setDevice: (newDeviceId: string) => this.tryDifferentCamera(newDeviceId),
        };

        // Update current device
        const device = this.availableCameras().find(d => d.deviceId === deviceId);
        if (device) {
          this.currentDevice.set(device);
          this.currentCameraIndex.set(this.availableCameras().indexOf(device));
        }
      } else {
        // Try default camera initialization
        this.camera = await frontalCamera(video);
        const devices = await this.camera!.listDevices();
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
