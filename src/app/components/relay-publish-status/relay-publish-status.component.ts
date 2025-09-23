import { Component, EventEmitter, Input, Output, inject } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NostrService } from '../../services/nostr.service';
import { RouterModule } from '@angular/router';
import { RelayPublishingNotification, RelayPublishPromise } from '../../services/storage.service';

@Component({
  selector: 'app-relay-publish-status',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatDividerModule,
    MatChipsModule,
    MatTooltipModule,
    RouterModule,
  ],
  templateUrl: './relay-publish-status.component.html',
  styleUrls: ['./relay-publish-status.component.scss'],
})
export class RelayPublishStatusComponent {
  @Input() notification!: RelayPublishingNotification;
  @Output() retry = new EventEmitter<string>();

  private nostrService = inject(NostrService);

  get successCount(): number {
    return this.notification.relayPromises?.filter(rp => rp.status === 'success').length || 0;
  }

  get failedCount(): number {
    return this.notification.relayPromises?.filter(rp => rp.status === 'failed').length || 0;
  }

  get pendingCount(): number {
    return this.notification.relayPromises?.filter(rp => rp.status === 'pending').length || 0;
  }

  get progress(): number {
    const total = this.notification.relayPromises?.length || 0;
    const completed = this.successCount + this.failedCount;
    return total > 0 ? (completed / total) * 100 : 0;
  }

  get hasFailures(): boolean {
    return this.failedCount > 0;
  }

  onRetry(): void {
    this.retry.emit(this.notification.id);
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
}
