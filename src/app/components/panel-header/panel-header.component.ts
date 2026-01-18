import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface PanelAction {
  id: string;
  icon: string;
  label: string;
  tooltip?: string;
  disabled?: boolean;
}

@Component({
  selector: 'app-panel-header',
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="panel-header" [class.transparent]="transparent()">
      <!-- Back button -->
      @if (showBack()) {
        <button
          mat-icon-button
          class="back-button"
          (click)="backClick.emit()"
          [matTooltip]="backTooltip()"
        >
          <mat-icon>arrow_back</mat-icon>
        </button>
      }

      <!-- Title -->
      <h2 class="panel-title title-font">{{ title() }}</h2>

      <!-- Subtitle (optional) -->
      @if (subtitle()) {
        <span class="panel-subtitle">{{ subtitle() }}</span>
      }

      <!-- Spacer -->
      <span class="spacer"></span>

      <!-- Custom content projection -->
      <ng-content></ng-content>

      <!-- Actions -->
      @for (action of actions(); track action.id) {
        <button
          mat-icon-button
          class="action-button"
          (click)="actionClick.emit(action)"
          [matTooltip]="action.tooltip || action.label"
          [disabled]="action.disabled"
        >
          <mat-icon>{{ action.icon }}</mat-icon>
        </button>
      }
    </div>
  `,
  styles: `
    .panel-header {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 56px;
      padding: 0 12px;
      
      // Glass effect - light mode
      background-color: rgba(255, 255, 255, 0.85);
      -webkit-backdrop-filter: blur(20px) saturate(1.8);
      backdrop-filter: blur(20px) saturate(1.8);
      
      // Subtle bottom border
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      
      &.transparent {
        background-color: transparent;
        backdrop-filter: none;
        border-bottom: none;
      }
    }
    
    :host-context(.dark) .panel-header {
      background-color: rgba(24, 17, 27, 0.85);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      
      &.transparent {
        background-color: transparent;
        border-bottom: none;
      }
    }
    
    .back-button {
      margin-left: -4px;
    }
    
    .panel-title {
      margin: 0;
      font-size: 1.25rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .panel-subtitle {
      font-size: 0.875rem;
      opacity: 0.7;
      white-space: nowrap;
    }
    
    .spacer {
      flex: 1;
    }
    
    .action-button {
      flex-shrink: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelHeaderComponent {
  title = input.required<string>();
  subtitle = input<string>();
  showBack = input(false);
  backTooltip = input('Go back');
  transparent = input(false);
  actions = input<PanelAction[]>([]);

  backClick = output<void>();
  actionClick = output<PanelAction>();
}
