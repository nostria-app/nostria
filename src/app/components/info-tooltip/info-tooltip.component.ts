import { ChangeDetectionStrategy, Component, input, signal, inject, ViewChild, ElementRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { OverlayModule, Overlay, OverlayRef, OverlayPositionBuilder } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { TemplateRef } from '@angular/core';

@Component({
  selector: 'app-info-tooltip',
  imports: [MatIconModule, MatButtonModule, MatCardModule, OverlayModule],
  template: `
    <button
      #trigger
      mat-icon-button
      class="info-tooltip-trigger"
      (click)="toggleTooltip()"
      [attr.aria-label]="ariaLabel()"
    >
      <mat-icon>info</mat-icon>
    </button>
  `,
  styleUrl: './info-tooltip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoTooltipComponent {
  ariaLabel = input('Show information');
  content = input<TemplateRef<unknown> | null>(null);
  @ViewChild('trigger', { read: ElementRef }) trigger!: ElementRef;

  private overlay = inject(Overlay);
  private overlayPositionBuilder = inject(OverlayPositionBuilder);

  private overlayRef: OverlayRef | null = null;
  isOpen = signal(false);

  toggleTooltip(): void {
    if (this.isOpen()) {
      this.closeTooltip();
    } else {
      this.openTooltip();
    }
  }

  openTooltip(): void {
    if (this.overlayRef || !this.content()) return;

    const positionStrategy = this.overlayPositionBuilder
      .flexibleConnectedTo(this.trigger)
      .withPositions([
        {
          originX: 'end',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'bottom',
          offsetY: -8,
        },
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top',
          offsetY: 8,
        },
      ])
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      maxWidth: '400px',
      maxHeight: '300px',
    });

    const portal = new ComponentPortal(TooltipContentComponent);
    const componentRef = this.overlayRef.attach(portal);
    componentRef.instance.content = this.content();

    this.overlayRef.backdropClick().subscribe(() => this.closeTooltip());
    this.isOpen.set(true);
  }

  closeTooltip(): void {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.isOpen.set(false);
    }
  }
}

@Component({
  selector: 'app-tooltip-content',
  imports: [MatCardModule, NgTemplateOutlet],
  template: `
    <mat-card class="tooltip-content-card">
      <ng-container [ngTemplateOutlet]="content"></ng-container>
    </mat-card>
  `,
  styles: [
    `
      .tooltip-content-card {
        max-width: 400px;
        box-shadow: var(--mat-sys-level4);
        border: 1px solid var(--mat-sys-outline-variant);
      }

      :host {
        display: block;
        animation: fadeIn 0.2s ease-in-out;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipContentComponent {
  content: TemplateRef<unknown> | null = null;
}
