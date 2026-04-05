import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-android-wipe-restart-dialog',
  imports: [MatIconModule],
  template: `
    <div dialog-content class="restart-required-screen">
      <div class="restart-card">
        <div class="restart-hero" aria-hidden="true">
          <mat-icon>restart_alt</mat-icon>
        </div>

        <p class="eyebrow">Data Wiped</p>
        <h1>Restart Nostria</h1>
        <p class="summary">
          Nostria cleared all local app data successfully, but the Android app cannot reload itself cleanly after this reset.
        </p>

        <div class="instruction-block">
          <h2>What to do now</h2>
          <ol>
            <li>Close Nostria completely.</li>
            <li>Open Nostria again from your launcher.</li>
          </ol>
        </div>

        <p class="hint">
          If Nostria stays visible in the recent apps screen, swipe it away first before opening it again.
        </p>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }

    .restart-required-screen {
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
      background:
        radial-gradient(circle at top, var(--mat-sys-surface-container-high) 0%, transparent 48%),
        linear-gradient(180deg, var(--mat-sys-surface-container-lowest) 0%, var(--mat-sys-surface) 100%);
      box-sizing: border-box;
    }

    .restart-card {
      width: min(560px, 100%);
      display: flex;
      flex-direction: column;
      gap: 16px;
      align-items: center;
      text-align: center;
      padding: 32px 24px;
      border-radius: 24px;
      background: color-mix(in srgb, var(--mat-sys-surface-container) 92%, transparent);
      border: 1px solid var(--mat-sys-outline-variant);
      box-shadow: var(--mat-sys-level2);
      box-sizing: border-box;
    }

    .restart-hero {
      width: 88px;
      height: 88px;
      border-radius: var(--mat-sys-corner-full);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    .restart-hero mat-icon {
      width: 44px;
      height: 44px;
      font-size: 44px;
    }

    .eyebrow {
      margin: 0;
      color: var(--mat-sys-primary);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 0.8rem;
    }

    h1,
    h2,
    p,
    ol {
      margin: 0;
    }

    h1 {
      color: var(--mat-sys-on-surface);
      font-size: clamp(1.8rem, 4vw, 2.4rem);
      line-height: 1.1;
    }

    .summary,
    .hint,
    .instruction-block li {
      color: var(--mat-sys-on-surface-variant);
      font-size: 1rem;
      line-height: 1.5;
    }

    .instruction-block {
      width: 100%;
      padding: 20px;
      border-radius: 18px;
      background: var(--mat-sys-surface-container-high);
      box-sizing: border-box;
      text-align: left;
    }

    .instruction-block h2 {
      color: var(--mat-sys-on-surface);
      font-size: 1.05rem;
      margin-bottom: 12px;
    }

    .instruction-block ol {
      padding-left: 20px;
      display: grid;
      gap: 8px;
    }

    .hint {
      max-width: 36ch;
    }

    @media (max-width: 700px), (max-height: 700px) {
      .restart-required-screen {
        align-items: stretch;
        padding: 0;
      }

      .restart-card {
        width: 100%;
        min-height: 100%;
        border-radius: 0;
        border: none;
        box-shadow: none;
        justify-content: center;
        padding: 28px 20px calc(28px + env(safe-area-inset-bottom));
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AndroidWipeRestartDialogComponent {}