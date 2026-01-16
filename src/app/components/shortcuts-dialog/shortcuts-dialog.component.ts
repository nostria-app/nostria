import { ChangeDetectionStrategy, Component, inject, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { PlatformService } from '../../services/platform.service';

interface ShortcutItem {
  keys: string;
  description: string;
}

@Component({
  selector: 'app-shortcuts-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title i18n="@@shortcuts.title">Keyboard Shortcuts</h2>
    <mat-dialog-content>
      <div class="shortcuts-list">
        @for (shortcut of shortcuts(); track shortcut.keys) {
        <div class="shortcut-item">
          <span class="shortcut-keys">{{ shortcut.keys }}</span>
          <span class="shortcut-description">{{ shortcut.description }}</span>
        </div>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button (click)="close()" i18n="@@shortcuts.close">Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .shortcuts-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 320px;
    }

    .shortcut-item {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .shortcut-keys {
      font-family: monospace;
      background-color: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
      padding: 4px 8px;
      border-radius: 4px;
      min-width: 80px;
      text-align: center;
      font-size: 13px;
    }

    .shortcut-description {
      color: var(--mat-sys-on-surface);
      font-size: 14px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutsDialogComponent {
  private dialogRef = inject(MatDialogRef<ShortcutsDialogComponent>);
  private platformService = inject(PlatformService);

  // Compute shortcuts based on platform
  shortcuts = computed(() => {
    const modifier = this.platformService.getModifierKeyDisplay();
    return [
      { keys: `${modifier}+P`, description: $localize`:@@shortcuts.help:Show keyboard shortcuts` },
      { keys: `${modifier}+S`, description: $localize`:@@shortcuts.search:Toggle search` },
      { keys: `${modifier}+N`, description: $localize`:@@shortcuts.create:Open create options` },
      { keys: `${modifier}+C`, description: $localize`:@@shortcuts.command:Open command palette` },
      { keys: `${modifier}+V`, description: $localize`:@@shortcuts.voice:Open command palette with voice input` },
      { keys: 'Space / K', description: $localize`:@@shortcuts.video.play-pause:Play/pause video (when video player is active)` },
      { keys: 'J / ←', description: $localize`:@@shortcuts.video.rewind:Rewind video 10 seconds (when video player is active)` },
      { keys: 'L / →', description: $localize`:@@shortcuts.video.forward:Fast forward video 10 seconds (when video player is active)` },
    ];
  });

  close(): void {
    this.dialogRef.close();
  }
}
