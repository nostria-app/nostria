import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { map } from 'rxjs';
import { RouteDataService } from '../../services/route-data.service';


@Component({
  selector: 'app-navigation',
  imports: [MatButtonModule, MatIconModule, RouterModule],
  templateUrl: './navigation.html',
  styleUrl: './navigation.scss',
})
export class NavigationComponent {
  hasState = computed(() => {
    return this.routeDataService.canGoBack();
  });

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Convert route data to signal
  routeData = toSignal(this.route.data.pipe(map(data => data)), {
    initialValue: {},
  });

  isRoot = signal<boolean>(false);

  // Touch and hold functionality
  private touchTimer: number | null = null;
  private readonly TOUCH_HOLD_DURATION = 500; // 500ms

  routeDataService = inject(RouteDataService);

  constructor() {
    effect(() => {
      const routeData = this.routeDataService.currentRouteData();
      this.isRoot.set(routeData['isRoot'] || false);
    });
  }

  // Regular click - go back
  goBack() {
    this.routeDataService.goBack();
  }

  /**
   * Navigate to feeds and clear navigation history
   */
  navigateToHome(): void {
    this.routeDataService.clearHistory();
    this.router.navigate(['/f']);
  }

  // Right click - show context menu
  onRightClick(event: MouseEvent) {
    event.preventDefault();
    this.showContextMenu(event);
  }

  // Touch start - begin touch hold timer
  onTouchStart(event: TouchEvent) {
    // Store the start time for duration checking
    (event.target as any).touchStartTime = event.timeStamp;

    this.touchTimer = window.setTimeout(() => {
      // Convert touch event to mouse event for context menu
      const touch = event.touches[0];
      const mouseEvent = new MouseEvent('contextmenu', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true,
      });
      this.onRightClick(mouseEvent);
    }, this.TOUCH_HOLD_DURATION);
  }

  // Touch end - clear timer and handle regular click
  onTouchEnd(event: TouchEvent) {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touchTimer = null;

      // If timer was cleared quickly, treat as regular click
      const touchDuration = event.timeStamp - ((event.target as any).touchStartTime || 0);
      if (touchDuration < this.TOUCH_HOLD_DURATION) {
        event.preventDefault(); // Prevent mouse events
        this.goBack();
      }
    }
  }

  // Touch cancel - clear timer
  onTouchCancel(event: TouchEvent) {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touchTimer = null;
    }
  }

  // Show context menu using global service
  private showContextMenu(event: MouseEvent) {
    if (this.routeDataService.canGoBack()) {
      // Dispatch a custom event to show the context menu
      const customEvent = new CustomEvent('show-navigation-context-menu', {
        detail: {
          x: event.clientX,
          y: event.clientY,
          onItemSelected: (index: number) => {
            this.routeDataService.goToHistoryItem(index);
          },
        },
      });
      window.dispatchEvent(customEvent);
    }
  }
}
