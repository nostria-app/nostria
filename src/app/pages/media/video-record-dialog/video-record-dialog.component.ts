import { Component, inject, signal, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-video-record-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './video-record-dialog.component.html',
  styleUrls: ['./video-record-dialog.component.scss'],
})
export class VideoRecordDialogComponent implements OnDestroy {
  private dialogRef = inject(MatDialogRef<VideoRecordDialogComponent>);
  private snackBar = inject(MatSnackBar);

  @ViewChild('cameraPreview') cameraPreview?: ElementRef<HTMLVideoElement>;

  // Recording state
  isRecording = signal(false);
  isPreviewing = signal(false);
  recordingProgress = signal(0);
  stream = signal<MediaStream | null>(null);
  mediaRecorder = signal<MediaRecorder | null>(null);
  recordedBlob = signal<Blob | null>(null);
  recordedUrl = signal<string | null>(null);
  facingMode = signal<'user' | 'environment'>('user'); // 'user' = front camera, 'environment' = back camera

  // Recording constraints
  private readonly MAX_DURATION_MS = 6300; // 6.3 seconds
  private recordingTimer: number | null = null;
  private progressTimer: number | null = null;
  private recordedChunks: Blob[] = [];

  async ngOnDestroy(): Promise<void> {
    this.stopCamera();
    this.cleanupTimers();
    if (this.recordedUrl()) {
      URL.revokeObjectURL(this.recordedUrl()!);
    }
  }

  async startRecording(): Promise<void> {
    try {
      // Request camera access with video only
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1080 },
          height: { ideal: 1920 },
          facingMode: this.facingMode(),
        },
        audio: true,
      });

      this.stream.set(stream);

      // Set the stream to the video element
      const videoElement = this.cameraPreview?.nativeElement;
      if (videoElement) {
        videoElement.srcObject = stream;
      }

      // Setup MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: this.getSupportedMimeType(),
      });

      this.recordedChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, {
          type: mediaRecorder.mimeType,
        });
        this.recordedBlob.set(blob);
        this.recordedUrl.set(URL.createObjectURL(blob));
        this.isPreviewing.set(true);
        this.stopCamera();
      };

      this.mediaRecorder.set(mediaRecorder);
      mediaRecorder.start();
      this.isRecording.set(true);
      this.recordingProgress.set(0);

      // Start progress bar animation
      this.startProgressAnimation();

      // Auto-stop after MAX_DURATION_MS
      this.recordingTimer = window.setTimeout(() => {
        this.stopRecording();
      }, this.MAX_DURATION_MS);
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.snackBar.open('Failed to access camera. Please check permissions.', 'Close', {
        duration: 3000,
      });
      this.dialogRef.close(null);
    }
  }

  stopRecording(): void {
    const recorder = this.mediaRecorder();
    if (recorder && this.isRecording()) {
      recorder.stop();
      this.isRecording.set(false);
      this.cleanupTimers();
    }
  }

  private startProgressAnimation(): void {
    const startTime = Date.now();
    this.progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / this.MAX_DURATION_MS) * 100, 100);
      this.recordingProgress.set(progress);

      if (progress >= 100) {
        this.cleanupTimers();
      }
    }, 50);
  }

  private cleanupTimers(): void {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private stopCamera(): void {
    const stream = this.stream();
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      this.stream.set(null);
    }
  }

  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'video/webm';
  }

  retakeVideo(): void {
    if (this.recordedUrl()) {
      URL.revokeObjectURL(this.recordedUrl()!);
    }
    this.recordedBlob.set(null);
    this.recordedUrl.set(null);
    this.isPreviewing.set(false);
    this.recordingProgress.set(0);
    this.startRecording();
  }

  useVideo(): void {
    const blob = this.recordedBlob();
    if (blob) {
      // Create a File object from the blob
      const file = new File([blob], `video-${Date.now()}.webm`, {
        type: blob.type,
      });
      this.dialogRef.close({ file });
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  toggleCamera(): void {
    if (this.isRecording()) {
      return; // Don't allow switching during recording
    }

    this.facingMode.set(this.facingMode() === 'user' ? 'environment' : 'user');

    // If camera is already active (not recording, not previewing), restart with new camera
    if (this.stream() && !this.isPreviewing()) {
      this.stopCamera();
      this.startRecording();
    }
  }

  getStreamForPreview(): MediaStream | null {
    return this.stream();
  }
}
