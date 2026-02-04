import { Component, inject, computed } from '@angular/core';
import { SubscriptionManagerService } from '../../services/relays/subscription-manager';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';

@Component({
  selector: 'app-relay-diagnostics',
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
  ],
  template: `
    <mat-card>
      <mat-card-header>
        <mat-card-title>
          <mat-icon>analytics</mat-icon>
          Relay Subscription Diagnostics
        </mat-card-title>
      </mat-card-header>

      <mat-card-content>
        <!-- Summary Section -->
        <div class="metrics-summary">
          <div class="metric-card">
            <div class="metric-value">{{ metrics().totalSubscriptions }}</div>
            <div class="metric-label">Active Subscriptions</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ metrics().totalPendingRequests }}</div>
            <div class="metric-label">Pending Requests</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ metrics().totalConnections }}</div>
            <div class="metric-label">Active Connections</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">{{ metrics().poolInstances.size }}</div>
            <div class="metric-label">Pool Instances</div>
          </div>
        </div>

        <!-- Subscriptions by Source -->
        @if (metrics().subscriptionsBySource.size > 0) {
          <div class="section">
            <h3>Subscriptions by Source</h3>
            <mat-chip-set>
              @for (entry of subscriptionsBySourceArray(); track entry[0]) {
                <mat-chip>{{ entry[0] }}: {{ entry[1] }}</mat-chip>
              }
            </mat-chip-set>
          </div>
        }

        <!-- Active Connections Table -->
        @if (connectionArray().length > 0) {
          <div class="section">
            <h3>Active Relay Connections</h3>
            <table mat-table [dataSource]="connectionArray()">
              <ng-container matColumnDef="url">
                <th mat-header-cell *matHeaderCellDef>Relay URL</th>
                <td mat-cell *matCellDef="let conn">{{ conn[0] }}</td>
              </ng-container>

              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let conn">
                  <mat-chip [class.connected]="conn[1].isConnected" [class.disconnected]="!conn[1].isConnected">
                    {{ conn[1].isConnected ? 'Connected' : 'Disconnected' }}
                  </mat-chip>
                </td>
              </ng-container>

              <ng-container matColumnDef="subscriptions">
                <th mat-header-cell *matHeaderCellDef>Subscriptions</th>
                <td mat-cell *matCellDef="let conn">{{ conn[1].activeSubscriptions }}</td>
              </ng-container>

              <ng-container matColumnDef="requests">
                <th mat-header-cell *matHeaderCellDef>Pending Requests</th>
                <td mat-cell *matCellDef="let conn">{{ conn[1].pendingRequests }}</td>
              </ng-container>

              <ng-container matColumnDef="pool">
                <th mat-header-cell *matHeaderCellDef>Pool Instance</th>
                <td mat-cell *matCellDef="let conn">{{ conn[1].poolInstance }}</td>
              </ng-container>

              <ng-container matColumnDef="lastActivity">
                <th mat-header-cell *matHeaderCellDef>Last Activity</th>
                <td mat-cell *matCellDef="let conn">{{ formatTime(conn[1].lastActivity) }}</td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
            </table>
          </div>
        }

        <!-- Active Subscriptions Details -->
        @if (metrics().subscriptions.length > 0) {
          <div class="section">
            <h3>Active Subscriptions Detail</h3>
            @for (sub of metrics().subscriptions; track sub.id) {
              @if (sub.active) {
                <div class="subscription-detail">
                  <div class="sub-header">
                    <strong>{{ sub.id }}</strong>
                    <span class="age">{{ getAge(sub.createdAt) }}s ago</span>
                  </div>
                  <div class="sub-info">
                    <div><strong>Source:</strong> {{ sub.source }}</div>
                    <div><strong>Relays:</strong> {{ sub.relayUrls.join(', ') }}</div>
                    <div><strong>Filter:</strong> <code>{{ formatFilter(sub.filter) }}</code></div>
                  </div>
                </div>
              }
            }
          </div>
        }
      </mat-card-content>

      <mat-card-actions>
        <button mat-raised-button (click)="refreshMetrics()">
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
        <button mat-raised-button (click)="logMetrics()">
          <mat-icon>terminal</mat-icon>
          Log to Console
        </button>
        <button mat-raised-button color="warn" (click)="cleanupStale()">
          <mat-icon>cleaning_services</mat-icon>
          Cleanup Stale
        </button>
      </mat-card-actions>
    </mat-card>
  `,
  styles: [`
    mat-card {
      margin: 1rem;
      max-width: 1400px;
    }

    mat-card-header {
      margin-bottom: 1rem;
    }

    mat-card-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--mat-sys-on-surface);
    }

    .metrics-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .metric-card {
      padding: 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      text-align: center;
      background-color: var(--mat-sys-surface-container);
    }

    .metric-value {
      font-size: 2rem;
      color: var(--mat-sys-primary);
    }

    .metric-label {
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 0.5rem;
    }

    .section {
      margin: 2rem 0;
    }

    .section h3 {
      margin-bottom: 1rem;
      color: var(--mat-sys-on-surface);
    }

    mat-chip-set {
      margin: 1rem 0;
    }

    table {
      width: 100%;
      margin-top: 1rem;
    }

    mat-chip.connected {
      background-color: #4caf50;
      color: white;
    }

    mat-chip.disconnected {
      background-color: #f44336;
      color: white;
    }

    .subscription-detail {
      padding: 1rem;
      margin: 0.5rem 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background-color: var(--mat-sys-surface-container);
    }

    .sub-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
      color: var(--mat-sys-on-surface);
    }

    .age {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
    }

    .sub-info {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface);
    }

    .sub-info code {
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface);
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-size: 0.85rem;
    }

    mat-card-actions {
      display: flex;
      gap: 0.5rem;
      padding: 1rem;
    }
  `],
})
export class RelayDiagnosticsComponent {
  private subscriptionManager = inject(SubscriptionManagerService);

  metrics = this.subscriptionManager.metricsSignal;

  displayedColumns = ['url', 'status', 'subscriptions', 'requests', 'pool', 'lastActivity'];

  subscriptionsBySourceArray = computed(() => {
    return Array.from(this.metrics().subscriptionsBySource.entries());
  });

  connectionArray = computed(() => {
    return Array.from(this.metrics().connectionsByRelay.entries());
  });

  refreshMetrics(): void {
    // Metrics are already reactive, just trigger a UI update
    console.log('Metrics refreshed');
  }

  logMetrics(): void {
    this.subscriptionManager.logMetrics();
  }

  cleanupStale(): void {
    const cleaned = this.subscriptionManager.cleanupStaleSubscriptions();
    console.log(`Cleaned up ${cleaned} stale subscriptions`);
  }

  formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = Math.round((now - timestamp) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return `${Math.round(diff / 3600)}h ago`;
  }

  getAge(timestamp: number): number {
    return Math.round((Date.now() - timestamp) / 1000);
  }

  formatFilter(filter: object): string {
    return JSON.stringify(filter, null, 0);
  }
}
