import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { type Event, kinds } from 'nostr-tools';
import { AiModelLoadOptions, AiService } from './ai.service';
import { EventTtsPlaybackService } from './event-tts-playback.service';
import { RepostService } from './repost.service';
import { TtsTextService } from './tts-text.service';

export interface TtsSequenceModelOption {
  id: string;
  label: string;
  description: string;
  loadOptions?: AiModelLoadOptions;
}

export interface TtsSequenceVoiceOption {
  value: string;
  label: string;
  description?: string;
}

export interface TtsSequenceItem {
  eventId: string;
  text: string;
  paragraphs: string[];
  label: string;
}

export interface TtsSequenceState {
  requestId: number;
  source: 'feed' | 'thread' | 'article';
  title: string;
  items: TtsSequenceItem[];
  currentIndex: number;
  status: 'idle' | 'loading' | 'generating' | 'playing' | 'paused' | 'error';
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class TtsSequencePlayerService {
  private readonly ai = inject(AiService);
  private readonly eventTtsPlayback = inject(EventTtsPlaybackService);
  private readonly repostService = inject(RepostService);
  private readonly ttsText = inject(TtsTextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly webGpuAvailable = this.isBrowser && typeof navigator !== 'undefined' && 'gpu' in navigator;

  readonly models: TtsSequenceModelOption[] = [
    {
      id: this.ai.kokoroSpeechModelId,
      label: 'Kokoro 82M',
      description: this.webGpuAvailable ? 'WebGPU' : 'WASM',
      loadOptions: this.webGpuAvailable ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'q8', device: 'wasm' },
    },
    {
      id: this.ai.supertonicSpeechModelId,
      label: 'Supertonic 2',
      description: this.webGpuAvailable ? 'WebGPU' : 'WASM',
      loadOptions: this.webGpuAvailable ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'fp32', device: 'wasm' },
    },
    {
      id: this.ai.piperSpeechModelId,
      label: 'Piper LibriTTS',
      description: 'WASM · 904 voices',
    },
  ];

  readonly kokoroVoiceOptions: TtsSequenceVoiceOption[] = [
    { value: 'af_heart', label: 'Heart', description: 'American Female' },
    { value: 'af_alloy', label: 'Alloy', description: 'American Female' },
    { value: 'af_aoede', label: 'Aoede', description: 'American Female' },
    { value: 'af_bella', label: 'Bella', description: 'American Female' },
    { value: 'af_jessica', label: 'Jessica', description: 'American Female' },
    { value: 'af_kore', label: 'Kore', description: 'American Female' },
    { value: 'af_nicole', label: 'Nicole', description: 'American Female' },
    { value: 'af_nova', label: 'Nova', description: 'American Female' },
    { value: 'af_river', label: 'River', description: 'American Female' },
    { value: 'af_sarah', label: 'Sarah', description: 'American Female' },
    { value: 'af_sky', label: 'Sky', description: 'American Female' },
    { value: 'am_adam', label: 'Adam', description: 'American Male' },
    { value: 'am_echo', label: 'Echo', description: 'American Male' },
    { value: 'am_eric', label: 'Eric', description: 'American Male' },
    { value: 'am_fenrir', label: 'Fenrir', description: 'American Male' },
    { value: 'am_liam', label: 'Liam', description: 'American Male' },
    { value: 'am_michael', label: 'Michael', description: 'American Male' },
    { value: 'am_onyx', label: 'Onyx', description: 'American Male' },
    { value: 'am_puck', label: 'Puck', description: 'American Male' },
    { value: 'am_santa', label: 'Santa', description: 'American Male' },
    { value: 'bf_alice', label: 'Alice', description: 'British Female' },
    { value: 'bf_emma', label: 'Emma', description: 'British Female' },
    { value: 'bf_isabella', label: 'Isabella', description: 'British Female' },
    { value: 'bf_lily', label: 'Lily', description: 'British Female' },
    { value: 'bm_daniel', label: 'Daniel', description: 'British Male' },
    { value: 'bm_fable', label: 'Fable', description: 'British Male' },
    { value: 'bm_george', label: 'George', description: 'British Male' },
    { value: 'bm_lewis', label: 'Lewis', description: 'British Male' },
  ];

  readonly supertonicVoiceOptions: TtsSequenceVoiceOption[] = [
    { value: 'F1', label: 'Calm', description: 'Female' },
    { value: 'F2', label: 'Cheerful', description: 'Female' },
    { value: 'F3', label: 'Professional', description: 'Female' },
    { value: 'F4', label: 'Confident', description: 'Female' },
    { value: 'F5', label: 'Gentle', description: 'Female' },
    { value: 'M1', label: 'Energetic', description: 'Male' },
    { value: 'M2', label: 'Deep', description: 'Male' },
    { value: 'M3', label: 'Authoritative', description: 'Male' },
    { value: 'M4', label: 'Friendly', description: 'Male' },
    { value: 'M5', label: 'Storyteller', description: 'Male' },
  ];

  readonly piperVoiceOptions: TtsSequenceVoiceOption[] = Array.from({ length: 904 }, (_, index) => ({
    value: String(index),
    label: `Voice ${index + 1}`,
  }));

  readonly speedOptions = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2];

  readonly state = signal<TtsSequenceState | null>(null);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly selectedModelId = signal(this.ai.kokoroSpeechModelId);
  readonly selectedSpeed = signal(1);

  readonly currentItem = computed(() => {
    const state = this.state();
    return state?.items[state.currentIndex] ?? null;
  });

  readonly currentModel = computed(() => this.models.find(model => model.id === this.selectedModelId()) ?? this.models[0]);
  readonly canPrevious = computed(() => (this.state()?.currentIndex ?? 0) > 0);
  readonly canNext = computed(() => {
    const state = this.state();
    return !!state && state.currentIndex < state.items.length - 1;
  });

  readonly voiceOptions = computed(() => {
    const modelId = this.selectedModelId();
    if (modelId === this.ai.supertonicSpeechModelId) return this.supertonicVoiceOptions;
    if (modelId === this.ai.piperSpeechModelId) return this.piperVoiceOptions;
    return this.kokoroVoiceOptions;
  });

  readonly selectedVoice = computed(() => {
    const settings = this.ai.cloudSettings();
    const modelId = this.selectedModelId();
    if (modelId === this.ai.supertonicSpeechModelId) return settings.supertonicVoiceId;
    if (modelId === this.ai.piperSpeechModelId) return String(settings.piperVoiceId);
    return settings.kokoroVoiceId;
  });

  readonly selectedVoiceLabel = computed(() => {
    const selected = this.selectedVoice();
    return this.voiceOptions().find(option => option.value === selected)?.label ?? selected;
  });

  readonly activeParagraphIndex = computed(() => {
    const item = this.currentItem();
    const duration = this.duration();
    if (!item || item.paragraphs.length <= 1 || duration <= 0) {
      return 0;
    }

    return Math.min(item.paragraphs.length - 1, Math.floor((this.currentTime() / duration) * item.paragraphs.length));
  });

  readonly activeParagraph = computed(() => {
    const item = this.currentItem();
    return item?.paragraphs[this.activeParagraphIndex()] ?? '';
  });

  private audio: HTMLAudioElement | null = null;
  private currentObjectUrl: string | null = null;
  private requestId = 0;

  start(source: 'feed' | 'thread', title: string, events: Event[], modelId = this.selectedModelId()): void {
    this.eventTtsPlayback.close();
    this.close();

    const requestId = ++this.requestId;
    this.selectedModelId.set(modelId);
    this.applyCurrentSettings();
    this.state.set({ requestId, source, title, items: [], currentIndex: 0, status: 'loading', message: 'Preparing speech...' });
    void this.prepareAndPlay(requestId, events);
  }

  startArticle(title: string, item: TtsSequenceItem, modelId = this.selectedModelId()): void {
    this.eventTtsPlayback.close();
    this.close();

    const requestId = ++this.requestId;
    this.selectedModelId.set(modelId);
    this.applyCurrentSettings();
    this.state.set({
      requestId,
      source: 'article',
      title,
      items: [item],
      currentIndex: 0,
      status: 'loading',
      message: 'Preparing speech...',
    });
    void this.generateAndPlay(requestId);
  }

  toggle(): void {
    const state = this.state();
    if (!state || !this.audio) return;

    if (this.audio.paused) {
      void this.audio.play();
      this.patchState({ status: 'playing', message: undefined });
    } else {
      this.audio.pause();
      this.patchState({ status: 'paused' });
    }
  }

  previous(): void {
    const state = this.state();
    if (!state || state.currentIndex <= 0) return;
    this.jumpTo(state.currentIndex - 1);
  }

  next(): void {
    const state = this.state();
    if (!state || state.currentIndex >= state.items.length - 1) return;
    this.jumpTo(state.currentIndex + 1);
  }

  close(): void {
    this.requestId++;
    this.disposeAudio();
    this.state.set(null);
    this.currentTime.set(0);
    this.duration.set(0);
  }

  selectModel(modelId: string): void {
    if (!this.models.some(model => model.id === modelId)) return;
    this.selectedModelId.set(modelId);
    this.applyCurrentSettings();
    this.restartCurrent();
  }

  selectVoice(value: string): void {
    const modelId = this.selectedModelId();
    if (modelId === this.ai.supertonicSpeechModelId) {
      this.ai.updateCloudSettings({ supertonicVoiceId: value });
    } else if (modelId === this.ai.piperSpeechModelId) {
      const parsed = Number.parseInt(value, 10);
      this.ai.updateCloudSettings({ piperVoiceId: Number.isFinite(parsed) ? parsed : 0 });
    } else {
      this.ai.updateCloudSettings({ kokoroVoiceId: value });
    }
    this.restartCurrent();
  }

  selectSpeed(speed: number): void {
    const boundedSpeed = Math.min(Math.max(speed, 0.5), 2);
    this.selectedSpeed.set(boundedSpeed);
    this.applyCurrentSettings();
    if (this.audio) {
      this.audio.playbackRate = boundedSpeed;
    }
  }

  isActiveEvent(eventId: string | undefined): boolean {
    return !!eventId && this.currentItem()?.eventId === eventId && !!this.state();
  }

  private restartCurrent(): void {
    const state = this.state();
    if (!state) return;

    const requestId = ++this.requestId;
    this.disposeAudio();
    this.state.set({ ...state, requestId, status: 'loading', message: 'Preparing speech...' });
    void this.generateAndPlay(requestId);
  }

  private jumpTo(currentIndex: number): void {
    const state = this.state();
    if (!state) return;

    const requestId = ++this.requestId;
    this.disposeAudio();
    this.state.set({ ...state, requestId, currentIndex, status: 'loading', message: 'Preparing speech...' });
    this.currentTime.set(0);
    this.duration.set(0);
    void this.generateAndPlay(requestId);
  }

  private async generateAndPlay(requestId: number): Promise<void> {
    const state = this.state();
    const item = this.currentItem();
    const model = this.currentModel();
    if (!state || !item || state.requestId !== requestId) return;

    try {
      if (!this.ai.isModelLoaded(model.id)) {
        this.patchState({ status: 'loading', message: `Loading ${model.label}...` });
        await this.ai.loadModel(
          'text-to-speech',
          model.id,
          data => this.onLoadProgress(requestId, model.label, data),
          model.loadOptions,
        );
      }

      if (!this.isCurrent(requestId)) return;

      this.applyCurrentSettings();
      this.patchState({ status: 'generating', message: `Generating post ${state.currentIndex + 1} of ${state.items.length}...` });
      const [audio] = await this.ai.generateVoice(item.text, 'local', model.id);
      if (!audio) {
        throw new Error('No audio was generated.');
      }

      if (!this.isCurrent(requestId)) {
        URL.revokeObjectURL(audio.src);
        return;
      }

      await this.playObjectUrl(requestId, audio.src);
    } catch (error) {
      if (!this.isCurrent(requestId)) return;
      this.patchState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private onLoadProgress(requestId: number, modelLabel: string, data: unknown): void {
    if (!this.isCurrent(requestId)) return;

    const payload = data as { status?: string; progress?: number; file?: string };
    const progress = typeof payload.progress === 'number' ? ` ${Math.round(payload.progress)}%` : '';
    const file = payload.file ? ` ${payload.file}` : '';
    this.patchState({ status: 'loading', message: `Loading ${modelLabel}${progress}${file}` });
  }

  private async playObjectUrl(requestId: number, src: string): Promise<void> {
    this.disposeAudio();
    this.currentObjectUrl = src;

    const audio = new Audio(src);
    this.audio = audio;
    audio.playbackRate = this.selectedSpeed();
    audio.onloadedmetadata = () => {
      if (this.isCurrent(requestId)) {
        this.duration.set(Number.isFinite(audio.duration) ? audio.duration : 0);
      }
    };
    audio.ontimeupdate = () => {
      if (this.isCurrent(requestId)) {
        this.currentTime.set(audio.currentTime);
      }
    };
    audio.onended = () => {
      if (!this.isCurrent(requestId)) return;
      if (this.canNext()) {
        this.next();
      } else {
        this.patchState({ status: 'paused', message: 'Finished' });
      }
    };
    audio.onerror = () => {
      if (this.isCurrent(requestId)) {
        this.patchState({ status: 'error', message: 'Playback failed.' });
      }
    };

    await audio.play();
    if (this.isCurrent(requestId)) {
      this.patchState({ status: 'playing', message: undefined });
    }
  }

  private applyCurrentSettings(): void {
    const speed = this.selectedSpeed();
    const modelId = this.selectedModelId();
    if (modelId === this.ai.supertonicSpeechModelId) {
      this.ai.updateCloudSettings({ supertonicVoiceSpeed: speed });
    } else if (modelId === this.ai.piperSpeechModelId) {
      this.ai.updateCloudSettings({ piperVoiceSpeed: speed });
    } else {
      this.ai.updateCloudSettings({ kokoroVoiceSpeed: speed });
    }
  }

  private async prepareAndPlay(requestId: number, events: Event[]): Promise<void> {
    const items = await this.buildItems(events);
    if (!this.isCurrent(requestId)) return;

    if (items.length === 0) {
      this.patchState({
        items,
        currentIndex: 0,
        status: 'error',
        message: 'No readable text found.',
      });
      return;
    }

    this.patchState({ items, currentIndex: 0, status: 'loading', message: 'Preparing speech...' });
    await this.generateAndPlay(requestId);
  }

  private async buildItems(events: Event[]): Promise<TtsSequenceItem[]> {
    const items = await Promise.all(events.map(event => this.buildItem(event)));
    return items.filter((item): item is TtsSequenceItem => !!item && item.text.length > 0);
  }

  private async buildItem(event: Event): Promise<TtsSequenceItem | null> {
    const speechEvent = this.resolveSpeechEvent(event);
    if (!speechEvent || (speechEvent.kind !== kinds.ShortTextNote && speechEvent.kind !== kinds.LongFormArticle)) {
      return null;
    }

    const { text, paragraphs } = await this.ttsText.fromEvent(speechEvent);
    return {
      eventId: event.id,
      text,
      paragraphs,
      label: text.length > 80 ? `${text.slice(0, 77)}...` : text,
    };
  }

  private resolveSpeechEvent(event: Event): Event | null {
    if (!this.repostService.isRepostEvent(event)) {
      return event;
    }

    return this.repostService.decodeRepost(event)?.event ?? null;
  }

  private patchState(patch: Partial<TtsSequenceState>): void {
    const state = this.state();
    if (!state) return;
    this.state.set({ ...state, ...patch });
  }

  private isCurrent(requestId: number): boolean {
    return this.state()?.requestId === requestId;
  }

  private disposeAudio(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.load();
      this.audio = null;
    }

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }
}
