import {
  Component,
  inject,
  computed,
  signal,
  ChangeDetectionStrategy,
  output,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { formatDuration } from '../../../../utils/format-duration';
import { MediaPlayerService } from '../../../../services/media-player.service';
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

  // Web Audio API state for real EQ processing
  private audioContext: AudioContext | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private preampGain: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private audioSourceConnected = false;

  // Whether the EQ is actively processing audio via Web Audio API.
  // Once connected, audio only flows through the Web Audio graph.
  // On leaving winamp view, the audio element is recreated to restore normal playback.
  eqConnected = signal(false);

  // EQ State
  eqEnabled = signal(true);
  eqAuto = signal(false);
  eqPreamp = signal(50); // 0-100, 50 = unity gain
  eqBands = signal<number[]>([50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);
  eqPresets = Object.keys(EQ_PRESETS);
  eqFrequencyLabels = EQ_FREQUENCY_LABELS;
  currentPreset = signal<string | null>(null);

  // 2x scale mode
  doubleSize = signal(false);

  toggleDoubleSize(): void {
    this.doubleSize.update(v => !v);
  }

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

  // Swipe gesture state for fullscreen winamp mode
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeTracking = false;
  private swipeLockedDirection: 'horizontal' | 'vertical' | null = null;
  private readonly swipeThreshold = 60;

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
    this.disconnectEq();
  }

  /**
   * User-initiated: connect the Web Audio API equalizer to the audio element.
   * This enables real audio processing but locks audio to flow through the
   * Web Audio graph. When leaving winamp view, the audio element is recreated.
   */
  async enableEq(): Promise<void> {
    const audio = this.media.audio;
    if (!audio || this.audioSourceConnected) return;

    try {
      // Ensure crossOrigin is set for Web Audio API access
      // This must be done before the source is loaded
      if (audio.crossOrigin !== 'anonymous') {
        audio.crossOrigin = 'anonymous';
        // Need to reload with the new CORS setting
        const currentSrc = audio.src;
        const currentTime = audio.currentTime;
        const wasPlaying = !this.media.paused;

        audio.src = '';
        audio.src = currentSrc;
        audio.load();

        await new Promise<void>((resolve) => {
          const onCanPlay = () => {
            audio.removeEventListener('canplay', onCanPlay);
            resolve();
          };
          audio.addEventListener('canplay', onCanPlay);
          setTimeout(() => {
            audio.removeEventListener('canplay', onCanPlay);
            resolve();
          }, 3000);
        });

        if (currentTime > 0 && audio.duration && currentTime < audio.duration) {
          audio.currentTime = currentTime;
        }

        if (wasPlaying) {
          await audio.play();
        }
      }

      // Create audio context and EQ chain
      this.audioContext = new AudioContext();
      this.setupEqChain();

      if (!this.preampGain) {
        console.warn('EQ chain not ready');
        this.audioContext.close();
        this.audioContext = null;
        return;
      }

      // Resume audio context if suspended (browsers require user gesture)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Route audio through the Web Audio API graph
      this.source = this.audioContext.createMediaElementSource(audio);
      this.source.connect(this.preampGain);
      this.audioSourceConnected = true;
      this.eqConnected.set(true);

      // Apply current EQ state to the audio nodes
      this.applyEqState();

      console.log('Equalizer connected to audio source');
    } catch (err) {
      console.warn('Could not connect equalizer to audio:', err);
      // Clean up partial state
      if (this.audioContext) {
        try { this.audioContext.close(); } catch { /* ignore */ }
        this.audioContext = null;
      }
      this.eqFilters = [];
      this.preampGain = null;
      this.source = null;
      this.audioSourceConnected = false;
      this.eqConnected.set(false);
    }
  }

  /**
   * Disconnect the EQ by closing the AudioContext and recreating
   * the audio element so playback works normally outside winamp view.
   */
  private disconnectEq(): void {
    if (!this.audioSourceConnected) return;

    // Close the audio context — this disconnects all nodes
    if (this.audioContext) {
      try { this.audioContext.close(); } catch { /* ignore */ }
      this.audioContext = null;
    }

    this.eqFilters = [];
    this.preampGain = null;
    this.source = null;
    this.audioSourceConnected = false;
    this.eqConnected.set(false);

    // Recreate the audio element so it's no longer tied to the Web Audio graph
    this.media.recreateAudioElement();
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
    } catch (err) {
      console.error('Failed to create EQ chain:', err);
    }
  }

  // Convert slider value (0-100) to dB gain (-12 to +12)
  private sliderToDb(value: number): number {
    return ((value - 50) / 50) * 12;
  }

  // Convert preamp slider (0-100) to gain multiplier
  private preampToGain(value: number): number {
    const db = ((value - 50) / 50) * 12;
    return Math.pow(10, db / 20);
  }

  private initVisualizer(): void {
    // Simple fake visualizer animation
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

  formatTime = formatDuration;

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

  onSwipeEnd(): void {
    this.queueDragEnd.emit();
  }

  onTouchStart(event: TouchEvent): void {
    if (this.showLyrics()) return;
    if (event.touches.length !== 1) return;
    if (this.isInteractiveElement(event.target as HTMLElement)) return;

    const touch = event.touches[0];
    this.swipeStartX = touch.clientX;
    this.swipeStartY = touch.clientY;
    this.swipeTracking = true;
    this.swipeLockedDirection = null;
  }

  onTouchMove(event: TouchEvent): void {
    if (!this.swipeTracking || this.showLyrics()) return;
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - this.swipeStartX;
    const deltaY = touch.clientY - this.swipeStartY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    if (!this.swipeLockedDirection && (absDeltaX > 10 || absDeltaY > 10)) {
      this.swipeLockedDirection = absDeltaX > absDeltaY ? 'horizontal' : 'vertical';
    }

    if (this.swipeLockedDirection === 'vertical' && deltaY > 0) {
      this.queueDragProgress.emit(deltaY);
      event.preventDefault();
    }
  }

  onTouchEnd(event: TouchEvent): void {
    if (!this.swipeTracking) return;
    this.swipeTracking = false;

    if (this.showLyrics()) {
      this.swipeLockedDirection = null;
      this.onSwipeEnd();
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      this.swipeLockedDirection = null;
      this.onSwipeEnd();
      return;
    }

    const deltaX = touch.clientX - this.swipeStartX;
    const deltaY = touch.clientY - this.swipeStartY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    if (absDeltaX >= this.swipeThreshold && absDeltaX > absDeltaY) {
      if (deltaX < 0 && this.media.canNext()) {
        this.media.next();
      } else if (deltaX > 0 && this.media.canPrevious()) {
        this.media.previous();
      }
    } else if (absDeltaY >= this.swipeThreshold && absDeltaY > absDeltaX && deltaY > 0) {
      this.openQueue.emit();
    }

    this.swipeLockedDirection = null;
    this.onSwipeEnd();
  }

  private isInteractiveElement(element: HTMLElement | null): boolean {
    while (element) {
      const tagName = element.tagName.toLowerCase();
      if (
        tagName === 'button' ||
        tagName === 'a' ||
        tagName === 'input' ||
        tagName === 'select' ||
        tagName === 'textarea' ||
        element.getAttribute('role') === 'button' ||
        element.hasAttribute('mat-button') ||
        element.hasAttribute('mat-icon-button') ||
        element.hasAttribute('mat-fab')
      ) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }

  // Toggle EQ on/off
  toggleEq(): void {
    this.eqEnabled.update(v => !v);
    if (this.eqConnected()) {
      this.applyEqState();
    }
  }

  // Toggle Auto mode
  toggleEqAuto(): void {
    this.eqAuto.update(v => !v);
  }

  // Apply EQ enabled/disabled state to audio nodes
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

    if (this.preampGain && this.eqEnabled() && this.eqConnected()) {
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

    if (this.eqFilters[index] && this.eqEnabled() && this.eqConnected()) {
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

    if (this.eqConnected() && this.eqEnabled()) {
      if (this.preampGain) {
        this.preampGain.gain.value = this.preampToGain(preset.preamp);
      }
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
