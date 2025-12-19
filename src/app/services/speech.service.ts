import { inject, Injectable, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AiService } from './ai.service';
import { SettingsService } from './settings.service';

export interface SpeechRecordingOptions {
  /** Silence threshold (0-1), lower = more sensitive. Default: 0.02 */
  silenceThreshold?: number;
  /** Duration of silence (in ms) before auto-stop. Default: 2000 */
  silenceDuration?: number;
  /** Callback when transcription is complete */
  onTranscription?: (text: string) => void;
  /** Callback when recording state changes */
  onRecordingStateChange?: (isRecording: boolean) => void;
  /** Callback when transcribing state changes */
  onTranscribingStateChange?: (isTranscribing: boolean) => void;
}

export interface TranscriptionRule {
  pattern: RegExp;
  replacement: string;
}

@Injectable({
  providedIn: 'root'
})
export class SpeechService {
  private aiService = inject(AiService);
  private settings = inject(SettingsService);
  private snackBar = inject(MatSnackBar);

  // Recording state
  isRecording = signal(false);
  isTranscribing = signal(false);

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  // Silence detection
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private silenceStart: number | null = null;
  private animationFrameId: number | null = null;

  // Default options
  private readonly DEFAULT_SILENCE_THRESHOLD = 0.02;
  private readonly DEFAULT_SILENCE_DURATION = 2000;

  // Current recording options
  private currentOptions: SpeechRecordingOptions = {};

  /**
   * Transcription normalization rules.
   * These are applied after the Whisper model transcribes the audio
   * to correct common misinterpretations and convert spoken symbols.
   */
  private readonly transcriptionRules: TranscriptionRule[] = [
    // Nostr-specific corrections
    { pattern: /\bnuster\b/gi, replacement: 'nostr' },
    { pattern: /\bnostre\b/gi, replacement: 'nostr' },
    { pattern: /\bnostro\b/gi, replacement: 'nostr' },
    { pattern: /\bnoster\b/gi, replacement: 'nostr' },
    { pattern: /\bknoster\b/gi, replacement: 'nostr' },
    { pattern: /\bnostra\b/gi, replacement: 'nostr' },
    { pattern: /\bnosta\b/gi, replacement: 'nostr' },
    // "ask nostr" phrase corrections (applied before single-word corrections)
    { pattern: /\basknuster\b/gi, replacement: 'ask nostr' },
    { pattern: /\bask nuster\b/gi, replacement: 'ask nostr' },
    { pattern: /\bask noster\b/gi, replacement: 'ask nostr' },
    { pattern: /\bask nostre\b/gi, replacement: 'ask nostr' },
    { pattern: /\bAskNoster\b/gi, replacement: 'ask nostr' },
    { pattern: /\bAskNuster\b/gi, replacement: 'ask nostr' },
    { pattern: /\bask nostro\b/gi, replacement: 'ask nostr' },
    { pattern: /\bask nostra\b/gi, replacement: 'ask nostr' },
    { pattern: /\bAskNostered\b/gi, replacement: 'ask nostr' },

    // Symbol conversions
    { pattern: /\bhashtag\s+/gi, replacement: '#' },
    { pattern: /\bhash tag\s+/gi, replacement: '#' },
    { pattern: /\bhashtag\b/gi, replacement: '#' },
    { pattern: /\bhash tag\b/gi, replacement: '#' },
    { pattern: /\bat sign\b/gi, replacement: '@' },
    { pattern: /\bat symbol\b/gi, replacement: '@' },
    { pattern: /\bampersand\b/gi, replacement: '&' },
    { pattern: /\bpercent\b/gi, replacement: '%' },
    { pattern: /\bdollar sign\b/gi, replacement: '$' },
    { pattern: /\bplus sign\b/gi, replacement: '+' },
    { pattern: /\bequals sign\b/gi, replacement: '=' },
    { pattern: /\bquestion mark\b/gi, replacement: '?' },
    { pattern: /\bexclamation mark\b/gi, replacement: '!' },
    { pattern: /\bexclamation point\b/gi, replacement: '!' },
    // Common phrases
    { pattern: /\bnew line\b/gi, replacement: '\n' },
    { pattern: /\bnewline\b/gi, replacement: '\n' },
    { pattern: /\bparagraph\b/gi, replacement: '\n\n' },
    { pattern: /\bnew paragraph\b/gi, replacement: '\n\n' },
  ];

  /**
   * Apply transcription normalization rules to the text.
   * This corrects common misinterpretations and converts spoken symbols.
   */
  applyTranscriptionRules(text: string): string {
    let result = text;
    for (const rule of this.transcriptionRules) {
      result = result.replace(rule.pattern, rule.replacement);
    }
    return result;
  }

  /**
   * Add custom transcription rules.
   * Useful for adding domain-specific corrections.
   */
  addTranscriptionRule(pattern: RegExp, replacement: string): void {
    this.transcriptionRules.push({ pattern, replacement });
  }

  /**
   * Check if AI transcription is enabled in settings.
   */
  isTranscriptionEnabled(): boolean {
    const settings = this.settings.settings();
    return !!settings.aiEnabled && !!settings.aiTranscriptionEnabled;
  }

  /**
   * Toggle recording state.
   */
  async toggleRecording(options: SpeechRecordingOptions = {}): Promise<void> {
    if (this.isRecording()) {
      this.stopRecording();
    } else {
      await this.startRecording(options);
    }
  }

  /**
   * Start recording audio from the microphone.
   */
  async startRecording(options: SpeechRecordingOptions = {}): Promise<void> {
    this.currentOptions = options;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
        await this.processAudio(audioBlob);

        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
          this.stream = null;
        }
      };

      this.mediaRecorder.start();
      this.isRecording.set(true);
      options.onRecordingStateChange?.(true);

      // Start silence detection
      this.startSilenceDetection(this.stream, options);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      this.snackBar.open('Error accessing microphone', 'Close', { duration: 3000 });
    }
  }

  /**
   * Start silence detection to auto-stop recording after a period of silence.
   */
  private startSilenceDetection(stream: MediaStream, options: SpeechRecordingOptions): void {
    const silenceThreshold = options.silenceThreshold ?? this.DEFAULT_SILENCE_THRESHOLD;
    const silenceDuration = options.silenceDuration ?? this.DEFAULT_SILENCE_DURATION;

    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.microphone = this.audioContext.createMediaStreamSource(stream);
    this.microphone.connect(this.analyser);

    this.analyser.fftSize = 2048;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.silenceStart = Date.now();

    const checkSilence = () => {
      if (!this.isRecording()) return;

      this.analyser!.getByteTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const x = (dataArray[i] - 128) / 128.0;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / bufferLength);

      if (rms < silenceThreshold) {
        if (this.silenceStart === null) {
          this.silenceStart = Date.now();
        } else if (Date.now() - this.silenceStart > silenceDuration) {
          this.stopRecording();
          return;
        }
      } else {
        this.silenceStart = null;
      }

      this.animationFrameId = requestAnimationFrame(checkSilence);
    };

    checkSilence();
  }

  /**
   * Stop recording audio.
   */
  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.isRecording.set(false);
      this.currentOptions.onRecordingStateChange?.(false);
    }

    // Clean up silence detection
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.microphone = null;
    this.silenceStart = null;
  }

  /**
   * Process the recorded audio blob and transcribe it.
   */
  private async processAudio(blob: Blob): Promise<void> {
    this.isTranscribing.set(true);
    this.currentOptions.onTranscribingStateChange?.(true);

    try {
      // Check/Load Whisper model
      const status = await this.aiService.checkModel('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      if (!status.loaded) {
        this.snackBar.open('Loading Whisper model...', 'Close', { duration: 2000 });
        await this.aiService.loadModel('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      }

      // Convert Blob to Float32Array
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);

      const result = await this.aiService.transcribeAudio(audioData) as { text: string };

      if (result && result.text) {
        let text = result.text.trim();
        // Apply transcription normalization rules
        text = this.applyTranscriptionRules(text);
        this.currentOptions.onTranscription?.(text);
      }
    } catch (err) {
      console.error('Transcription error:', err);
      this.snackBar.open('Transcription failed', 'Close', { duration: 3000 });
    } finally {
      this.isTranscribing.set(false);
      this.currentOptions.onTranscribingStateChange?.(false);
    }
  }

  /**
   * Transcribe an audio blob directly without recording.
   * Useful for processing pre-recorded audio.
   */
  async transcribeBlob(blob: Blob): Promise<string | null> {
    this.isTranscribing.set(true);

    try {
      // Check/Load Whisper model
      const status = await this.aiService.checkModel('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      if (!status.loaded) {
        this.snackBar.open('Loading Whisper model...', 'Close', { duration: 2000 });
        await this.aiService.loadModel('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
      }

      // Convert Blob to Float32Array
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);

      const result = await this.aiService.transcribeAudio(audioData) as { text: string };

      if (result && result.text) {
        let text = result.text.trim();
        // Apply transcription normalization rules
        text = this.applyTranscriptionRules(text);
        return text;
      }

      return null;
    } catch (err) {
      console.error('Transcription error:', err);
      this.snackBar.open('Transcription failed', 'Close', { duration: 3000 });
      return null;
    } finally {
      this.isTranscribing.set(false);
    }
  }

  /**
   * Clean up resources when the service is destroyed.
   */
  cleanup(): void {
    this.stopRecording();
  }
}
