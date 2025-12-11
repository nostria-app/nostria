import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-volume-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="volume-gesture-overlay">
      <div class="volume-gesture-container">
        <div class="volume-gesture-icon">
          <mat-icon>{{ volumeIcon() }}</mat-icon>
        </div>
        <div class="volume-gesture-bar">
          <div class="volume-gesture-fill" [style.width.%]="volume()"></div>
        </div>
        <div class="volume-gesture-value">{{ volume() }}%</div>
      </div>
    </div>
  `,
  styles: `
    .volume-gesture-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }

    .volume-gesture-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 24px 48px;
      background: rgba(30, 30, 30, 0.95);
      border-radius: 16px;
      min-width: 200px;
    }

    .volume-gesture-icon {
      color: white;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
      }
    }

    .volume-gesture-bar {
      width: 150px;
      height: 8px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      overflow: hidden;
    }

    .volume-gesture-fill {
      height: 100%;
      background: var(--mat-sys-primary, #c5c0ff);
      border-radius: 4px;
      transition: width 0.05s ease-out;
    }

    .volume-gesture-value {
      color: white;
      font-size: 24px;
    }
  `,
})
export class VolumeOverlayComponent {
  volume = input<number>(100);

  volumeIcon = computed(() => {
    const vol = this.volume();
    if (vol === 0) return 'volume_off';
    if (vol < 50) return 'volume_down';
    return 'volume_up';
  });
}
