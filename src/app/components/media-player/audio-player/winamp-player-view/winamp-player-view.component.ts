import {
  Component,
  inject,
  computed,
  signal,
  ChangeDetectionStrategy,
  output,
  OnInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { SwipeGestureDirective, SwipeEvent, SwipeProgressEvent } from '../../../../directives/swipe-gesture.directive';
import { LyricsViewComponent } from '../lyrics-view/lyrics-view.component';

// EQ Frequency bands (in Hz) matching WinAmp
const EQ_FREQUENCIES = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const EQ_FREQUENCY_LABELS = ['70', '180', '320', '600', '1K', '3K', '6K', '12K', '14K', '16K'];

// EQ Presets matching classic WinAmp presets
const EQ_PRESETS: Record<string, { preamp: number; bands: number[] }> = {
  'Flat': { preamp: 50, bands: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50] },
  'Classical': { preamp: 50, bands: [50, 50, 50, 50, 50, 50, 30, 30, 30, 20] },
  'Club': { preamp: 50, bands: [50, 50, 62, 68, 68, 68, 62, 50, 50, 50] },
  'Dance': { preamp: 50, bands: [74, 80, 66, 50, 50, 34, 30, 30, 50, 50] },
  'Full Bass': { preamp: 50, bands: [74, 74, 74, 68, 56, 40, 32, 28, 24, 24] },
  'Full Bass & Treble': { preamp: 50, bands: [80, 68, 50, 30, 36, 56, 86, 90, 92, 92] },
  'Full Treble': { preamp: 50, bands: [26, 26, 26, 40, 58, 90, 100, 100, 100, 100] },
  'Laptop Speakers': { preamp: 50, bands: [68, 90, 68, 40, 36, 56, 68, 86, 92, 96] },
  'Large Hall': { preamp: 50, bands: [90, 90, 68, 68, 50, 36, 36, 36, 50, 50] },
  'Live': { preamp: 50, bands: [36, 50, 62, 66, 68, 68, 62, 56, 56, 58] },
  'Party': { preamp: 50, bands: [80, 80, 50, 50, 50, 50, 50, 50, 80, 80] },
  'Pop': { preamp: 50, bands: [40, 56, 80, 86, 68, 50, 40, 40, 40, 40] },
  'Reggae': { preamp: 50, bands: [50, 50, 46, 34, 50, 74, 74, 50, 50, 50] },
  'Rock': { preamp: 50, bands: [86, 62, 34, 26, 44, 62, 90, 96, 96, 96] },
  'Ska': { preamp: 50, bands: [36, 36, 50, 44, 62, 68, 90, 96, 90, 96] },
  'Soft': { preamp: 50, bands: [56, 56, 68, 62, 56, 40, 26, 36, 46, 52] },
  'Soft Rock': { preamp: 50, bands: [62, 62, 66, 46, 32, 40, 52, 56, 68, 90] },
  'Techno': { preamp: 50, bands: [86, 68, 50, 34, 36, 50, 86, 96, 96, 90] },
};

@Component({
  selector: 'app-winamp-player-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    SwipeGestureDirective,
    LyricsViewComponent,
  ],
  templateUrl: './winamp-player-view.component.html',
  styleUrl: './winamp-player-view.component.scss',
})
export class WinampPlayerViewComponent implements OnInit, OnDestroy {
  readonly media = inject(MediaPlayerService);

  openQueue = output<void>();
  queueDragProgress = output<number>();
  queueDragEnd = output<void>();

  // Visualization data
  visualizerBars = signal<number[]>(Array(28).fill(0));
  private animationFrame: number | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;

  // Equalizer Web Audio API nodes
  private eqFilters: BiquadFilterNode[] = [];
  private preampGain: GainNode | null = null;
  private audioSourceConnected = false;

  // EQ State
  eqEnabled = signal(true);
  eqAuto = signal(false);
  eqPreamp = signal(50); // 0-100, 50 = unity gain
  eqBands = signal<number[]>([50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);
  eqPresets = Object.keys(EQ_PRESETS);
  eqFrequencyLabels = EQ_FREQUENCY_LABELS;
  currentPreset = signal<string | null>(null);

  // Effect for watching when current track changes to connect equalizer
  private audioWatchEffect = effect(() => {
    // React to current track signal to know when audio changes
    const currentTrack = this.media.current();
    const audio = this.media.audio;

    // When a new track starts and we have an audio element, connect the EQ
    if (currentTrack && audio && !this.audioSourceConnected) {
      // Small delay to ensure audio element is fully set up
      setTimeout(() => this.connectAudioSource(this.media.audio!), 100);
    }
  });

  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  progress = computed(() => {
    const dur = this.duration();
    if (!dur) return 0;
    return this.currentTime() / dur;
  });

  // Scrolling title
  scrollingTitle = signal('');
  private scrollPosition = 0;
  private scrollInterval: number | null = null;

  // Lyrics view toggle
  showLyrics = signal(false);
  canShowLyrics = computed(() => {
    const current = this.media.current();
    // Show lyrics button for Music type (can search API) or if lyrics exist
    return current?.type === 'Music' || !!current?.lyrics;
  });

  toggleLyrics(): void {
    this.showLyrics.update(v => !v);
  }

  ngOnInit(): void {
    this.startTitleScroll();
    this.initVisualizer();
    this.initEqualizer();
    this.loadEqSettings();
  }

  ngOnDestroy(): void {
    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.saveEqSettings();
    // Don't close audioContext as it would break audio playback
  }

  private initVisualizer(): void {
    // Simple fake visualizer animation
    // Real implementation would use Web Audio API with the actual audio element
    const animate = () => {
      if (!this.media.paused) {
        const bars = Array(28).fill(0).map(() =>
          Math.random() * 0.8 + (Math.random() > 0.7 ? 0.2 : 0)
        );
        this.visualizerBars.set(bars);
      } else {
        // When paused, slowly decay
        this.visualizerBars.update(bars =>
          bars.map(b => Math.max(0, b - 0.05))
        );
      }
      this.animationFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  private startTitleScroll(): void {
    this.scrollInterval = window.setInterval(() => {
      const title = this.media.current()?.title || 'No track playing';
      const artist = this.media.current()?.artist || '';
      const fullText = artist ? `*** ${title} - ${artist} ***   ` : `*** ${title} ***   `;

      this.scrollPosition = (this.scrollPosition + 1) % fullText.length;
      const scrolled = fullText.substring(this.scrollPosition) + fullText.substring(0, this.scrollPosition);
      this.scrollingTitle.set(scrolled.substring(0, 30));
    }, 150);
  }

  formatTime(value: number): string {
    if (!value || isNaN(value)) return '0:00';
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  formatTimeDisplay(value: number): string {
    if (!value || isNaN(value)) return '00:00';
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  onTimeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (this.media.audio && Math.abs(this.media.audio.currentTime - value) > 0.5) {
      this.media.audio.currentTime = value;
    }
  }

  onVolumeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (this.media.audio) {
      this.media.audio.volume = value / 100;
    }
  }

  get volume(): number {
    return this.media.audio ? Math.round(this.media.audio.volume * 100) : 100;
  }

  onSwipe(event: SwipeEvent): void {
    // Disable gestures when lyrics are showing to prevent interference while scrolling
    if (this.showLyrics()) return;

    switch (event.direction) {
      case 'left':
        if (this.media.canNext()) this.media.next();
        break;
      case 'right':
        if (this.media.canPrevious()) this.media.previous();
        break;
      case 'down':
        this.openQueue.emit();
        break;
    }
  }

  onSwipeProgress(event: SwipeProgressEvent): void {
    // Disable gestures when lyrics are showing
    if (this.showLyrics()) return;

    if (event.direction === 'vertical' && event.deltaY > 0) {
      this.queueDragProgress.emit(event.deltaY);
    }
  }

  onSwipeEnd(): void {
    this.queueDragEnd.emit();
  }

  // Initialize Web Audio API equalizer
  private initEqualizer(): void {
    // Equalizer will be initialized when audio element is available
    // We need to wait for the audio element to exist
  }

  private setupEqChain(): void {
    if (!this.audioContext) return;

    try {
      // Create preamp gain node
      this.preampGain = this.audioContext.createGain();
      this.preampGain.gain.value = this.preampToGain(this.eqPreamp());

      // Create biquad filters for each frequency band
      this.eqFilters = EQ_FREQUENCIES.map((freq, index) => {
        const filter = this.audioContext!.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.4; // Standard Q value for 10-band EQ
        filter.gain.value = this.sliderToDb(this.eqBands()[index]);
        return filter;
      });

      // Chain the filters: preamp -> filter1 -> filter2 -> ... -> destination
      let previousNode: AudioNode = this.preampGain;
      for (const filter of this.eqFilters) {
        previousNode.connect(filter);
        previousNode = filter;
      }
      previousNode.connect(this.audioContext.destination);

      console.log('EQ chain created with', this.eqFilters.length, 'bands');
    } catch (err) {
      console.error('Failed to create EQ chain:', err);
    }
  }

  private connectAudioSource(audio: HTMLAudioElement): void {
    if (this.audioSourceConnected) return;

    try {
      // Create audio context on first connection (must be after user interaction)
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
        this.setupEqChain();
      }

      if (!this.preampGain) {
        console.warn('EQ chain not ready');
        return;
      }

      // Resume audio context if suspended (browsers require user gesture)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Create media element source - this routes audio through Web Audio API
      // IMPORTANT: Once created, audio ONLY plays through the Web Audio graph
      // Note: crossOrigin must be set on audio element BEFORE src is set (done in MediaPlayerService)
      if (!this.source) {
        this.source = this.audioContext.createMediaElementSource(audio);
        // Connect source to preamp (start of EQ chain)
        this.source.connect(this.preampGain);
        this.audioSourceConnected = true;
        console.log('Equalizer connected to audio source');
      }
    } catch (err) {
      console.warn('Could not connect equalizer to audio:', err);
      // If we can't connect (e.g., CORS issue), audio will still play normally
    }
  }

  // Convert slider value (0-100) to dB gain (-12 to +12)
  private sliderToDb(value: number): number {
    // 0 = -12dB, 50 = 0dB, 100 = +12dB
    return ((value - 50) / 50) * 12;
  }

  // Convert preamp slider (0-100) to gain multiplier
  private preampToGain(value: number): number {
    // 0 = -12dB, 50 = 0dB, 100 = +12dB
    const db = ((value - 50) / 50) * 12;
    return Math.pow(10, db / 20);
  }

  // Toggle EQ on/off
  toggleEq(): void {
    this.eqEnabled.update(v => !v);
    this.applyEqState();
  }

  // Toggle Auto mode (future: could analyze audio and adjust EQ)
  toggleEqAuto(): void {
    this.eqAuto.update(v => !v);
  }

  // Apply EQ enabled/disabled state
  private applyEqState(): void {
    if (!this.eqFilters.length) return;

    const enabled = this.eqEnabled();
    const bands = this.eqBands();

    for (let i = 0; i < this.eqFilters.length; i++) {
      this.eqFilters[i].gain.value = enabled ? this.sliderToDb(bands[i]) : 0;
    }

    if (this.preampGain) {
      this.preampGain.gain.value = enabled ? this.preampToGain(this.eqPreamp()) : 1;
    }
  }

  // Update preamp
  updatePreamp(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    this.eqPreamp.set(value);
    this.currentPreset.set(null);

    if (this.preampGain && this.eqEnabled()) {
      this.preampGain.gain.value = this.preampToGain(value);
    }
  }

  // Update individual EQ band
  updateEqBand(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    this.eqBands.update(bands => {
      const newBands = [...bands];
      newBands[index] = value;
      return newBands;
    });
    this.currentPreset.set(null);

    if (this.eqFilters[index] && this.eqEnabled()) {
      this.eqFilters[index].gain.value = this.sliderToDb(value);
    }
  }

  // Apply a preset
  applyPreset(presetName: string): void {
    const preset = EQ_PRESETS[presetName];
    if (!preset) return;

    this.eqPreamp.set(preset.preamp);
    this.eqBands.set([...preset.bands]);
    this.currentPreset.set(presetName);

    // Apply to audio nodes
    if (this.preampGain && this.eqEnabled()) {
      this.preampGain.gain.value = this.preampToGain(preset.preamp);
    }

    if (this.eqEnabled()) {
      for (let i = 0; i < this.eqFilters.length; i++) {
        this.eqFilters[i].gain.value = this.sliderToDb(preset.bands[i]);
      }
    }
  }

  // Save EQ settings to localStorage
  private saveEqSettings(): void {
    const settings = {
      enabled: this.eqEnabled(),
      preamp: this.eqPreamp(),
      bands: this.eqBands(),
      preset: this.currentPreset(),
    };
    localStorage.setItem('nostria-winamp-eq', JSON.stringify(settings));
  }

  // Load EQ settings from localStorage
  private loadEqSettings(): void {
    try {
      const saved = localStorage.getItem('nostria-winamp-eq');
      if (saved) {
        const settings = JSON.parse(saved);
        if (typeof settings.enabled === 'boolean') this.eqEnabled.set(settings.enabled);
        if (typeof settings.preamp === 'number') this.eqPreamp.set(settings.preamp);
        if (Array.isArray(settings.bands) && settings.bands.length === 10) {
          this.eqBands.set(settings.bands);
        }
        if (settings.preset) this.currentPreset.set(settings.preset);

        // Apply loaded settings to audio nodes
        this.applyEqState();
      }
    } catch (err) {
      console.warn('Failed to load EQ settings:', err);
    }
  }

  getRepeatTooltip(): string {
    switch (this.media.repeat()) {
      case 'off': return 'Repeat: Off';
      case 'all': return 'Repeat: All';
      case 'one': return 'Repeat: One';
    }
  }
}
