import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NostrService } from '../../services/nostr.service';
import { RouterModule } from '@angular/router';
import { RelayPublishingNotification, RelayPublishPromise } from '../../services/database.service';
import {
  EventDetailsDialogComponent,
  type EventDetailsDialogData,
} from '../event-details-dialog/event-details-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';

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
    RouterModule,
    DecimalPipe,
  ],
  templateUrl: './relay-publish-status.component.html',
  styleUrls: ['./relay-publish-status.component.scss'],
})
export class RelayPublishStatusComponent {
  @Input() notification!: RelayPublishingNotification;
  @Output() retry = new EventEmitter<string>();
  @Output() republish = new EventEmitter<string>();

  private nostrService = inject(NostrService);
  private customDialog = inject(CustomDialogService);

  get successCount(): number {
    if (!this.notification.relayPromises || this.notification.relayPromises.length === 0) {
      return 0;
    }
    return this.notification.relayPromises.filter(rp => rp.status === 'success').length;
  }

  get failedCount(): number {
    if (!this.notification.relayPromises || this.notification.relayPromises.length === 0) {
      return 0;
    }
    return this.notification.relayPromises.filter(rp => rp.status === 'failed').length;
  }

  get pendingCount(): number {
    if (!this.notification.relayPromises || this.notification.relayPromises.length === 0) {
      return 0;
    }
    return this.notification.relayPromises.filter(rp => rp.status === 'pending').length;
  }

  get progress(): number {
    if (!this.notification.relayPromises || this.notification.relayPromises.length === 0) {
      return 0;
    }
    const total = this.notification.relayPromises.length;
    const completed = this.successCount + this.failedCount;
    return total > 0 ? (completed / total) * 100 : 0;
  }

  get hasFailures(): boolean {
    return this.failedCount > 0;
  }

  onRetry(): void {
    this.retry.emit(this.notification.id);
  }

  onRepublish(): void {
    this.republish.emit(this.notification.id);
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
      data: { event: this.notification.event } as EventDetailsDialogData,
    });

    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.dialogData = { event: this.notification.event };
  }
}
