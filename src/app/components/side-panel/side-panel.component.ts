import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { SidePanelService } from '../../services/side-panel.service';
import { EventPageComponent } from '../../pages/event/event.component';
import { ProfileSidePanelComponent } from '../profile-side-panel/profile-side-panel.component';
import { Router } from '@angular/router';

@Component({
  selector: 'app-side-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    EventPageComponent,
    ProfileSidePanelComponent,
  ],
  template: `
    <!-- Backdrop for mobile -->
    @if (sidePanel.isOpen()) {
      <div class="side-panel-backdrop" 
           (click)="close()" 
           (keydown.escape)="close()"
           role="button"
           tabindex="0"
           aria-label="Close side panel"></div>
    }
    
    <div class="side-panel-container" [class.open]="sidePanel.isOpen()">
      <div class="side-panel-header">
        <button mat-icon-button (click)="close()" aria-label="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      <div class="side-panel-content">
        @if (sidePanel.content(); as content) {
          @if (content.type === 'event') {
            <app-event-page 
              [dialogEventId]="content.eventId"
              [dialogEvent]="content.event"
            />
          } @else if (content.type === 'profile') {
            <app-profile-side-panel [pubkey]="content.pubkey" />
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .side-panel-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 899;
      animation: fadeIn 0.3s ease-in-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    /* Hide backdrop on desktop where we show side-by-side */
    @media (min-width: 768px) {
      .side-panel-backdrop {
        display: none;
      }
    }

    .side-panel-container {
      position: fixed;
      top: var(--toolbar-height, 64px);
      right: 0;
      bottom: 0;
      width: 100%;
      background-color: var(--mat-sys-surface);
      transform: translateX(100%);
      transition: transform 0.3s ease-in-out;
      z-index: 900;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.2);
    }

    .side-panel-container.open {
      transform: translateX(0);
    }

    .side-panel-header {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      flex-shrink: 0;
    }

    .side-panel-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    /* Mobile: full screen overlay */
    @media (max-width: 767px) {
      .side-panel-container {
        top: 0;
        bottom: 0;
      }
    }

    /* Tablet: 60% width, positioned from right edge */
    @media (min-width: 768px) and (max-width: 1279px) {
      .side-panel-container {
        width: 60%;
      }
    }

    /* Desktop: 50% width, max 640px */
    @media (min-width: 1280px) {
      .side-panel-container {
        width: 50%;
        max-width: 640px;
      }
    }

    :host-context(.dark) .side-panel-container {
      background-color: var(--mat-sys-surface);
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.5);
    }

    :host-context(.dark) .side-panel-header {
      border-bottom-color: var(--mat-sys-outline-variant);
    }

    :host-context(.dark) .side-panel-backdrop {
      background-color: rgba(0, 0, 0, 0.7);
    }
  `]
})
export class SidePanelComponent {
  sidePanel = inject(SidePanelService);
  private router = inject(Router);

  close() {
    this.sidePanel.close();
  }
}
