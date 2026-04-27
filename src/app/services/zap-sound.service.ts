import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SettingsService } from './settings.service';
import { MediaPlayerService } from './media-player.service';

/**
 * Zap intensity tiers based on sat amount:
 *   1 = Tiny    (1-100 sats)     - subtle click + soft chime
 *   2 = Medium  (101-400 sats)   - electric crackle + chime
 *   3 = Large   (401-1000 sats)  - beefy zap + rising chime + rumble
 *   4 = Huge    (1001-9999 sats) - thunder crack + fanfare + deep boom
 *   5 = Mega    (10000+ sats)    - full lightning storm + triumphant fanfare + earthquake
 */
export type ZapTier = 1 | 2 | 3 | 4 | 5;

export function getZapTier(amount: number): ZapTier {
  if (amount <= 100) return 1;
  if (amount <= 400) return 2;
  if (amount <= 1000) return 3;
  if (amount <= 9999) return 4;
  return 5;
}

@Injectable({ providedIn: 'root' })
export class ZapSoundService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly settingsService = inject(SettingsService);
  private readonly mediaPlayer = inject(MediaPlayerService);
  private audioContext: AudioContext | null = null;
  private likeAudio: HTMLAudioElement | null = null;

  private shouldMuteInteractionSounds(): boolean {
    return this.mediaPlayer.isMusicPlaying();
  }

  private getAudioContext(): AudioContext | null {
    if (!this.isBrowser) {
      return null;
    }

    if (!this.audioContext) {
      try {
        this.audioContext = new AudioContext();
      } catch {
        return null;
      }
    }

    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }

    return this.audioContext;
  }

  /** Play a zap sound scaled to the sat amount. */
  playZapSound(amount: number): void {
    if (this.settingsService.settings().zapSoundsEnabled === false || this.shouldMuteInteractionSounds()) {
      return;
    }

    const ctx = this.getAudioContext();
    if (!ctx) {
      return;
    }

    try {
      const tier = getZapTier(amount);
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);

      switch (tier) {
        case 1:
          this.playTier1(ctx, now, masterGain);
          break;
        case 2:
          this.playTier2(ctx, now, masterGain);
          break;
        case 3:
          this.playTier3(ctx, now, masterGain);
          break;
        case 4:
          this.playTier4(ctx, now, masterGain);
          break;
        case 5:
          this.playTier5(ctx, now, masterGain);
          break;
      }
    } catch {
      // Silently ignore audio errors
    }
  }

  /** Play a light confirmation sound for likes. */
  playLikeSound(): void {
    if (
      !this.isBrowser
      || this.settingsService.settings().zapSoundsEnabled === false
      || this.shouldMuteInteractionSounds()
    ) {
      return;
    }

    if (!this.likeAudio) {
      try {
        this.likeAudio = new Audio('/sounds/like.wav');
        this.likeAudio.preload = 'auto';
      } catch {
        this.likeAudio = null;
      }
    }

    if (!this.likeAudio) {
      return;
    }

    try {
      this.likeAudio.currentTime = 0;
      this.likeAudio.volume = 0.45;
      void this.likeAudio.play();
    } catch {
      // Silently ignore audio errors
    }
  }

  // ── Tier 1 (1-100 sats): Subtle click + soft single chime ─────────────
  private playTier1(ctx: AudioContext, now: number, dest: AudioNode): void {
    dest.context.createGain(); // type anchor
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.25, now);
    master.connect(dest);

    // Soft click
    this.oscNote(ctx, now, master, {
      type: 'square',
      freq: 1800, freqEnd: 400, freqDur: 0.04,
      gain: 0.3, dur: 0.04,
    });

    // Single gentle chime
    this.oscNote(ctx, now + 0.03, master, {
      type: 'sine',
      freq: 880, gain: 0.25, dur: 0.18,
    });
  }

  // ── Tier 2 (101-400 sats): Electric crackle + two-note chime ──────────
  private playTier2(ctx: AudioContext, now: number, dest: AudioNode): void {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.3, now);
    master.connect(dest);

    // Electric crackle
    this.createCrackle(ctx, now, master, 0.15, 2400, 0.35);

    // Two-note ascending chime
    this.oscNote(ctx, now + 0.05, master, { type: 'sine', freq: 880, gain: 0.3, dur: 0.15 });
    this.oscNote(ctx, now + 0.13, master, { type: 'sine', freq: 1320, gain: 0.3, dur: 0.22 });

    // Light thump
    this.oscNote(ctx, now, master, {
      type: 'sine', freq: 150, freqEnd: 40, freqDur: 0.1, gain: 0.4, dur: 0.1,
    });
  }

  // ── Tier 3 (401-1000 sats): Beefy zap + rising three-note chime + rumble
  private playTier3(ctx: AudioContext, now: number, dest: AudioNode): void {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.35, now);
    master.connect(dest);

    // Longer, beefier crackle
    this.createCrackle(ctx, now, master, 0.2, 3200, 0.45);

    // Three-note ascending chime (C6, E6, G6 - major triad)
    this.oscNote(ctx, now + 0.06, master, { type: 'sine', freq: 1047, gain: 0.3, dur: 0.15 });
    this.oscNote(ctx, now + 0.14, master, { type: 'sine', freq: 1319, gain: 0.3, dur: 0.18 });
    this.oscNote(ctx, now + 0.24, master, { type: 'sine', freq: 1568, gain: 0.35, dur: 0.3 });

    // Shimmer overtone
    this.oscNote(ctx, now + 0.24, master, { type: 'sine', freq: 3136, gain: 0.1, dur: 0.3 });

    // Medium thump + rumble
    this.oscNote(ctx, now, master, {
      type: 'sine', freq: 180, freqEnd: 35, freqDur: 0.15, gain: 0.5, dur: 0.15,
    });
    // Sub-rumble tail
    this.oscNote(ctx, now + 0.08, master, {
      type: 'sine', freq: 60, freqEnd: 30, freqDur: 0.2, gain: 0.3, dur: 0.25,
    });
  }

  // ── Tier 4 (1001-9999 sats): Thunder crack + triumphant fanfare + deep boom
  private playTier4(ctx: AudioContext, now: number, dest: AudioNode): void {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.38, now);
    master.connect(dest);

    // Initial thunder crack - two overlapping crackles
    this.createCrackle(ctx, now, master, 0.25, 4000, 0.5);
    this.createCrackle(ctx, now + 0.03, master, 0.2, 2800, 0.3);

    // Filtered noise burst for texture
    this.createNoiseBurst(ctx, now, master, 0.12, 3000, 0.15);

    // Four-note triumphant fanfare (C5, E5, G5, C6)
    this.oscNote(ctx, now + 0.08, master, { type: 'sine', freq: 523, gain: 0.25, dur: 0.12 });
    this.oscNote(ctx, now + 0.16, master, { type: 'sine', freq: 659, gain: 0.28, dur: 0.12 });
    this.oscNote(ctx, now + 0.24, master, { type: 'sine', freq: 784, gain: 0.3, dur: 0.15 });
    this.oscNote(ctx, now + 0.35, master, { type: 'sine', freq: 1047, gain: 0.35, dur: 0.4 });

    // Harmonic shimmer on the final note
    this.oscNote(ctx, now + 0.35, master, { type: 'sine', freq: 2094, gain: 0.12, dur: 0.4 });
    this.oscNote(ctx, now + 0.35, master, { type: 'sine', freq: 3141, gain: 0.06, dur: 0.35 });

    // Deep boom
    this.oscNote(ctx, now, master, {
      type: 'sine', freq: 200, freqEnd: 25, freqDur: 0.25, gain: 0.6, dur: 0.25,
    });
    // Sub-bass sustain
    this.oscNote(ctx, now + 0.1, master, {
      type: 'sine', freq: 50, freqEnd: 20, freqDur: 0.4, gain: 0.35, dur: 0.45,
    });
  }

  // ── Tier 5 (10000+ sats): Full lightning storm + epic fanfare + earthquake ─
  private playTier5(ctx: AudioContext, now: number, dest: AudioNode): void {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.4, now);
    master.connect(dest);

    // Multiple staggered lightning crackles (storm effect)
    this.createCrackle(ctx, now, master, 0.3, 5000, 0.5);
    this.createCrackle(ctx, now + 0.04, master, 0.25, 3500, 0.4);
    this.createCrackle(ctx, now + 0.1, master, 0.2, 4200, 0.3);
    this.createCrackle(ctx, now + 0.5, master, 0.15, 3000, 0.2);

    // Multiple noise bursts for chaotic storm texture
    this.createNoiseBurst(ctx, now, master, 0.15, 4000, 0.2);
    this.createNoiseBurst(ctx, now + 0.08, master, 0.1, 2500, 0.12);
    this.createNoiseBurst(ctx, now + 0.4, master, 0.1, 3500, 0.1);

    // Epic ascending fanfare: C5 -> E5 -> G5 -> C6 -> E6 -> G6 -> C7
    const fanfare = [
      { t: 0.1,  freq: 523,  gain: 0.2,  dur: 0.1 },
      { t: 0.17, freq: 659,  gain: 0.22, dur: 0.1 },
      { t: 0.24, freq: 784,  gain: 0.25, dur: 0.1 },
      { t: 0.32, freq: 1047, gain: 0.28, dur: 0.12 },
      { t: 0.42, freq: 1319, gain: 0.3,  dur: 0.12 },
      { t: 0.52, freq: 1568, gain: 0.32, dur: 0.15 },
      { t: 0.65, freq: 2093, gain: 0.35, dur: 0.6 },
    ];
    for (const note of fanfare) {
      this.oscNote(ctx, now + note.t, master, {
        type: 'sine', freq: note.freq, gain: note.gain, dur: note.dur,
      });
    }

    // Rich harmonic shimmer on the final sustained note
    this.oscNote(ctx, now + 0.65, master, { type: 'sine', freq: 4186, gain: 0.1, dur: 0.5 });
    this.oscNote(ctx, now + 0.65, master, { type: 'sine', freq: 6279, gain: 0.05, dur: 0.4 });
    // Triangle wave warmth under the fanfare
    this.oscNote(ctx, now + 0.65, master, { type: 'triangle', freq: 1047, gain: 0.15, dur: 0.6 });

    // Earthquake bass: initial slam + long rolling rumble
    this.oscNote(ctx, now, master, {
      type: 'sine', freq: 250, freqEnd: 20, freqDur: 0.35, gain: 0.7, dur: 0.35,
    });
    // Rolling rumble
    this.oscNote(ctx, now + 0.15, master, {
      type: 'sine', freq: 45, freqEnd: 18, freqDur: 0.7, gain: 0.4, dur: 0.8,
    });
    // Second rumble wave
    this.oscNote(ctx, now + 0.4, master, {
      type: 'sine', freq: 55, freqEnd: 22, freqDur: 0.5, gain: 0.3, dur: 0.6,
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /** Create a single oscillator note with optional frequency sweep. */
  private oscNote(
    ctx: AudioContext,
    startTime: number,
    destination: AudioNode,
    opts: {
      type: OscillatorType;
      freq: number;
      freqEnd?: number;
      freqDur?: number;
      gain: number;
      dur: number;
    }
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, startTime);
    if (opts.freqEnd && opts.freqDur) {
      osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, startTime + opts.freqDur);
    }

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(opts.gain, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + opts.dur);

    osc.connect(gain);
    gain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + opts.dur + 0.01);
  }

  /** Sawtooth frequency sweep through a bandpass filter (electric crackle). */
  private createCrackle(
    ctx: AudioContext,
    startTime: number,
    destination: AudioNode,
    duration: number,
    startFreq: number,
    volume: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.08, startTime + duration * 0.55);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.03, startTime + duration);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(startFreq * 0.5, startTime);
    filter.Q.setValueAtTime(2, startTime);

    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  /** Filtered white noise burst for texture / impact. */
  private createNoiseBurst(
    ctx: AudioContext,
    startTime: number,
    destination: AudioNode,
    duration: number,
    filterFreq: number,
    volume: number
  ): void {
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    filter.Q.setValueAtTime(1.5, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    source.start(startTime);
    source.stop(startTime + duration + 0.01);
  }
}
