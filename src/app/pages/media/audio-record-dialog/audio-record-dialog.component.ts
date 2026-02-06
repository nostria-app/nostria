/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, inject, signal, OnDestroy, AfterViewInit } from '@angular/core';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AudioPlayerComponent } from '../../../components/audio-player/audio-player.component';

@Component({
  selector: 'app-audio-record-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    FormsModule,
    AudioPlayerComponent
  ],
  templateUrl: './audio-record-dialog.component.html',
  styleUrls: ['./audio-record-dialog.component.scss'],
})
export class AudioRecordDialogComponent implements OnDestroy, AfterViewInit {
  private dialogRef = inject(MatDialogRef<AudioRecordDialogComponent>);
  private snackBar = inject(MatSnackBar);

  // Recording state
  isRecording = signal(false);
  isPreviewing = signal(false);
  recordingProgress = signal(0);
  timeRemaining = signal(60); // 60 seconds max
  stream = signal<MediaStream | null>(null);
  mediaRecorder = signal<MediaRecorder | null>(null);
  recordedBlob = signal<Blob | null>(null);
  recordedUrl = signal<string | null>(null);

  // Waveform data for preview
  waveform = signal<number[]>([]);

  // Recording constraints
  private readonly MAX_DURATION_MS = 60000; // 60 seconds
  private recordingTimer: any = null;
  private progressTimer: any = null;
  private recordedChunks: Blob[] = [];
  private recordedSamples: number[] = [];

  // Audio visualization
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationId: number | null = null;
  liveWaveform = signal<number[]>(new Array(50).fill(0));

  async ngOnDestroy(): Promise<void> {
    this.stopRecording();
    this.cleanupTimers();
    if (this.recordedUrl()) {
      URL.revokeObjectURL(this.recordedUrl()!);
    }
    this.stopAudioContext();
  }

  ngAfterViewInit(): void {
    // Request microphone access immediately
    this.startMicrophone();
  }

  async startMicrophone(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream.set(stream);
      this.setupAudioVisualization(stream);
    } catch (error) {
      console.error('Failed to access microphone:', error);
      this.snackBar.open('Failed to access microphone. Please check permissions.', 'Close', {
        duration: 3000,
      });
    }
  }

  setupAudioVisualization(stream: MediaStream) {
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);

    const updateWaveform = () => {
      if (!this.analyser || !this.dataArray) return;

      if (this.isRecording()) {
        // Time domain for waveform
        this.analyser.getByteTimeDomainData(this.dataArray as any);

        // Calculate RMS
        let sum = 0;
        for (const val of this.dataArray) {
          const amplitude = (val - 128) / 128;
          sum += amplitude * amplitude;
        }
        const rms = Math.sqrt(sum / this.dataArray.length);
        const val = Math.min(100, Math.round(rms * 100 * 4)); // Scale factor 4

        this.recordedSamples.push(val);

        // Show last 50 samples
        const display = this.recordedSamples.slice(-50);
        while (display.length < 50) display.unshift(0);
        this.liveWaveform.set(display);

      } else {
        this.analyser.getByteFrequencyData(this.dataArray as any);

        // Downsample to 50 bars
        const bars = 50;
        const step = Math.floor(bufferLength / bars);
        const newWaveform = [];

        for (let i = 0; i < bars; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) {
            sum += this.dataArray[i * step + j];
          }
          const average = sum / step;
          // Normalize to 0-100
          newWaveform.push((average / 255) * 100);
        }

        this.liveWaveform.set(newWaveform);
      }

      if (this.isRecording() || !this.recordedBlob()) {
        this.animationId = requestAnimationFrame(updateWaveform);
      }
    };

    updateWaveform();
  }

  stopAudioContext() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }

  async startRecording(): Promise<void> {
    try {
      if (!this.stream()) {
        await this.startMicrophone();
      }

      const stream = this.stream();
      if (!stream) return;

      console.log('[AudioRecorder] Starting recording...');

      // Prefer audio/mp4 (AAC) if available, otherwise webm/opus
      let mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/webm';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      this.mediaRecorder.set(mediaRecorder);
      this.recordedChunks = [];
      this.recordedSamples = []; // Reset samples for new recording

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        this.recordedBlob.set(blob);
        const url = URL.createObjectURL(blob);
        this.recordedUrl.set(url);
        this.isPreviewing.set(true);

        // Capture the final waveform for preview
        // Downsample recordedSamples to ~100 for the final waveform
        const targetLength = 100;
        const samples = this.recordedSamples;
        const result: number[] = [];

        if (samples.length <= targetLength) {
          this.waveform.set([...samples]);
        } else {
          const blockSize = Math.floor(samples.length / targetLength);
          for (let i = 0; i < targetLength; i++) {
            const start = i * blockSize;
            let sum = 0;
            for (let j = 0; j < blockSize; j++) {
              sum += samples[start + j];
            }
            result.push(Math.round(sum / blockSize));
          }
          this.waveform.set(result);
        }
      };

      mediaRecorder.start(100); // Collect chunks every 100ms
      this.isRecording.set(true);

      // Start timer
      const startTime = Date.now();
      this.recordingTimer = setTimeout(() => {
        this.stopRecording();
      }, this.MAX_DURATION_MS);

      this.progressTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = (elapsed / this.MAX_DURATION_MS) * 100;
        this.recordingProgress.set(progress);
        this.timeRemaining.set(Math.ceil((this.MAX_DURATION_MS - elapsed) / 1000));
      }, 100);

    } catch (error) {
      console.error('Failed to start recording:', error);
      this.snackBar.open('Failed to start recording.', 'Close', { duration: 3000 });
    }
  }

  stopRecording(): void {
    if (this.isRecording()) {
      this.mediaRecorder()?.stop();
      this.isRecording.set(false);
      this.cleanupTimers();
    }
  }

  cleanupTimers() {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  resetRecording(): void {
    if (this.recordedUrl()) {
      URL.revokeObjectURL(this.recordedUrl()!);
    }
    this.recordedBlob.set(null);
    this.recordedUrl.set(null);
    this.isPreviewing.set(false);
    this.recordingProgress.set(0);
    this.timeRemaining.set(60);

    // Restart visualization loop
    if (this.stream()) {
      this.setupAudioVisualization(this.stream()!);
    }
  }

  saveRecording(): void {
    if (this.recordedBlob()) {
      // Return the blob and waveform data
      // We need to convert waveform to integers as per NIP-A0
      const integerWaveform = this.waveform().map(v => Math.round(v));

      this.dialogRef.close({
        blob: this.recordedBlob(),
        waveform: integerWaveform,
        duration: 60 - this.timeRemaining() // Approximate duration
      });
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
