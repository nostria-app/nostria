import { Injectable, computed, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class EventFocusService {
  private readonly focusedCount = signal(0);
  private readonly bootstrapActive = signal(false);
  readonly isEventFocused = computed(() => this.focusedCount() > 0);

  activate(): void {
    if (this.bootstrapActive()) {
      this.bootstrapActive.set(false);
      return;
    }

    this.focusedCount.update(count => count + 1);
  }

  deactivate(): void {
    this.focusedCount.update(count => (count > 0 ? count - 1 : 0));
  }

  activateBootstrap(): void {
    if (!this.bootstrapActive()) {
      this.bootstrapActive.set(true);
      this.focusedCount.update(count => count + 1);
    }
  }

  deactivateBootstrap(): void {
    if (this.bootstrapActive()) {
      this.bootstrapActive.set(false);
      this.focusedCount.update(count => (count > 0 ? count - 1 : 0));
    }
  }
}
