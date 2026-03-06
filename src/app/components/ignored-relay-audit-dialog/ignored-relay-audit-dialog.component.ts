import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import {
  IgnoredRelayAuditEntry,
  IgnoredRelayAuditService,
  IgnoredRelayAuditSnapshot,
} from '../../services/ignored-relay-audit.service';
import { DataService } from '../../services/data.service';
import { MessagingService } from '../../services/messaging.service';
import { UtilitiesService } from '../../services/utilities.service';
import { NostrRecord } from '../../interfaces';
import { AccountStateService } from '../../services/account-state.service';
import { ProfileHoverCardService } from '../../services/profile-hover-card.service';

interface IgnoredRelayAuditViewEntry extends IgnoredRelayAuditEntry {
  displayName: string;
  npubShort: string;
  avatarUrl?: string;
}

@Component({
  selector: 'app-ignored-relay-audit-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
  ],
  templateUrl: './ignored-relay-audit-dialog.component.html',
  styleUrls: ['./ignored-relay-audit-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IgnoredRelayAuditDialogComponent implements OnInit, OnDestroy {
  dialogRef = inject(CustomDialogRef<IgnoredRelayAuditDialogComponent>);

  private readonly auditService = inject(IgnoredRelayAuditService);
  private readonly dataService = inject(DataService);
  private readonly messaging = inject(MessagingService);
  private readonly utilities = inject(UtilitiesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly accountState = inject(AccountStateService);
  private readonly profileHoverCard = inject(ProfileHoverCardService);

  private refreshInterval?: ReturnType<typeof setInterval>;

  autoRefresh = signal(true);
  isLoadingProfiles = signal(false);
  sendingPubkeys = signal<Set<string>>(new Set());
  sentPubkeys = signal<Set<string>>(new Set());
  failedPubkeys = signal<Set<string>>(new Set());
  rowLimit = signal(200);

  snapshot = signal<IgnoredRelayAuditSnapshot>(this.auditService.getSnapshot());
  profileMap = signal<Map<string, NostrRecord | null>>(new Map());

  viewEntries = computed<IgnoredRelayAuditViewEntry[]>(() => {
    const map = this.profileMap();
    return this.snapshot().entries.slice(0, this.rowLimit()).map((entry) => {
      const record = map.get(entry.pubkey) ?? null;
      const data = (record?.data ?? {}) as {
        name?: string;
        display_name?: string;
        displayName?: string;
        picture?: string;
      };

      const displayName =
        data.display_name
        || data.displayName
        || data.name
        || this.utilities.getNpubShort(entry.pubkey, 16);

      return {
        ...entry,
        displayName,
        npubShort: this.utilities.getNpubShort(entry.pubkey, 16),
        avatarUrl: typeof data.picture === 'string' ? data.picture : undefined,
      };
    });
  });

  advisoryMessage = signal(
    'Hi! Your relay list includes one or more dead relays. Please update your relay list to remove dead relays so other clients can reach your profile and events more reliably. You can check relay status here: https://monitor.nostria.app/'
  );

  ngOnInit(): void {
    void this.refresh();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  private startAutoRefresh(): void {
    this.refreshInterval = setInterval(() => {
      if (this.autoRefresh()) {
        void this.refresh();
      }
    }, 3000);
  }

  async refresh(): Promise<void> {
    const nextSnapshot = this.auditService.getSnapshot();
    this.snapshot.set(nextSnapshot);
    await this.loadMissingProfiles(nextSnapshot.entries.map((entry) => entry.pubkey));
  }

  toggleAutoRefresh(): void {
    this.autoRefresh.update((value) => !value);
  }

  async sendAdvisoryDm(pubkey: string): Promise<void> {
    if (!pubkey) {
      return;
    }

    const myPubkey = this.accountState.pubkey();
    if (pubkey === myPubkey) {
      this.snackBar.open('Cannot send advisory DM to yourself', 'Close', { duration: 2500 });
      return;
    }

    const sending = this.sendingPubkeys();
    if (sending.has(pubkey)) {
      return;
    }

    this.sendingPubkeys.set(new Set(sending).add(pubkey));

    const sent = new Set(this.sentPubkeys());
    sent.delete(pubkey);
    this.sentPubkeys.set(sent);

    const failed = new Set(this.failedPubkeys());
    failed.delete(pubkey);
    this.failedPubkeys.set(failed);

    try {
      await this.messaging.sendDirectMessage(this.advisoryMessage(), pubkey);
      this.sentPubkeys.update((current) => new Set(current).add(pubkey));
      this.snackBar.open('Advisory DM sent', 'Close', { duration: 2500 });
    } catch {
      this.failedPubkeys.update((current) => new Set(current).add(pubkey));
      this.snackBar.open('Failed to send advisory DM', 'Close', { duration: 3000 });
    } finally {
      this.sendingPubkeys.update((current) => {
        const next = new Set(current);
        next.delete(pubkey);
        return next;
      });
    }
  }

  resetAudit(): void {
    this.auditService.reset();
    this.profileMap.set(new Map());
    void this.refresh();
  }

  async copySnapshot(): Promise<void> {
    const payload = JSON.stringify(this.snapshot(), null, 2);

    try {
      await navigator.clipboard.writeText(payload);
      this.snackBar.open('Audit snapshot copied', 'Close', { duration: 2500 });
    } catch {
      this.snackBar.open('Failed to copy snapshot', 'Close', { duration: 2500 });
    }
  }

  formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  isSending(pubkey: string): boolean {
    return this.sendingPubkeys().has(pubkey);
  }

  wasSent(pubkey: string): boolean {
    return this.sentPubkeys().has(pubkey);
  }

  hasSendFailed(pubkey: string): boolean {
    return this.failedPubkeys().has(pubkey);
  }

  onProfileMouseEnter(triggerElement: HTMLElement, pubkey: string): void {
    this.profileHoverCard.showHoverCard(triggerElement, pubkey);
  }

  onProfileMouseLeave(): void {
    this.profileHoverCard.hideHoverCard();
  }

  private async loadMissingProfiles(pubkeys: string[]): Promise<void> {
    const existingMap = this.profileMap();
    const missing = pubkeys.filter((pubkey) => !existingMap.has(pubkey));

    if (missing.length === 0) {
      return;
    }

    this.isLoadingProfiles.set(true);

    try {
      const records = (await this.dataService.getProfiles(missing)) || [];
      const loadedByPubkey = new Map<string, NostrRecord>();
      for (const record of records) {
        loadedByPubkey.set(record.event.pubkey, record);
      }

      const updated = new Map(existingMap);
      for (const pubkey of missing) {
        updated.set(pubkey, loadedByPubkey.get(pubkey) || null);
      }

      this.profileMap.set(updated);
    } finally {
      this.isLoadingProfiles.set(false);
    }
  }
}
