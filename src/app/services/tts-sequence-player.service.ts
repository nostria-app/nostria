import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { type Event, kinds } from 'nostr-tools';
import { AiModelLoadOptions, AiService } from './ai.service';
import { EventTtsPlaybackService } from './event-tts-playback.service';
import { RepostService } from './repost.service';
import { TtsTextService } from './tts-text.service';
import { AiModelDownloadProgressTracker } from '../utils/ai-model-download-progress';
import { DataService } from './data.service';
import { UtilitiesService } from './utilities.service';

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
  eventPartIndex?: number;
  eventPartTotal?: number;
  articleTarget?: 'title' | 'summary' | 'body';
  articleBlockIndex?: number;
  articleParagraphIndex?: number;
}

export interface TtsSequenceState {
  requestId: number;
  source: 'feed' | 'profile' | 'thread' | 'article';
  title: string;
  items: TtsSequenceItem[];
  currentIndex: number;
  status: 'idle' | 'loading' | 'generating' | 'playing' | 'paused' | 'error';
  message?: string;
}

interface AudioCacheEntry {
  key: string;
  promise: Promise<string>;
  src?: string;
}

interface ReadableEventContext {
  event: Event;
  speechEvent: Event;
  announceAuthor: boolean;
}

@Injectable({ providedIn: 'root' })
export class TtsSequencePlayerService {
  private readonly ai = inject(AiService);
  private readonly eventTtsPlayback = inject(EventTtsPlaybackService);
  private readonly repostService = inject(RepostService);
  private readonly ttsText = inject(TtsTextService);
  private readonly data = inject(DataService);
  private readonly utilities = inject(UtilitiesService);
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
  readonly canPrevious = computed(() => {
    const state = this.state();
    if (!state || state.currentIndex <= 0) return false;
    if (state.source === 'article') return true;

    return this.findPreviousEventIndex(state) !== null;
  });
  readonly canNext = computed(() => {
    const state = this.state();
    if (!state || state.currentIndex >= state.items.length - 1) return false;
    if (state.source === 'article') return true;

    return this.findNextEventIndex(state) !== null;
  });
  readonly positionLabel = computed(() => {
    const state = this.state();
    if (!state) return '';
    if (state.source === 'article') return this.articleProgressLabel(state);

    const total = this.countContiguousEvents(state.items);
    const current = this.countContiguousEvents(state.items.slice(0, state.currentIndex + 1));
    return `${current} / ${total}`;
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
  private readonly maxTtsChunkLength = 520;
  private readonly audioCache = new Map<number, AudioCacheEntry>();

  start(source: 'feed' | 'profile' | 'thread', title: string, events: Event[], modelId = this.selectedModelId()): void {
    this.eventTtsPlayback.close();
    this.close();
    this.clearAudioCache();

    const requestId = ++this.requestId;
    this.selectedModelId.set(modelId);
    this.applyCurrentSettings();
    this.state.set({ requestId, source, title, items: [], currentIndex: 0, status: 'loading', message: 'Preparing speech...' });
    void this.prepareAndPlay(requestId, events);
  }

  startArticle(title: string, items: TtsSequenceItem[], modelId = this.selectedModelId()): void {
    const readableItems = items.filter(item => item.text.trim().length > 0);
    if (readableItems.length === 0) {
      return;
    }

    this.eventTtsPlayback.close();
    this.close();
    this.clearAudioCache();

    const requestId = ++this.requestId;
    this.selectedModelId.set(modelId);
    this.applyCurrentSettings();
    this.state.set({
      requestId,
      source: 'article',
      title,
      items: readableItems,
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

    if (state.source === 'article') {
      this.jumpTo(state.currentIndex - 1);
      return;
    }

    const previousEventIndex = this.findPreviousEventIndex(state);
    if (previousEventIndex !== null) {
      this.jumpTo(previousEventIndex);
    }
  }

  next(): void {
    const state = this.state();
    if (!state || state.currentIndex >= state.items.length - 1) return;

    if (state.source === 'article') {
      this.jumpTo(state.currentIndex + 1);
      return;
    }

    const nextEventIndex = this.findNextEventIndex(state);
    if (nextEventIndex !== null) {
      this.jumpTo(nextEventIndex);
    }
  }

  close(): void {
    this.requestId++;
    this.disposeAudio();
    this.clearAudioCache();
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
    this.clearAudioCache();
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
        const progressTracker = new AiModelDownloadProgressTracker(model.label);
        await this.ai.loadModel(
          'text-to-speech',
          model.id,
          data => this.onLoadProgress(requestId, progressTracker, data),
          model.loadOptions,
        );
      }

      if (!this.isCurrent(requestId)) return;

      this.patchState({ status: 'generating', message: 'Generating speech...' });
      const src = await this.getAudioUrlForIndex(state.currentIndex, item, model);

      if (!this.isCurrent(requestId)) {
        URL.revokeObjectURL(src);
        return;
      }

      await this.playObjectUrl(requestId, src);
      this.prefetchNextAudio(requestId);
    } catch (error) {
      if (!this.isCurrent(requestId)) return;
      this.patchState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private onLoadProgress(requestId: number, progressTracker: AiModelDownloadProgressTracker, data: unknown): void {
    if (!this.isCurrent(requestId)) return;

    const progress = progressTracker.update(data);
    if (!progress) return;

    const percent = progress.progress === null ? '' : ` ${progress.progress}%`;
    const file = progress.file ? ` · ${progress.file}` : '';
    const size = this.formatProgressSize(progress.loadedBytes, progress.totalBytes);
    this.patchState({ status: 'loading', message: `${progress.status} ${progress.modelName}${percent}${file}${size}` });
  }

  private formatProgressSize(loadedBytes: number | null, totalBytes: number | null): string {
    if (loadedBytes === null) {
      return '';
    }

    if (totalBytes !== null && totalBytes > 0) {
      return ` · ${this.formatFileSize(loadedBytes)} of ${this.formatFileSize(totalBytes)}`;
    }

    return ` · ${this.formatFileSize(loadedBytes)}`;
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
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
      const state = this.state();
      if (state && state.currentIndex < state.items.length - 1) {
        this.jumpTo(state.currentIndex + 1);
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

  private getAudioUrlForIndex(index: number, item: TtsSequenceItem, model: TtsSequenceModelOption): Promise<string> {
    const key = this.getAudioCacheKey(item, model);
    const entry = this.ensureAudioCacheEntry(index, key, item, model);

    return entry.promise.then(src => {
      if (this.audioCache.get(index) === entry) {
        entry.src = undefined;
        this.audioCache.delete(index);
      }

      return src;
    });
  }

  private prefetchNextAudio(requestId: number): void {
    const state = this.state();
    if (!state || !this.isCurrent(requestId) || state.currentIndex >= state.items.length - 1) {
      return;
    }

    const nextIndex = state.currentIndex + 1;
    const nextItem = state.items[nextIndex];
    const model = this.currentModel();
    if (!nextItem || !this.ai.isModelLoaded(model.id)) {
      return;
    }

    const key = this.getAudioCacheKey(nextItem, model);
    this.ensureAudioCacheEntry(nextIndex, key, nextItem, model).promise.catch(() => undefined);
  }

  private ensureAudioCacheEntry(
    index: number,
    key: string,
    item: TtsSequenceItem,
    model: TtsSequenceModelOption,
  ): AudioCacheEntry {
    const existing = this.audioCache.get(index);
    if (existing?.key === key) {
      return existing;
    }

    if (existing?.src) {
      URL.revokeObjectURL(existing.src);
    }

    const entry: AudioCacheEntry = {
      key,
      promise: Promise.resolve(''),
    };

    entry.promise = this.createAudioUrlPromise(index, key, item, model, entry);
    this.audioCache.set(index, entry);
    return entry;
  }

  private async createAudioUrlPromise(
    index: number,
    key: string,
    item: TtsSequenceItem,
    model: TtsSequenceModelOption,
    entry: AudioCacheEntry,
  ): Promise<string> {
    this.applyCurrentSettings();
    const [audio] = await this.ai.generateVoice(item.text, 'local', model.id);
    if (!audio) {
      throw new Error('No audio was generated.');
    }

    if (this.audioCache.get(index)?.key !== key) {
      URL.revokeObjectURL(audio.src);
      throw new Error('Speech generation was superseded.');
    }

    entry.src = audio.src;
    return audio.src;
  }

  private getAudioCacheKey(item: TtsSequenceItem, model: TtsSequenceModelOption): string {
    return [
      model.id,
      this.selectedVoice(),
      this.selectedSpeed(),
      item.text,
    ].join('\u001f');
  }

  private clearAudioCache(): void {
    for (const entry of this.audioCache.values()) {
      if (entry.src) {
        URL.revokeObjectURL(entry.src);
      } else {
        entry.promise.then(src => URL.revokeObjectURL(src)).catch(() => undefined);
      }
    }

    this.audioCache.clear();
  }

  private async prepareAndPlay(requestId: number, events: Event[]): Promise<void> {
    const state = this.state();
    if (!state || state.requestId !== requestId) return;

    const items = await this.buildItems(events, state.source);
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

  private async buildItems(events: Event[], source: TtsSequenceState['source']): Promise<TtsSequenceItem[]> {
    const contexts = events
      .map(event => this.createReadableEventContext(event, source))
      .filter(context => context !== null);
    const authorNames = await this.getAuthorNames(contexts);
    const eventItems = await Promise.all(contexts.map(context => this.buildItemsForEvent(context, authorNames)));
    return eventItems.flat().filter(item => item.text.length > 0);
  }

  private async buildItemsForEvent(
    context: ReadableEventContext,
    authorNames: Map<string, string>,
  ): Promise<TtsSequenceItem[]> {
    const { event, speechEvent, announceAuthor } = context;
    const { text, paragraphs } = await this.ttsText.fromEvent(speechEvent);
    const chunks = this.chunkSpeechText(paragraphs.length > 0 ? paragraphs : [text]);
    return chunks.map((chunk, index) => {
      const speechText = this.withAuthorAnnouncement(
        chunk,
        index,
        announceAuthor ? authorNames.get(speechEvent.pubkey) : undefined,
      );

      return {
        eventId: event.id,
        text: speechText,
        paragraphs: [speechText],
        label: chunk.length > 80 ? `${chunk.slice(0, 77)}...` : chunk,
        eventPartIndex: index,
        eventPartTotal: chunks.length,
      };
    });
  }

  private createReadableEventContext(event: Event, source: TtsSequenceState['source']): ReadableEventContext | null {
    const speechEvent = this.resolveSpeechEvent(event);
    if (!speechEvent || (speechEvent.kind !== kinds.ShortTextNote && speechEvent.kind !== kinds.LongFormArticle)) {
      return null;
    }

    return {
      event,
      speechEvent,
      announceAuthor: source === 'feed' || (source === 'profile' && this.repostService.isRepostEvent(event)),
    };
  }

  private async getAuthorNames(contexts: ReadableEventContext[]): Promise<Map<string, string>> {
    const pubkeys = Array.from(new Set(
      contexts
        .filter(context => context.announceAuthor)
        .map(context => context.speechEvent.pubkey)
    ));
    if (pubkeys.length === 0) {
      return new Map();
    }

    const profiles = await this.data.batchLoadProfiles(pubkeys, undefined, true);
    return new Map(pubkeys.map(pubkey => [pubkey, this.getAuthorName(pubkey, profiles)]));
  }

  private getAuthorName(pubkey: string, profiles: Map<string, { data: unknown }>): string {
    const data = profiles.get(pubkey)?.data;
    if (data && typeof data === 'object') {
      const profile = data as { display_name?: unknown; name?: unknown; nip05?: unknown };
      const name = this.firstString(profile.display_name, profile.name, profile.nip05);
      if (name) {
        return name;
      }
    }

    return this.utilities.getTruncatedNpub(pubkey);
  }

  private firstString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return '';
  }

  private withAuthorAnnouncement(chunk: string, index: number, authorName: string | undefined): string {
    if (index > 0 || !authorName) {
      return chunk;
    }

    return `${authorName} wrote.\n\n${chunk}`;
  }

  private chunkSpeechText(paragraphs: string[]): string[] {
    const chunks: string[] = [];

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.length <= this.maxTtsChunkLength) {
        chunks.push(trimmed);
        continue;
      }

      chunks.push(...this.splitLongParagraph(trimmed));
    }

    return chunks.filter(Boolean);
  }

  private splitLongParagraph(paragraph: string): string[] {
    const sentences = paragraph.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
      ?.map(sentence => sentence.trim())
      .filter(Boolean) ?? [paragraph];
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (sentence.length > this.maxTtsChunkLength) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(...this.splitTextByWords(sentence));
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > this.maxTtsChunkLength && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = candidate;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  private splitTextByWords(text: string): string[] {
    const chunks: string[] = [];
    let current = '';

    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > this.maxTtsChunkLength && current) {
        chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  private findNextEventIndex(state: TtsSequenceState): number | null {
    const currentEventId = state.items[state.currentIndex]?.eventId;
    for (let index = state.currentIndex + 1; index < state.items.length; index++) {
      if (state.items[index].eventId !== currentEventId) {
        return index;
      }
    }

    return null;
  }

  private findPreviousEventIndex(state: TtsSequenceState): number | null {
    const currentEventId = state.items[state.currentIndex]?.eventId;
    let index = state.currentIndex - 1;
    while (index >= 0 && state.items[index].eventId === currentEventId) {
      index--;
    }

    if (index < 0) {
      return null;
    }

    const previousEventId = state.items[index].eventId;
    while (index > 0 && state.items[index - 1].eventId === previousEventId) {
      index--;
    }

    return index;
  }

  private countContiguousEvents(items: TtsSequenceItem[]): number {
    let count = 0;
    let previousEventId = '';

    for (const item of items) {
      if (item.eventId !== previousEventId) {
        count++;
        previousEventId = item.eventId;
      }
    }

    return count;
  }

  private articleProgressLabel(state: TtsSequenceState): string {
    const total = state.items.length;
    if (total === 0) return '';

    const duration = this.duration();
    const currentTime = this.currentTime();
    const sectionProgress = duration > 0
      ? Math.min(Math.max(currentTime / duration, 0), 1)
      : 0;
    const completedSections = Math.min(total, state.currentIndex + sectionProgress);
    const percent = Math.min(100, Math.max(0, Math.round((completedSections / total) * 100)));

    return `${percent}% read`;
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
