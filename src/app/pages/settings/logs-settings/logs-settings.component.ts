import { Component, inject, computed, effect, signal } from '@angular/core';

import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { AccountStateService } from '../../../services/account-state.service';
import { NostrService } from '../../../services/nostr.service';
import { DatabaseService } from '../../../services/database.service';
import { InfoRecord } from '../../../services/database.service';
import { RelaysService, RelayStats } from '../../../services/relays/relays';
import { ApplicationService } from '../../../services/application.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountRelayService } from '../../../services/relays/account-relay';

export interface RelayClusterOutput {
  relay: string;
  users: string[];
  userCount: number;
  connectionStatus: 'connected' | 'offline' | 'unknown';
  eventsReceived: number;
  performanceScore: number;
  sharedWithRelays: RelayConnection[];
}

export interface RelayConnection {
  relay: string;
  sharedUsers: number;
  connectionStrength: number; // 0-100 based on shared users
}

@Component({
  selector: 'app-logs-settings',
  standalone: true,
  imports: [
    MatTabsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatProgressBarModule,
    MatChipsModule,
    MatTooltipModule,
    MatExpansionModule,
  ],
  templateUrl: './logs-settings.component.html',
  styleUrls: ['./logs-settings.component.scss'],
})
export class LogsSettingsComponent {
  accountState = inject(AccountStateService);
  nostr = inject(NostrService);
  database = inject(DatabaseService);
  accountRelay = inject(AccountRelayService);
  relaysService = inject(RelaysService);
  app = inject(ApplicationService);
  logger = inject(LoggerService);
  utilities = inject(UtilitiesService);

  disabledRelays = signal<any>([]);
  relayStats = computed(() => this.relaysService.relayStatsSignal());
  userRelays = computed(() => this.relaysService.userRelaysSignal());
  clusterOutput = signal<RelayClusterOutput[]>([]);

  // Computed properties for UI
  connectedRelays = computed(() =>
    Array.from(this.relayStats().entries())
      .filter(([_, stats]) => stats.isConnected)
      .sort((a, b) => b[1].eventsReceived - a[1].eventsReceived)
  );

  offlineRelays = computed(() =>
    Array.from(this.relayStats().entries())
      .filter(([_, stats]) => stats.isOffline)
      .sort((a, b) => b[1].connectionAttempts - a[1].connectionAttempts)
  );

  allRelayStats = computed(() =>
    Array.from(this.relayStats().entries()).sort((a, b) => {
      // Sort by connection status first, then by events received
      if (a[1].isConnected && !b[1].isConnected) return -1;
      if (!a[1].isConnected && b[1].isConnected) return 1;
      return b[1].eventsReceived - a[1].eventsReceived;
    })
  );

  constructor() {
    effect(async () => {
      if (this.app.initialized() && this.app.authenticated()) {
        const relaysInfo = await this.database.getInfoByType('relay');
        const disabledRelays = relaysInfo.filter((relay: any) => relay.disabled);
        this.disabledRelays.set(disabledRelays);
        this.logger.info('Disabled relays:', disabledRelays);

        // Generate cluster output
        this.generateClusterOutput();
      }
    });
  }

  getWebUrl(relayUrl: string) {
    return relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  }

  async removeDisabledRelay(relay: InfoRecord) {
    relay['disabled'] = false;
    relay['suspendedCount'] = 0;
    await this.database.updateInfo(relay);
    this.disabledRelays.update(relays => relays.filter((r: InfoRecord) => r.key !== relay.key));
  }

  /**
   * Reset statistics for a specific relay
   */
  resetRelayStats(relayUrl: string): void {
    const stats = this.relaysService.getRelayStats(relayUrl);
    if (stats) {
      // Reset the statistics
      stats.eventsReceived = 0;
      stats.connectionAttempts = 0;
      stats.lastConnectionRetry = 0;
      stats.lastSuccessfulConnection = 0;
      // Keep connection status as is

      this.logger.info(`Reset statistics for relay: ${relayUrl}`);
    }
  }

  /**
   * Get connection status icon and color
   */
  getConnectionStatusIcon(stats: RelayStats): {
    icon: string;
    color: string;
    tooltip: string;
  } {
    if (stats.isConnected) {
      return { icon: 'wifi', color: 'primary', tooltip: 'Connected' };
    } else if (stats.isOffline) {
      return { icon: 'wifi_off', color: 'warn', tooltip: 'Offline' };
    } else {
      return { icon: 'wifi_tethering', color: 'accent', tooltip: 'Unknown' };
    }
  }

  /**
   * Format timestamp to relative time
   */
  formatRelativeTime(timestamp: number): string {
    if (timestamp === 0) return 'Never';

    const now = this.utilities.currentDate();
    const diffSeconds = now - timestamp;

    if (diffSeconds < 60) return 'Just now';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  }

  /**
   * Get performance score color
   */
  getPerformanceScoreColor(score: number): string {
    if (score >= 80) return 'primary';
    if (score >= 60) return 'accent';
    if (score >= 40) return 'warn';
    return 'warn';
  }

  /**
   * Generate cluster output showing relay relationships
   */
  generateClusterOutput(): void {
    const userRelaysMap = this.userRelays();
    const relayStatsMap = this.relayStats();
    const clusterData: RelayClusterOutput[] = [];

    // Create a map of relay -> users
    const relayToUsers = new Map<string, string[]>();

    userRelaysMap.forEach((relays, pubkey) => {
      relays.forEach(relay => {
        if (!relayToUsers.has(relay)) {
          relayToUsers.set(relay, []);
        }
        relayToUsers.get(relay)!.push(pubkey);
      });
    });

    // Generate cluster output for each relay
    relayToUsers.forEach((users, relay) => {
      const stats = relayStatsMap.get(relay);
      const performanceScore = this.relaysService.getRelayPerformanceScore(relay);

      // Find connections to other relays
      const sharedWithRelays: RelayConnection[] = [];

      relayToUsers.forEach((otherUsers, otherRelay) => {
        if (relay !== otherRelay) {
          const sharedUsers = users.filter(user => otherUsers.includes(user));
          if (sharedUsers.length > 0) {
            const connectionStrength = Math.round(
              (sharedUsers.length / Math.max(users.length, otherUsers.length)) * 100
            );
            sharedWithRelays.push({
              relay: otherRelay,
              sharedUsers: sharedUsers.length,
              connectionStrength,
            });
          }
        }
      });

      // Sort by connection strength
      sharedWithRelays.sort((a, b) => b.connectionStrength - a.connectionStrength);

      const connectionStatus: 'connected' | 'offline' | 'unknown' = stats?.isConnected
        ? 'connected'
        : stats?.isOffline
          ? 'offline'
          : 'unknown';

      clusterData.push({
        relay,
        users,
        userCount: users.length,
        connectionStatus,
        eventsReceived: stats?.eventsReceived || 0,
        performanceScore,
        sharedWithRelays: sharedWithRelays.slice(0, 5), // Top 5 connections
      });
    });

    // Sort by user count (most popular relays first)
    clusterData.sort((a, b) => b.userCount - a.userCount);

    this.clusterOutput.set(clusterData);
    this.logger.info('Generated cluster output:', clusterData);
  }

  /**
   * Get cluster output for external use (e.g., for cluster map visualization)
   */
  getClusterOutput(): RelayClusterOutput[] {
    return this.clusterOutput();
  }

  /**
   * Export cluster data as JSON
   */
  exportClusterData(): void {
    const clusterData = this.getClusterOutput();
    const dataStr = JSON.stringify(clusterData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `relay-cluster-data-${new Date().toISOString().split('T')[0]}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }
}
