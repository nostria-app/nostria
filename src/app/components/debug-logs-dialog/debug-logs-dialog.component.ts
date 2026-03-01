import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { DataService, MalformedEventsInspectorSnapshot } from '../../services/data.service';

@Component({
  selector: 'app-debug-logs-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
  ],
  templateUrl: './debug-logs-dialog.component.html',
  styleUrls: ['./debug-logs-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebugLogsDialogComponent implements OnInit, OnDestroy {
  dialogRef = inject(CustomDialogRef<DebugLogsDialogComponent>);
  private readonly dataService = inject(DataService);
  private readonly snackBar = inject(MatSnackBar);

  private refreshInterval?: ReturnType<typeof setInterval>;
  autoRefresh = signal(true);
  currentTime = signal(Date.now());
  limit = signal(20);

  snapshot = computed<MalformedEventsInspectorSnapshot>(() => {
    this.currentTime();
    return this.dataService.getMalformedEventsInspector();
  });

  topContexts = computed(() => this.snapshot().contexts.slice(0, this.limit()));
  recentSamples = computed(() => this.snapshot().recentSamples.slice(0, this.limit()));

  ngOnInit(): void {
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  private startAutoRefresh(): void {
    if (this.refreshInterval) {
      return;
    }

    this.refreshInterval = setInterval(() => {
      if (this.autoRefresh()) {
        this.currentTime.set(Date.now());
      }
    }, 2000);
  }

  private stopAutoRefresh(): void {
    if (!this.refreshInterval) {
      return;
    }

    clearInterval(this.refreshInterval);
    this.refreshInterval = undefined;
  }

  toggleAutoRefresh(): void {
    this.autoRefresh.update((value) => !value);
  }

  refreshNow(): void {
    this.currentTime.set(Date.now());
  }

  increaseLimit(): void {
    this.limit.update((value) => Math.min(value + 10, 200));
  }

  decreaseLimit(): void {
    this.limit.update((value) => Math.max(value - 10, 10));
  }

  resetInspector(): void {
    this.dataService.resetMalformedEventsInspector();
    this.refreshNow();
  }

  async copySnapshot(): Promise<void> {
    const payload = JSON.stringify(this.snapshot(), null, 2);

    try {
      await navigator.clipboard.writeText(payload);
      this.snackBar.open($localize`:@@debugLogsDialog.snapshotCopied:Debug snapshot copied`, 'Close', {
        duration: 2500,
      });
    } catch {
      this.snackBar.open($localize`:@@debugLogsDialog.snapshotCopyFailed:Failed to copy debug snapshot`, 'Close', {
        duration: 2500,
      });
    }
  }

  logSnapshot(): void {
    this.dataService.logMalformedEventsInspector(this.limit());
  }

  formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }
}
