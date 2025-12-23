import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';

@Component({
  selector: 'app-circular-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg 
      [attr.width]="size()" 
      [attr.height]="size()" 
      [attr.viewBox]="viewBox()"
      class="circular-progress"
    >
      <!-- Background circle -->
      <circle
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        fill="none"
        [attr.stroke]="trackColor()"
        [attr.stroke-width]="strokeWidth()"
        class="progress-track"
      />
      
      <!-- Progress arc -->
      <circle
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        fill="none"
        [attr.stroke]="progressColor()"
        [attr.stroke-width]="strokeWidth()"
        [attr.stroke-dasharray]="circumference()"
        [attr.stroke-dashoffset]="dashOffset()"
        stroke-linecap="round"
        class="progress-bar"
        [style.transform]="'rotate(-90deg)'"
        [style.transform-origin]="center() + 'px ' + center() + 'px'"
      />
      
      <!-- Thumb/handle -->
      @if (showThumb()) {
        <circle
          [attr.cx]="thumbX()"
          [attr.cy]="thumbY()"
          [attr.r]="thumbRadius()"
          [attr.fill]="progressColor()"
          class="progress-thumb"
        />
      }
    </svg>
  `,
  styles: [`
    :host {
      display: block;
    }

    .circular-progress {
      display: block;
    }

    .progress-track {
      opacity: 0.3;
    }

    .progress-bar {
      transition: stroke-dashoffset 0.1s ease-out;
    }

    .progress-thumb {
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
      transition: cx 0.1s ease-out, cy 0.1s ease-out;
    }
  `],
})
export class CircularProgressComponent {
  /** Progress value from 0 to 1 */
  progress = input<number>(0);

  /** Size of the SVG in pixels */
  size = input<number>(200);

  /** Stroke width of the progress bar */
  strokeWidth = input<number>(8);

  /** Color of the track (background circle) */
  trackColor = input<string>('rgba(255, 255, 255, 0.2)');

  /** Color of the progress bar */
  progressColor = input<string>('var(--mat-sys-primary)');

  /** Whether to show the thumb/handle */
  showThumb = input<boolean>(true);

  /** Radius of the thumb */
  thumbRadius = input<number>(6);

  viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);

  center = computed(() => this.size() / 2);

  radius = computed(() => (this.size() - this.strokeWidth()) / 2);

  circumference = computed(() => 2 * Math.PI * this.radius());

  dashOffset = computed(() => {
    const progress = Math.max(0, Math.min(1, this.progress()));
    return this.circumference() * (1 - progress);
  });

  // Calculate thumb position on the circle
  thumbX = computed(() => {
    const progress = Math.max(0, Math.min(1, this.progress()));
    const angle = progress * 2 * Math.PI - Math.PI / 2; // Start from top
    return this.center() + this.radius() * Math.cos(angle);
  });

  thumbY = computed(() => {
    const progress = Math.max(0, Math.min(1, this.progress()));
    const angle = progress * 2 * Math.PI - Math.PI / 2; // Start from top
    return this.center() + this.radius() * Math.sin(angle);
  });
}
