import { Component, input, output, signal, effect, computed, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Memo } from '../../../models/memo.model';
import { MemoDeleteDialogComponent } from '../memos-delete-dialog/memo-delete-dialog.component';

@Component({
  selector: 'app-memo-card',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule
],
  template: `
    <div class="note-card" [class.no-color]="currentColor() === 'default'" [class.has-custom-color]="currentColor() !== 'default'" [style.background-color]="currentColor() !== 'default' ? currentColor() : null">
      <textarea
        class="note-content"
        [(ngModel)]="currentContent"
        (blur)="handleBlur()"
        (focus)="isFocused.set(true)"
        placeholder="Write a memo..."
        rows="6"
      ></textarea>

      <div class="note-footer">
        <span class="note-timestamp">{{ formattedDate() }}</span>
        
        <div class="note-actions">
          <button
            mat-icon-button
            [matMenuTriggerFor]="colorMenu"
            matTooltip="Change color"
            type="button"
          >
            <mat-icon>palette</mat-icon>
          </button>
          
          <mat-menu #colorMenu="matMenu">
            <div class="color-grid">
              @for (color of availableColors; track color.value) {
                <button
                  class="color-button"
                  [class.selected]="currentColor() === color.value"
                  [class.no-bg]="color.value === 'default'"
                  [style.background-color]="color.value !== 'default' ? color.value : null"
                  [matTooltip]="color.name"
                  (click)="selectColor(color.value); $event.stopPropagation()"
                  type="button"
                >
                  @if (currentColor() === color.value) {
                    <mat-icon>check</mat-icon>
                  }
                </button>
              }
            </div>
          </mat-menu>

          <button
            mat-icon-button
            matTooltip="Delete memo"
            (click)="deleteMemo()"
            type="button"
          >
            <mat-icon>delete</mat-icon>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .note-card {
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
      transition: all 0.2s ease-in-out;
      min-height: 200px;
      border: none;
    }

    .note-card.no-color {
      background: var(--background-card);
      border: 1px solid;
      border-color: var(--divider);
    }

    /* Force dark text when custom color is applied */
    .note-card.has-custom-color .note-content {
      color: rgba(0, 0, 0, 0.87);
    }

    .note-card.has-custom-color .note-content::placeholder {
      color: rgba(0, 0, 0, 0.6);
    }

    .note-card.has-custom-color .note-timestamp {
      color: rgba(0, 0, 0, 0.6);
    }

    .note-card.has-custom-color mat-icon {
      color: rgba(0, 0, 0, 0.6);
    }

    .note-card:hover {
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.16), 0 3px 6px rgba(0, 0, 0, 0.23);
    }

    .note-content {
      flex: 1;
      border: none;
      background: transparent;
      resize: none;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-primary);
      outline: none;
      padding: 0;
    }

    .note-content::placeholder {
      color: var(--text-secondary);
      opacity: 0.6;
    }

    .note-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      min-height: 32px;
    }

    .note-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
    }

    .note-card:hover .note-actions,
    .note-card:focus-within .note-actions {
      opacity: 1;
    }

    .note-timestamp {
      font-size: 11px;
      color: var(--text-secondary);
      flex-shrink: 0;
    }
    .color-picker {
      display: flex;
      gap: 4px;
    }

    .color-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 8px;
    }

    .color-button {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid rgba(0, 0, 0, 0.1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.1s ease-in-out;
      padding: 0;
    }

    .color-button.no-bg {
      background: var(--background-card);
      border: 2px solid var(--divider);
    }

    .color-button:hover {
      transform: scale(1.1);
    }

    .color-button.selected {
      border-color: rgba(0, 0, 0, 0.5);
      border-width: 3px;
    }

    .color-button mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: rgba(0, 0, 0, 0.6);
    }

    @media (prefers-color-scheme: dark) {
      .color-button {
        border-color: rgba(255, 255, 255, 0.2);
      }

      .color-button.selected {
        border-color: rgba(255, 255, 255, 0.7);
      }

      .color-button mat-icon {
        color: rgba(255, 255, 255, 0.8);
      }
    }
  `],
})
export class MemoCardComponent {
  private readonly dialog = inject(MatDialog);

  readonly memo = input.required<Memo>();
  readonly save = output<Memo>();
  readonly delete = output<string>();

  readonly currentContent = signal('');
  readonly currentColor = signal('default');
  readonly isFocused = signal(false);

  // Computed signal for the formatted date to prevent ExpressionChangedAfterItHasBeenCheckedError
  readonly formattedDate = computed(() => this.formatDate(this.memo().updatedAt));

  readonly availableColors = [
    { value: 'default', name: 'Default' },
    { value: '#fef68a', name: 'Yellow' },
    { value: '#f28b82', name: 'Red' },
    { value: '#fbbc04', name: 'Orange' },
    { value: '#fff475', name: 'Light Yellow' },
    { value: '#ccff90', name: 'Green' },
    { value: '#a7ffeb', name: 'Teal' },
    { value: '#cbf0f8', name: 'Blue' },
    { value: '#aecbfa', name: 'Light Blue' },
    { value: '#d7aefb', name: 'Purple' },
    { value: '#fdcfe8', name: 'Pink' },
    { value: '#e6c9a8', name: 'Brown' },
    { value: '#e8eaed', name: 'Gray' },
  ];

  constructor() {
    // Initialize content and color from input
    effect(() => {
      const memo = this.memo();
      this.currentContent.set(memo.content);
      this.currentColor.set(memo.color || 'default');
    });
  }

  handleBlur() {
    this.isFocused.set(false);
    // Only save if content or color has changed
    const memo = this.memo();
    if (
      this.currentContent() !== memo.content ||
      this.currentColor() !== memo.color
    ) {
      this.save.emit({
        ...memo,
        content: this.currentContent(),
        color: this.currentColor(),
      });
    }
  }

  selectColor(color: string) {
    this.currentColor.set(color);
    this.handleBlur(); // Auto-save when color changes
  }

  async deleteMemo() {
    const dialogRef = this.dialog.open(MemoDeleteDialogComponent, {
      width: '400px',
    });

    const confirmed = await dialogRef.afterClosed().toPromise();

    if (confirmed) {
      this.delete.emit(this.memo().id);
    }
  }

  formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}
