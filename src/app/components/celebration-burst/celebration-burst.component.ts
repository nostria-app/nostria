import { Component, computed, input, ChangeDetectionStrategy } from '@angular/core';

type CelebrationTheme = 'zap' | 'like';
type CelebrationMode = 'button' | 'logo';

interface CelebrationParticle {
  icon: string;
  dx: string;
  dy: string;
  rotate: string;
  delayMs: number;
  scale: number;
}

interface BurstVector {
  x: number;
  y: number;
  distance: number;
  rotate: number;
}

const ZAP_VECTORS: BurstVector[] = [
  { x: -1.1, y: -1.1, distance: 0.95, rotate: -18 },
  { x: 1.15, y: -1.0, distance: 0.92, rotate: 22 },
  { x: -1.0, y: 1.15, distance: 0.88, rotate: -14 },
  { x: 1.05, y: 1.1, distance: 0.9, rotate: 18 },
  { x: -1.25, y: -0.25, distance: 1.0, rotate: -24 },
  { x: 1.28, y: 0.2, distance: 1.02, rotate: 24 },
  { x: -0.2, y: -1.35, distance: 1.08, rotate: -12 },
  { x: 0.25, y: 1.3, distance: 1.05, rotate: 14 },
  { x: -0.72, y: -1.28, distance: 1.04, rotate: -28 },
  { x: 1.28, y: -0.6, distance: 1.1, rotate: 30 },
  { x: 0.72, y: 1.26, distance: 1.04, rotate: 18 },
  { x: -1.3, y: 0.62, distance: 1.08, rotate: -24 },
  { x: -0.02, y: -1.45, distance: 1.16, rotate: -10 },
  { x: 0.02, y: 1.42, distance: 1.14, rotate: 10 },
];

const LIKE_VECTORS: BurstVector[] = [
  { x: -1.0, y: -0.9, distance: 0.82, rotate: -10 },
  { x: 1.0, y: -0.86, distance: 0.8, rotate: 10 },
  { x: -0.92, y: 0.96, distance: 0.72, rotate: -8 },
  { x: 0.94, y: 0.94, distance: 0.72, rotate: 8 },
  { x: -1.18, y: -0.1, distance: 0.92, rotate: -16 },
  { x: 1.18, y: -0.08, distance: 0.92, rotate: 16 },
  { x: -0.1, y: -1.2, distance: 0.96, rotate: -6 },
  { x: 0.1, y: 1.08, distance: 0.78, rotate: 6 },
  { x: -0.56, y: -1.12, distance: 0.9, rotate: -14 },
  { x: 0.58, y: -1.08, distance: 0.9, rotate: 14 },
];

const ZAP_ICONS: Record<number, string[]> = {
  1: ['⚡', '⚡', '✦', '⚡', '✦', '⚡'],
  2: ['⚡', '⚡', '✨', '⚡', '✦', '⚡', '✨', '⚡'],
  3: ['⚡', '✨', '⚡', '✨', '✦', '⚡', '✨', '⚡', '⭐', '⚡'],
  4: ['⚡', '✨', '🪙', '⚡', '🔥', '⚡', '✨', '🪙', '⭐', '⚡', '🔥', '⚡'],
  5: ['⚡', '✨', '🪙', '🔥', '⚡', '✨', '🚀', '💥', '👑', '💎', '⚡', '✨', '🔥', '⚡'],
};

const LIKE_ICONS: Record<number, string[]> = {
  1: ['❤', '❤', '✨', '❤', '✨'],
  2: ['❤', '💖', '✨', '❤', '💫', '❤', '✨'],
  3: ['❤', '💖', '✨', '💫', '❤', '💖', '✨', '❤', '⭐'],
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-celebration-burst',
  template: `
    <div class="celebration-shell"
         [class.is-active]="tier() > 0"
         [class.theme-zap]="theme() === 'zap'"
         [class.theme-like]="theme() === 'like'"
         [class.mode-button]="mode() === 'button'"
         [class.mode-logo]="mode() === 'logo'"
         [class.tier-1]="normalizedTier() === 1"
         [class.tier-2]="normalizedTier() === 2"
         [class.tier-3]="normalizedTier() === 3"
         [class.tier-4]="normalizedTier() === 4"
         [class.tier-5]="normalizedTier() === 5">
      <ng-content />

      @if (tier() > 0) {
        <div class="celebration-overlay" aria-hidden="true">
          <div class="flash-core"></div>

          @for (ring of rings(); track ring) {
            <div class="glow-ring" [style.--ring-delay.ms]="(ring - 1) * 85"></div>
          }

          @for (particle of particles(); track $index) {
            <span class="particle"
                  [style.--dx]="particle.dx"
                  [style.--dy]="particle.dy"
                  [style.--rotate]="particle.rotate"
                  [style.--delay.ms]="particle.delayMs"
                  [style.--particle-scale]="particle.scale">{{ particle.icon }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: inline-flex;
      position: relative;
    }

    .celebration-shell {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      --target-boost: 1.1;
      --target-undershoot: 0.92;
      --target-twist: 4deg;
      --ring-size: 30px;
      --ring-scale: 1.8;
      --ring-duration: 700ms;
      --flash-size: 20px;
      --flash-duration: 540ms;
      --particle-duration: 900ms;
      --accent-1: #ff8a00;
      --accent-2: #ffd54f;
      --accent-3: #fff7d1;
      --glow-shadow: 0 0 18px color-mix(in srgb, var(--accent-1) 60%, transparent);
    }

    .celebration-shell.mode-button {
      --ring-size: 28px;
      --flash-size: 18px;
    }

    .celebration-shell.mode-logo {
      --ring-size: 136px;
      --flash-size: 108px;
      --particle-duration: 1220ms;
    }

    .celebration-shell.theme-zap {
      --accent-1: var(--nostria-bitcoin, #ff8a00);
      --accent-2: #ffd54f;
      --accent-3: #fff2c2;
      --glow-shadow: 0 0 24px color-mix(in srgb, var(--accent-1) 72%, transparent);
    }

    .celebration-shell.theme-like {
      --accent-1: #ff4d8d;
      --accent-2: #ff92b7;
      --accent-3: #ffe0ec;
      --target-boost: 1.12;
      --target-undershoot: 0.95;
      --target-twist: 2.5deg;
      --ring-size: 24px;
      --ring-scale: 1.55;
      --ring-duration: 620ms;
      --flash-size: 16px;
      --flash-duration: 480ms;
      --particle-duration: 760ms;
      --glow-shadow: 0 0 18px color-mix(in srgb, var(--accent-1) 58%, transparent);
    }

    .celebration-shell.mode-logo.theme-like {
      --ring-size: 116px;
      --flash-size: 92px;
      --particle-duration: 980ms;
    }

    .celebration-shell.tier-1 {
      --target-boost: 1.08;
      --target-undershoot: 0.96;
      --target-twist: 3deg;
      --ring-scale: 1.6;
    }

    .celebration-shell.tier-2 {
      --target-boost: 1.15;
      --target-undershoot: 0.92;
      --target-twist: 5deg;
      --ring-scale: 1.85;
    }

    .celebration-shell.tier-3 {
      --target-boost: 1.22;
      --target-undershoot: 0.88;
      --target-twist: 7deg;
      --ring-scale: 2.05;
    }

    .celebration-shell.tier-4 {
      --target-boost: 1.28;
      --target-undershoot: 0.84;
      --target-twist: 9deg;
      --ring-scale: 2.2;
    }

    .celebration-shell.tier-5 {
      --target-boost: 1.34;
      --target-undershoot: 0.8;
      --target-twist: 11deg;
      --ring-scale: 2.4;
      --ring-duration: 920ms;
      --flash-duration: 760ms;
      --particle-duration: 1320ms;
    }

    .celebration-shell.theme-like.tier-2,
    .celebration-shell.theme-like.tier-3,
    .celebration-shell.theme-like.tier-4,
    .celebration-shell.theme-like.tier-5 {
      --target-boost: 1.16;
      --target-undershoot: 0.92;
      --target-twist: 3deg;
      --ring-scale: 1.7;
    }

    .celebration-shell.is-active .celebration-target {
      animation: celebrationTarget var(--particle-duration) cubic-bezier(0.2, 0.9, 0.2, 1);
      filter: drop-shadow(0 0 0 transparent);
    }

    .celebration-shell.theme-zap.is-active .celebration-target {
      filter: drop-shadow(0 0 8px color-mix(in srgb, var(--accent-1) 55%, transparent));
    }

    .celebration-shell.theme-like.is-active .celebration-target {
      filter: drop-shadow(0 0 7px color-mix(in srgb, var(--accent-1) 48%, transparent));
    }

    .celebration-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 2;
      overflow: visible;
    }

    .flash-core,
    .glow-ring,
    .particle {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .flash-core {
      width: var(--flash-size);
      height: var(--flash-size);
      border-radius: 50%;
      background:
        radial-gradient(circle, color-mix(in srgb, var(--accent-3) 88%, white) 0%, color-mix(in srgb, var(--accent-2) 74%, transparent) 42%, transparent 75%);
      box-shadow: var(--glow-shadow);
      opacity: 0;
      animation: celebrationFlash var(--flash-duration) ease-out forwards;
    }

    .glow-ring {
      width: var(--ring-size);
      height: var(--ring-size);
      border-radius: 50%;
      border: 2px solid color-mix(in srgb, var(--accent-2) 70%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-1) 28%, transparent), var(--glow-shadow);
      opacity: 0;
      animation: celebrationRing var(--ring-duration) ease-out var(--ring-delay, 0ms) forwards;
    }

    .particle {
      font-size: 14px;
      line-height: 1;
      opacity: 0;
      filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent-2) 55%, transparent));
      animation: celebrationParticle var(--particle-duration) cubic-bezier(0.18, 0.88, 0.28, 1) var(--delay, 0ms) forwards;
    }

    .mode-logo .particle {
      font-size: 22px;
      filter: drop-shadow(0 0 10px color-mix(in srgb, var(--accent-2) 50%, transparent));
    }

    .theme-like .particle {
      font-size: 13px;
    }

    .mode-logo.theme-like .particle {
      font-size: 20px;
    }

    @keyframes celebrationTarget {
      0% {
        transform: scale(1) rotate(0deg);
      }
      18% {
        transform: scale(var(--target-boost)) rotate(calc(var(--target-twist) * -1));
      }
      36% {
        transform: scale(var(--target-undershoot)) rotate(var(--target-twist));
      }
      58% {
        transform: scale(calc(1 + ((var(--target-boost) - 1) * 0.42))) rotate(calc(var(--target-twist) * -0.45));
      }
      100% {
        transform: scale(1) rotate(0deg);
      }
    }

    @keyframes celebrationFlash {
      0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.2);
      }
      16% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.05);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(1.8);
      }
    }

    @keyframes celebrationRing {
      0% {
        opacity: 0.82;
        transform: translate(-50%, -50%) scale(0.25);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(var(--ring-scale));
      }
    }

    @keyframes celebrationParticle {
      0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.28) rotate(0deg);
      }
      14% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(var(--particle-scale)) rotate(var(--rotate));
      }
    }
  `],
})
export class CelebrationBurstComponent {
  tier = input(0);
  theme = input<CelebrationTheme>('zap');
  mode = input<CelebrationMode>('button');

  protected readonly normalizedTier = computed(() => {
    const maxTier = this.theme() === 'like' ? 3 : 5;
    return Math.max(0, Math.min(this.tier(), maxTier));
  });

  protected readonly rings = computed(() => {
    const tier = this.normalizedTier();
    if (tier <= 0) {
      return [];
    }

    if (tier === 1) {
      return [1];
    }

    if (tier <= 3) {
      return [1, 2];
    }

    if (tier === 4) {
      return [1, 2, 3];
    }

    return [1, 2, 3, 4];
  });

  protected readonly particles = computed<CelebrationParticle[]>(() => {
    const tier = this.normalizedTier();
    if (tier <= 0) {
      return [];
    }

    const theme = this.theme();
    const modeMultiplier = this.mode() === 'logo' ? 2.35 : 1;
    const baseTravel = theme === 'zap'
      ? [0, 26, 34, 42, 50, 58][tier]
      : [0, 20, 24, 28][tier];
    const icons = theme === 'zap' ? ZAP_ICONS[tier] : LIKE_ICONS[tier];
    const vectors = theme === 'zap' ? ZAP_VECTORS : LIKE_VECTORS;

    return icons.map((icon, index) => {
      const vector = vectors[index % vectors.length];
      const distance = baseTravel * modeMultiplier * vector.distance;

      return {
        icon,
        dx: `${Math.round(vector.x * distance)}px`,
        dy: `${Math.round(vector.y * distance)}px`,
        rotate: `${Math.round(vector.rotate + (tier * 2))}deg`,
        delayMs: index * (theme === 'zap' ? 34 : 28),
        scale: Number((0.62 + (vector.distance * 0.22) + (tier * 0.05)).toFixed(2)),
      };
    });
  });
}
