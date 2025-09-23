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
import { nip19 } from 'nostr-tools';
import { UtilitiesService } from '../../services/utilities.service';
import { LoggerService } from '../../services/logger.service';
import { DecimalPipe } from '@angular/common';
import { computed } from '@angular/core';

@Component({
  selector: 'app-qrcode-scan-dialog',
  templateUrl: './qrcode-scan-dialog.component.html',
  styleUrls: ['./qrcode-scan-dialog.component.scss'],
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, DecimalPipe],
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

  // Debug signals
  debugInfo = signal<string>('');
  framesScanned = signal<number>(0);
  lastScanAttempt = signal<Date | null>(null);
  scanningActive = signal<boolean>(false);

  // Computed property for time since last scan
  timeSinceLastScan = computed(() => {
    const lastScan = this.lastScanAttempt();
    return lastScan ? (Date.now() - lastScan.getTime()) / 1000 : 0;
  });

  private camera: any = null;
  private qrCanvas: QRCanvas | null = null;
  private frameLoopCancel: (() => void) | null = null;
  private debugInterval: number | null = null;

  async ngAfterViewInit() {
    // Add a small delay to ensure the dialog is fully rendered
    setTimeout(async () => {
      try {
        await this.initializeCamera();
      } catch (error) {
        console.error('Failed to initialize camera:', error);
        this.debugInfo.set(`❌ Initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Provide more specific error messages
        if (error instanceof Error) {
          if (error.name === 'NotAllowedError') {
            this.errorMessage.set(
              'Camera access denied. Please allow camera permissions and try again.'
            );
            this.debugInfo.set('🚫 Camera permission denied - check browser settings');
          } else if (error.name === 'NotFoundError') {
            this.errorMessage.set('No camera found. Please ensure a camera is connected.');
            this.debugInfo.set('📷 No camera devices found');
          } else if (error.name === 'NotSupportedError') {
            this.errorMessage.set('Camera not supported in this browser.');
            this.debugInfo.set('🚫 Camera API not supported in this browser');
          } else if (error.name === 'NotReadableError') {
            this.errorMessage.set(
              'Camera is already in use by another application. Close other apps using the camera and try a different camera below.'
            );
            this.debugInfo.set('🔒 Camera in use by another application');
          } else {
            this.errorMessage.set(`Camera error: ${error.message}`);
            this.debugInfo.set(`❌ Camera error: ${error.message}`);
          }
        } else {
          this.errorMessage.set(
            'Failed to access camera. Please ensure camera permissions are granted.'
          );
          this.debugInfo.set('❌ Unknown camera access error');
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
    this.stopDebugInterval();
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
      this.debugInfo.set('📹 Initializing camera...');
      console.log('Initializing camera...');
      const video = this.videoElement.nativeElement;
      const canvas = this.canvasElement.nativeElement;

      console.log('Video element:', video);
      console.log('Canvas element:', canvas);

      // Initialize QR canvas
      this.debugInfo.set('🎨 Setting up QR canvas...');
      this.qrCanvas = new QRCanvas({ overlay: canvas });
      console.log('QR Canvas initialized');

      // Initialize camera with retry logic
      this.debugInfo.set('📷 Connecting to camera...');
      console.log('Calling frontalCamera...');
      this.camera = await this.initializeCameraWithRetry(video);
      console.log('Camera initialized:', this.camera);

      // Get available cameras
      this.debugInfo.set('🔍 Detecting available cameras...');
      console.log('Getting device list...');
      const devices = await this.camera.listDevices();
      console.log('Available devices:', devices);
      this.availableCameras.set(devices);

      if (devices.length > 0) {
        this.currentDevice.set(devices[0]);
        this.debugInfo.set(`📱 Setting camera: ${devices[0].label}`);
        console.log('Setting device to:', devices[0]);
        await this.camera.setDevice(devices[0].deviceId);
      }

      // Start scanning
      this.debugInfo.set('✅ Camera ready, starting scan...');
      console.log('Starting scanning...');
      this.startScanning();
    } catch (error) {
      console.error('Error in initializeCamera:', error);
      this.debugInfo.set(`❌ Camera initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private async initializeCameraWithRetry(video: HTMLVideoElement, maxRetries = 3): Promise<any> {
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
        console.error(`Camera initialization attempt ${attempt} failed:`, error);
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
    throw lastError || new Error('Camera initialization failed after multiple attempts');
  }

  private startScanning() {
    if (!this.camera || !this.qrCanvas) {
      this.debugInfo.set('❌ Cannot start scanning: camera or canvas not available');
      this.logger.error('Cannot start scanning: camera or canvas not available');
      return;
    }

    this.isScanning.set(true);
    this.scanningActive.set(true);
    this.framesScanned.set(0);
    this.debugInfo.set('🔍 Starting QR code scanning...');
    this.logger.info('QR scanning started');

    // Start debug interval to update scan statistics
    this.startDebugInterval();

    this.frameLoopCancel = frameLoop(() => {
      if (!this.camera || !this.qrCanvas) {
        this.debugInfo.set('❌ Frame loop stopped: camera or canvas unavailable');
        return;
      }

      try {
        // Update frame counter
        const frameCount = this.framesScanned() + 1;
        this.framesScanned.set(frameCount);
        this.lastScanAttempt.set(new Date());

        // Attempt to read QR code from current frame
        const result = this.camera.readFrame(this.qrCanvas);

        if (result) {
          this.debugInfo.set(`✅ QR code detected after ${frameCount} frames!`);
          this.logger.info('QR code detected:', result);
          this.onScanSuccess(result);
        } else {
          // Update debug info periodically (every 30 frames to avoid spam)
          if (frameCount % 30 === 0) {
            this.debugInfo.set(`🔍 Scanning... ${frameCount} frames processed, no QR code detected yet`);
          }
        }
      } catch (error) {
        this.logger.error('Frame scanning error:', error);
        this.debugInfo.set(`❌ Scan error: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Continue scanning despite errors
        console.error('Scan error (continuing):', error);
      }
    });
  }

  private stopScanning() {
    this.isScanning.set(false);
    this.scanningActive.set(false);
    this.debugInfo.set('🛑 Scanning stopped');
    this.stopDebugInterval();

    if (this.frameLoopCancel) {
      this.frameLoopCancel();
      this.frameLoopCancel = null;
    }

    if (this.camera) {
      this.camera.stop();
      this.camera = null;
    }
  }

  private startDebugInterval() {
    this.stopDebugInterval(); // Clear any existing interval

    this.debugInterval = window.setInterval(() => {
      if (this.scanningActive()) {
        const frames = this.framesScanned();
        const lastScan = this.lastScanAttempt();
        const timeSinceLastScan = lastScan ? Date.now() - lastScan.getTime() : 0;

        if (timeSinceLastScan > 5000) {
          this.debugInfo.set(`⚠️ Scanner may be stalled. Frames: ${frames}, Last scan: ${Math.floor(timeSinceLastScan / 1000)}s ago`);
        }
      }
    }, 2000);
  }

  private stopDebugInterval() {
    if (this.debugInterval) {
      clearInterval(this.debugInterval);
      this.debugInterval = null;
    }
  }

  private onScanSuccess(result: string) {
    this.logger.info('QR code scanned:', result);
    this.debugInfo.set(`✅ QR detected: ${result.substring(0, 50)}${result.length > 50 ? '...' : ''}`);

    // Process the scanned result to handle different Nostr entity formats
    const processedResult = this.processScannedResult(result);

    this.logger.info('Processed QR result:', processedResult);
    this.debugInfo.set(`🔄 Processed: ${processedResult.substring(0, 50)}${processedResult.length > 50 ? '...' : ''}`);

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
          readFrame: (canvas: any) => canvas.drawImage(video, video.videoHeight, video.videoWidth),
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
