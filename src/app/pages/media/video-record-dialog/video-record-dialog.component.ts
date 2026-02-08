import { Component, inject, signal, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { VideoFilterService } from '../../../services/video-filter.service';
import { LoggerService } from '../../../services/logger.service';
import { MatChipsModule } from '@angular/material/chips';
import { CustomDialogRef } from '../../../services/custom-dialog.service';

@Component({
  selector: 'app-video-record-dialog',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatSlideToggleModule,
    FormsModule,
    MatChipsModule,
  ],
  templateUrl: './video-record-dialog.component.html',
  styleUrls: ['./video-record-dialog.component.scss'],
})
export class VideoRecordDialogComponent implements OnDestroy, AfterViewInit {
  dialogRef = inject(CustomDialogRef<VideoRecordDialogComponent, { file: File; uploadOriginal: boolean } | null>);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  filterService = inject(VideoFilterService);

  @ViewChild('cameraPreview') cameraPreview?: ElementRef<HTMLVideoElement>;
  @ViewChild('filterCanvas') filterCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('filterChips') filterChipsContainer?: ElementRef<HTMLDivElement>;

  // Recording state
  isRecording = signal(false);
  isPreviewing = signal(false);
  recordingProgress = signal(0);
  timeRemaining = signal(0); // Time remaining in seconds
  stream = signal<MediaStream | null>(null);
  mediaRecorder = signal<MediaRecorder | null>(null);
  recordedBlob = signal<Blob | null>(null);
  recordedUrl = signal<string | null>(null);
  facingMode = signal<'user' | 'environment'>('user'); // 'user' = front camera, 'environment' = back camera
  isShortForm = true; // Toggle for short form recording (6.3 seconds auto-stop)
  aspectRatio = signal<'vertical' | 'horizontal'>('vertical'); // Video orientation
  uploadOriginal = false; // Upload original without transcoding
  selectedFilter = signal<string>('none'); // Currently selected filter
  showFilters = signal<boolean>(false); // Show/hide filter selection
  showSwipeHint = signal<boolean>(false); // Show swipe hint briefly
  private filterAnimationFrame: number | null = null;
  private swipeHintTimeout: number | null = null;

  // Swipe gesture state
  private touchStartX = 0;
  private touchStartY = 0;
  private isSwiping = false;
  private readonly SWIPE_THRESHOLD = 50; // Minimum swipe distance

  // Recording constraints
  private readonly MAX_DURATION_MS = 6300; // 6.3 seconds
  private recordingTimer: number | null = null;
  private progressTimer: number | null = null;
  private recordedChunks: Blob[] = [];

  async ngOnDestroy(): Promise<void> {
    this.stopCamera();
    this.cleanupTimers();
    this.stopFilterRendering();
    this.filterService.cleanup();
    if (this.swipeHintTimeout) {
      clearTimeout(this.swipeHintTimeout);
    }
    if (this.recordedUrl()) {
      URL.revokeObjectURL(this.recordedUrl()!);
    }
  }

  ngAfterViewInit(): void {
    // Start camera preview as soon as view is ready
    setTimeout(async () => {
      await this.startCameraPreview();
      this.initializeFilters();
      this.showSwipeHintBriefly();
    }, 100);
  }

  private showSwipeHintBriefly(): void {
    // Show swipe hint for 3 seconds
    this.showSwipeHint.set(true);
    this.swipeHintTimeout = window.setTimeout(() => {
      this.showSwipeHint.set(false);
    }, 3000);
  }

  private initializeFilters(): void {
    const canvas = this.filterCanvas?.nativeElement;
    if (canvas) {
      const initialized = this.filterService.initWebGL(canvas);
      if (initialized) {
        this.startFilterRendering();
      } else {
        this.logger.warn('WebGL filters not available, falling back to standard video');
      }
    }
  }

  private getTargetAspectRatio(): number {
    return this.aspectRatio() === 'vertical' ? 9 / 16 : 16 / 9;
  }

  private startFilterRendering(): void {
    const renderFrame = () => {
      const video = this.cameraPreview?.nativeElement;
      const canvas = this.filterCanvas?.nativeElement;

      if (video && canvas && video.readyState >= video.HAVE_CURRENT_DATA) {
        this.filterService.applyFilter(video, canvas, this.getTargetAspectRatio());
      }

      this.filterAnimationFrame = requestAnimationFrame(renderFrame);
    };

    renderFrame();
  }

  private stopFilterRendering(): void {
    if (this.filterAnimationFrame !== null) {
      cancelAnimationFrame(this.filterAnimationFrame);
      this.filterAnimationFrame = null;
    }
  }

  async startCameraPreview(): Promise<void> {
    try {
      // Set video constraints based on aspect ratio
      const isVertical = this.aspectRatio() === 'vertical';
      const videoConstraints = {
        width: { ideal: isVertical ? 1080 : 1920 },
        height: { ideal: isVertical ? 1920 : 1080 },
        facingMode: this.facingMode(),
      };

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: true,
      });

      this.stream.set(stream);

      // Set the stream to the video element
      const videoElement = this.cameraPreview?.nativeElement;
      if (videoElement) {
        videoElement.srcObject = stream;
        // Ensure video is muted to prevent audio feedback
        videoElement.muted = true;

        // Wait for video to be ready before starting playback
        await new Promise<void>((resolve) => {
          videoElement.onloadedmetadata = () => {
            videoElement.play().then(() => {
              this.logger.debug('[VideoRecorder] Video playback started with dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
              resolve();
            }).catch(err => {
              this.logger.error('[VideoRecorder] Failed to play video:', err);
              resolve();
            });
          };
        });
      }
    } catch (error) {
      this.logger.error('Failed to start camera preview:', error);
      this.snackBar.open('Failed to access camera. Please check permissions.', 'Close', {
        duration: 3000,
      });
    }
  }

  async startRecording(): Promise<void> {
    try {
      // If no stream exists, start camera preview first
      if (!this.stream()) {
        await this.startCameraPreview();
      }

      // Always capture from the filtered canvas since we always render to it
      // This ensures the aspect ratio cropping is included in the recording
      let recordingStream: MediaStream;
      const canvas = this.filterCanvas?.nativeElement;

      if (canvas && canvas.width > 0 && canvas.height > 0) {
        // Capture stream from canvas which has the filter and aspect ratio applied
        // Try to match the camera stream's frame rate, default to 30fps
        const cameraStream = this.stream();
        const videoTrack = cameraStream?.getVideoTracks()[0];
        const frameRate = videoTrack?.getSettings().frameRate || 30;

        recordingStream = canvas.captureStream(frameRate);

        // Add audio from the original camera stream
        if (cameraStream) {
          const audioTracks = cameraStream.getAudioTracks();
          // Check if audio tracks exist and aren't already in the recording stream
          const existingAudioTracks = recordingStream.getAudioTracks();
          audioTracks.forEach(track => {
            const isDuplicate = existingAudioTracks.some(existing => existing.id === track.id);
            if (!isDuplicate) {
              recordingStream.addTrack(track);
            }
          });
        }
      } else {
        // Use original camera stream without filter
        const stream = this.stream();
        if (!stream) {
          throw new Error('Failed to get camera stream');
        }
        recordingStream = stream;
      }

      // Setup MediaRecorder
      const mediaRecorder = new MediaRecorder(recordingStream, {
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

      mediaRecorder.onerror = (event: Event) => {
        this.logger.error('[VideoRecorder] MediaRecorder error:', event);
      };

      this.mediaRecorder.set(mediaRecorder);
      mediaRecorder.start();
      this.isRecording.set(true);
      this.recordingProgress.set(0);

      // Start progress bar animation
      this.startProgressAnimation();

      // Auto-stop after MAX_DURATION_MS only if short form is enabled
      if (this.isShortForm) {
        this.recordingTimer = window.setTimeout(() => {
          // Force stop the recording at exactly 6.3 seconds
          const recorder = this.mediaRecorder();

          if (recorder && recorder.state === 'recording') {
            // Request data before stopping to ensure we get all chunks
            recorder.requestData();
            recorder.stop();
            this.isRecording.set(false);
            this.cleanupTimers();
          } else {
            this.logger.warn('[VideoRecorder] Cannot stop - recorder state is:', recorder?.state);
          }
        }, this.MAX_DURATION_MS);
      }
    } catch (error) {
      this.logger.error('Failed to start recording:', error);
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
      // Only show progress if short form is enabled
      const progress = this.isShortForm
        ? Math.min((elapsed / this.MAX_DURATION_MS) * 100, 100)
        : 0;
      this.recordingProgress.set(progress);

      // Update time remaining
      if (this.isShortForm) {
        const remaining = Math.max(0, (this.MAX_DURATION_MS - elapsed) / 1000);
        this.timeRemaining.set(remaining);
      } else {
        const elapsedSeconds = elapsed / 1000;
        this.timeRemaining.set(elapsedSeconds);
      }

      if (progress >= 100) {
        // Only clear the progress timer, NOT the recording timer
        if (this.progressTimer) {
          clearInterval(this.progressTimer);
          this.progressTimer = null;
        }
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

  async retakeVideo(): Promise<void> {
    if (this.recordedUrl()) {
      URL.revokeObjectURL(this.recordedUrl()!);
    }
    this.recordedBlob.set(null);
    this.recordedUrl.set(null);
    this.isPreviewing.set(false);
    this.recordingProgress.set(0);

    // Stop any existing filter rendering
    this.stopFilterRendering();

    // Clean up WebGL resources so they can be reinitialized with correct dimensions
    this.filterService.cleanup();

    // Restart camera preview and filter rendering
    await this.startCameraPreview();
    this.initializeFilters();
  }

  useVideo(): void {
    const blob = this.recordedBlob();
    if (blob) {
      // Create a File object from the blob
      const file = new File([blob], `video-${Date.now()}.webm`, {
        type: blob.type,
      });
      this.dialogRef.close({
        file,
        uploadOriginal: this.uploadOriginal
      });
    }
  }

  downloadVideo(): void {
    const url = this.recordedUrl();
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `video-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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

    // Restart camera preview with new facing mode
    if (this.stream() && !this.isPreviewing()) {
      this.stopCamera();
      this.startCameraPreview();
    }
  }

  getStreamForPreview(): MediaStream | null {
    return this.stream();
  }

  selectFilter(filterId: string): void {
    this.selectedFilter.set(filterId);
    this.filterService.setFilter(filterId);
    this.scrollToSelectedFilter();
  }

  private scrollToSelectedFilter(): void {
    // Scroll the filter chips container to center the selected filter
    setTimeout(() => {
      const container = this.filterChipsContainer?.nativeElement;
      if (!container) return;

      const selectedIndex = this.getCurrentFilterIndex();
      const filterChips = container.querySelectorAll('.filter-chip');
      const selectedChip = filterChips[selectedIndex] as HTMLElement;

      if (selectedChip) {
        const containerWidth = container.offsetWidth;
        const chipLeft = selectedChip.offsetLeft;
        const chipWidth = selectedChip.offsetWidth;

        // Calculate scroll position to center the chip
        const scrollLeft = chipLeft - (containerWidth / 2) + (chipWidth / 2);

        container.scrollTo({
          left: Math.max(0, scrollLeft),
          behavior: 'smooth'
        });
      }
    }, 0);
  }

  toggleFilters(): void {
    this.showFilters.update(show => !show);
  }

  // Get current filter info for display
  getCurrentFilterIcon(): string {
    const filter = this.filterService.availableFilters.find(f => f.id === this.selectedFilter());
    return filter?.icon || 'filter_none';
  }

  getCurrentFilterName(): string {
    const filter = this.filterService.availableFilters.find(f => f.id === this.selectedFilter());
    return filter?.name || 'None';
  }

  getCurrentFilterIndex(): number {
    return this.filterService.availableFilters.findIndex(f => f.id === this.selectedFilter());
  }

  // Swipe gesture handlers
  onTouchStart(event: TouchEvent): void {
    if (this.isRecording()) return;

    const touch = event.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.isSwiping = false;
  }

  onTouchMove(event: TouchEvent): void {
    if (this.isRecording()) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - this.touchStartX;
    const deltaY = touch.clientY - this.touchStartY;

    // Determine if this is a horizontal swipe (filter change) vs vertical scroll
    if (!this.isSwiping && Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
      this.isSwiping = true;
    }

    // Prevent default scrolling during horizontal swipe
    if (this.isSwiping) {
      event.preventDefault();
    }
  }

  onTouchEnd(event: TouchEvent): void {
    if (this.isRecording() || !this.isSwiping) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - this.touchStartX;

    if (Math.abs(deltaX) >= this.SWIPE_THRESHOLD) {
      const currentIndex = this.getCurrentFilterIndex();
      const filters = this.filterService.availableFilters;

      if (deltaX < 0) {
        // Swipe left - next filter
        const nextIndex = (currentIndex + 1) % filters.length;
        this.selectFilter(filters[nextIndex].id);
      } else {
        // Swipe right - previous filter
        const prevIndex = currentIndex <= 0 ? filters.length - 1 : currentIndex - 1;
        this.selectFilter(filters[prevIndex].id);
      }
    }

    this.isSwiping = false;
  }
}
