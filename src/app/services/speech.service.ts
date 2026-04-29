import { inject, Injectable, signal } from '@angular/core';
import { AiService } from './ai.service';
import { SettingsService } from './settings.service';
import { LocalStorageService } from './local-storage.service';
import type { AiModelLoadOptions } from './ai.service';

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

export interface DictationModelOption {
  id: string;
  name: string;
  description: string;
  size: string;
  runtime: string;
  loadOptions?: AiModelLoadOptions;
}

@Injectable({
  providedIn: 'root'
})
export class SpeechService {
  private static readonly SELECTED_MODEL_STORAGE_KEY = 'nostria-dictation-model';

  private aiService = inject(AiService);
  private settings = inject(SettingsService);
  private localStorage = inject(LocalStorageService);

  readonly transcriptionModels: DictationModelOption[] = [
    {
      id: 'Xenova/whisper-tiny.en',
      name: 'Whisper Tiny',
      description: 'Current default. Small English dictation model.',
      size: '~40MB',
      runtime: 'WASM/CPU',
      loadOptions: { device: 'wasm', dtype: 'fp32' },
    },
    {
      id: 'onnx-community/moonshine-tiny-ONNX',
      name: 'Moonshine Tiny',
      description: 'Fast, lightweight local ASR model.',
      size: '~60MB',
      runtime: 'WASM/CPU',
      loadOptions: { device: 'wasm', dtype: 'fp32' },
    },
    {
      id: 'onnx-community/granite-4.0-1b-speech-ONNX',
      name: 'Granite 4.0 1B',
      description: 'Larger multilingual speech model.',
      size: '~1B params',
      runtime: this.webGpuAvailable() ? 'WebGPU' : 'WASM/CPU',
      loadOptions: this.webGpuAvailable() ? { device: 'webgpu', dtype: 'fp32' } : { device: 'wasm', dtype: 'fp32' },
    },
    {
      id: 'onnx-community/whisper-large-v3-turbo',
      name: 'Whisper Large V3 Turbo',
      description: 'Higher quality Whisper Turbo model.',
      size: '~809MB',
      runtime: this.webGpuAvailable() ? 'WebGPU' : 'WASM/CPU',
      loadOptions: this.webGpuAvailable() ? { device: 'webgpu', dtype: 'fp32' } : { device: 'wasm', dtype: 'fp32' },
    },
  ];

  readonly selectedTranscriptionModel = signal<DictationModelOption>(this.getInitialTranscriptionModel());

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

  selectTranscriptionModel(modelId: string): void {
    const model = this.transcriptionModels.find(option => option.id === modelId);
    if (!model) {
      return;
    }

    this.selectedTranscriptionModel.set(model);
    this.localStorage.setItem(SpeechService.SELECTED_MODEL_STORAGE_KEY, model.id);
  }

  /**
   * Transcription normalization rules.
   * These are applied after the Whisper model transcribes the audio
   * to correct common misinterpretations and convert spoken symbols.
   * 
   * IMPORTANT: Order matters! More specific patterns should come before general ones.
   */
  private readonly transcriptionRules: TranscriptionRule[] = [
    // === FORMATTING (must be FIRST to prevent "hashtag new paragraph" → "#new #paragraph") ===
    { pattern: /\bnew\s*paragraph\b/gi, replacement: '\n\n' },
    { pattern: /\bNewParagraph\b/g, replacement: '\n\n' },
    { pattern: /\bnew\s*line\b/gi, replacement: '\n' },
    { pattern: /\bNewLine\b/g, replacement: '\n' },
    { pattern: /\bnewline\b/gi, replacement: '\n' },
    { pattern: /\bparagraph\b/gi, replacement: '\n\n' },

    // === PHRASE CORRECTIONS (most specific, applied first) ===

    // "hashtag ask nostr" variations → #asknostr
    { pattern: /\bhashtag\s+ask\s*nostr\b/gi, replacement: '#asknostr' },
    { pattern: /\bhashtag\s+ask\s*nuster\b/gi, replacement: '#asknostr' },
    { pattern: /\bhashtag\s+ask\s*noster\b/gi, replacement: '#asknostr' },
    { pattern: /\bhashtag\s+ask\s*nostre\b/gi, replacement: '#asknostr' },
    { pattern: /\bhashtag\s+ask\s*nostro\b/gi, replacement: '#asknostr' },
    { pattern: /\bhashtag\s+ask\s*nostra\b/gi, replacement: '#asknostr' },
    { pattern: /\bhash\s+tag\s+ask\s*nostr\b/gi, replacement: '#asknostr' },

    // "hashtag nostr" → #nostr
    { pattern: /\bhashtag\s+nostr\b/gi, replacement: '#nostr' },
    { pattern: /\bhashtag\s+nuster\b/gi, replacement: '#nostr' },
    { pattern: /\bhashtag\s+noster\b/gi, replacement: '#nostr' },
    { pattern: /\bhash\s+tag\s+nostr\b/gi, replacement: '#nostr' },

    // "ask nostr" phrase corrections → asknostr (no space, for hashtag search)
    { pattern: /\basknuster\b/gi, replacement: 'asknostr' },
    { pattern: /\bask\s+nuster\b/gi, replacement: 'asknostr' },
    { pattern: /\bask\s+noster\b/gi, replacement: 'asknostr' },
    { pattern: /\bask\s+nostre\b/gi, replacement: 'asknostr' },
    { pattern: /\bAskNoster\b/gi, replacement: 'asknostr' },
    { pattern: /\bAskNuster\b/gi, replacement: 'asknostr' },
    { pattern: /\bask\s+nostro\b/gi, replacement: 'asknostr' },
    { pattern: /\bask\s+nostra\b/gi, replacement: 'asknostr' },
    { pattern: /\bAskNostered\b/gi, replacement: 'asknostr' },
    { pattern: /\bask\s+nostr\b/gi, replacement: 'asknostr' },

    // === SINGLE WORD CORRECTIONS ===

    // Nostr-specific corrections (standalone word)
    { pattern: /\bnuster\b/gi, replacement: 'nostr' },
    { pattern: /\bnostre\b/gi, replacement: 'nostr' },
    { pattern: /\bnostro\b/gi, replacement: 'nostr' },
    { pattern: /\bnoster\b/gi, replacement: 'nostr' },
    { pattern: /\bknoster\b/gi, replacement: 'nostr' },
    { pattern: /\bnostra\b/gi, replacement: 'nostr' },
    { pattern: /\bnosta\b/gi, replacement: 'nostr' },

    // === SYMBOL CONVERSIONS ===

    // Hashtag with following word (captures the word after)
    { pattern: /\bhashtag\s+(\w+)/gi, replacement: '#$1' },
    { pattern: /\bhash\s+tag\s+(\w+)/gi, replacement: '#$1' },
    // Standalone hashtag (rare, but handle it)
    { pattern: /\bhashtag\b/gi, replacement: '#' },
    { pattern: /\bhash\s+tag\b/gi, replacement: '#' },

    // Other symbols
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
      const model = this.selectedTranscriptionModel();
      const status = await this.aiService.checkModel('automatic-speech-recognition', model.id);
      if (!status.loaded) {
        await this.aiService.loadModel('automatic-speech-recognition', model.id, undefined, model.loadOptions);
      }

      // Convert Blob to Float32Array
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = new Float32Array(audioBuffer.getChannelData(0));
      await audioContext.close();

      const result = await this.aiService.transcribeAudio(audioData) as { text: string };

      if (result && result.text) {
        let text = result.text.trim();
        // Apply transcription normalization rules
        text = this.applyTranscriptionRules(text);
        this.currentOptions.onTranscription?.(text);
      }
    } catch (err) {
      console.error('Transcription error:', err);
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
      const model = this.selectedTranscriptionModel();
      const status = await this.aiService.checkModel('automatic-speech-recognition', model.id);
      if (!status.loaded) {
        await this.aiService.loadModel('automatic-speech-recognition', model.id, undefined, model.loadOptions);
      }

      // Convert Blob to Float32Array
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = new Float32Array(audioBuffer.getChannelData(0));
      await audioContext.close();

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

  private getInitialTranscriptionModel(): DictationModelOption {
    const storedModelId = this.localStorage.getItem(SpeechService.SELECTED_MODEL_STORAGE_KEY);
    return this.transcriptionModels.find(model => model.id === storedModelId)
      ?? this.transcriptionModels[0];
  }

  private webGpuAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }
}
