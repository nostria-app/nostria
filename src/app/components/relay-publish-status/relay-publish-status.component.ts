import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RelayPublishingNotification, RelayPublishPromise } from '../../services/database.service';
import {
  EventDetailsDialogComponent,
  type EventDetailsDialogData,
} from '../event-details-dialog/event-details-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { LayoutService } from '../../services/layout.service';
import { EventRelaySourcesService } from '../../services/event-relay-sources.service';

@Component({
  selector: 'app-relay-publish-status',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatDividerModule,
    MatChipsModule,
    MatTooltipModule,
  ],
  templateUrl: './relay-publish-status.component.html',
  styleUrls: ['./relay-publish-status.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelayPublishStatusComponent {
  notification = input.required<RelayPublishingNotification>();
  retry = output<string>();
  republish = output<string>();

  private customDialog = inject(CustomDialogService);
  private eventRelaySources = inject(EventRelaySourcesService);
  layout = inject(LayoutService);

  get successCount(): number {
    const promises = this.notification().relayPromises;
    if (!promises || promises.length === 0) return 0;
    return promises.filter(rp => rp.status === 'success').length;
  }

  get failedCount(): number {
    const promises = this.notification().relayPromises;
    if (!promises || promises.length === 0) return 0;
    return promises.filter(rp => rp.status === 'failed').length;
  }

  get pendingCount(): number {
    const promises = this.notification().relayPromises;
    if (!promises || promises.length === 0) return 0;
    return promises.filter(rp => rp.status === 'pending').length;
  }

  get progress(): number {
    const promises = this.notification().relayPromises;
    if (!promises || promises.length === 0) return 0;
    const total = promises.length;
    return total > 0 ? (this.successCount / total) * 100 : 0;
  }

  get progressText(): string {
    if (this.pendingCount > 0) {
      return `${this.progress.toFixed(0)}% success so far`;
    }

    if (this.failedCount > 0) {
      return `${this.progress.toFixed(0)}% success`;
    }

    return '100% complete';
  }

  get hasFailures(): boolean {
    return this.failedCount > 0;
  }

  get retryCount(): number {
    return this.notification().retryCount ?? 0;
  }

  get autoRetryLimitReached(): boolean {
    return this.hasFailures && this.retryCount >= 2;
  }

  onRetry(): void {
    this.retry.emit(this.notification().id);
  }

  onRepublish(): void {
    this.republish.emit(this.notification().id);
  }

  getRelayName(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch {
      return url;
    }
  }

  trackByRelayUrl(index: number, item: RelayPublishPromise): string {
    return item.relayUrl;
  }

  getErrorMessage(error: unknown): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return 'Failed to publish';
  }

  viewEventJson(): void {
    const dialogRef = this.customDialog.open(EventDetailsDialogComponent, {
      title: 'Event Details',
      width: '800px',
      maxWidth: '95vw',
      data: {
        event: this.notification().event,
        relayUrls: this.eventRelaySources.getRelayUrls(this.notification().event.id),
      } as EventDetailsDialogData,
    });

    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.dialogData = {
      event: this.notification().event,
      relayUrls: this.eventRelaySources.getRelayUrls(this.notification().event.id),
    };
  }

  openPublishedEvent(): void {
    const event = this.notification().event;
    this.layout.openGenericEvent(event.id, event);
  }
}
