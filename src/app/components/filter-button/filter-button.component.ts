import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';

/**
 * Unified filter button component used across all pages.
 * Displays a `tune` icon button that opens a CDK overlay panel.
 * The button highlights (lights up) when `active` is true, indicating
 * that the filter has been modified from its default state.
 *
 * Usage:
 * ```html
 * <app-filter-button [active]="hasActiveFilters()" tooltip="Filter content">
 *   <app-my-filter-panel />
 * </app-filter-button>
 * ```
 */
@Component({
  selector: 'app-filter-button',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    OverlayModule,
  ],
  template: `
    <button
      mat-icon-button
      cdkOverlayOrigin
      #filterTrigger="cdkOverlayOrigin"
      (click)="togglePanel()"
      [matTooltip]="tooltip()"
      [class.filter-active]="active()">
      <mat-icon>tune</mat-icon>
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="filterTrigger"
      [cdkConnectedOverlayOpen]="panelOpen()"
      [cdkConnectedOverlayHasBackdrop]="true"
      [cdkConnectedOverlayBackdropClass]="'cdk-overlay-transparent-backdrop'"
      (backdropClick)="closePanel()"
      [cdkConnectedOverlayPositions]="panelPositions"
      [cdkConnectedOverlayPush]="true">
      <ng-content></ng-content>
    </ng-template>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }

    .filter-active {
      color: var(--mat-sys-primary) !important;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent) !important;
      border-radius: 50%;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterButtonComponent {
  /** Whether the filter is in an active (non-default) state */
  active = input(false);

  /** Tooltip text for the button */
  tooltip = input('Filter');

  /** Whether the overlay panel is open */
  panelOpen = signal(false);

  /** CDK overlay positioning */
  panelPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

  togglePanel(): void {
    this.panelOpen.update(v => !v);
  }

  closePanel(): void {
    this.panelOpen.set(false);
  }
}
