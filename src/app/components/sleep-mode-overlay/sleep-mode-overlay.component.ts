import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { SleepModeService } from '../../services/sleep-mode.service';

@Component({
  selector: 'app-sleep-mode-overlay',
  template: `
    <div class="sleep-mode-overlay" [class.active]="sleepModeService.showWakeupOverlay()">
      <div
        class="overlay-backdrop"
        tabindex="0"
        (click)="onBackdropClick()"
        (keydown)="onBackdropKeydown($event)"
      ></div>
      <div class="overlay-content">
        <mat-card class="wakeup-card">
          <mat-card-header>
            <mat-icon mat-card-avatar class="sleep-icon">bedtime</mat-icon>
            <mat-card-title>App was sleeping</mat-card-title>
            <mat-card-subtitle>
              Connection paused for
              {{ sleepModeService.formattedDuration() }} to save resources
            </mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            <p>
              The app automatically disconnected from relay servers after being hidden for more than
              2 minutes. This helps preserve your device's battery and network resources.
            </p>
          </mat-card-content>

          <mat-card-actions align="end">
            <button mat-button (click)="onDismiss()">
              <mat-icon>close</mat-icon>
              Later
            </button>
            <button mat-flat-button (click)="onContinue()">
              <mat-icon>refresh</mat-icon>
              Continue
            </button>
          </mat-card-actions>
        </mat-card>
      </div>
    </div>
  `,
  styles: [
    `
      .sleep-mode-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease-in-out;
      }

      .sleep-mode-overlay.active {
        opacity: 1;
        visibility: visible;
      }

      .overlay-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
      }

      .overlay-content {
        position: relative;
        z-index: 1;
        max-width: 420px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
      }

      .wakeup-card {
        box-shadow: var(--mat-sys-level5);
        border-radius: 16px;
      }

      .sleep-icon {
        background-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        font-size: 24px;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      mat-card-content p {
        margin: 0;
        line-height: 1.5;
        color: var(--mat-sys-on-surface-variant);
      }

      mat-card-actions {
        padding: 16px 24px 24px;
        gap: 8px;
      }

      mat-card-actions button {
        min-width: 100px;
      }

      .dark .overlay-backdrop {
        background-color: rgba(0, 0, 0, 0.8);
      }

      .dark .wakeup-card {
        background-color: var(--mat-sys-surface-container-high);
      }
    `,
  ],
  imports: [MatButtonModule, MatCardModule, MatIconModule],
})
export class SleepModeOverlayComponent {
  sleepModeService = inject(SleepModeService);

  onContinue(): void {
    this.sleepModeService.wakeUp();
  }

  onDismiss(): void {
    this.sleepModeService.hideWakeupOverlay();
  }

  onBackdropClick(): void {
    // Allow clicking backdrop to dismiss
    this.onDismiss();
  }

  onBackdropKeydown(event: KeyboardEvent): void {
    // Allow Escape key to dismiss
    if (event.key === 'Escape') {
      this.onDismiss();
    }
  }
}
