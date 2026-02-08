import { Component, inject, OnInit, signal, computed, OnDestroy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { ApplicationService } from '../../services/application.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { MatListModule } from '@angular/material/list';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';
import { SetUsernameDialogComponent, SetUsernameDialogData } from './set-username-dialog/set-username-dialog.component';
import { PremiumApiService, SubscriptionHistoryItem, PaymentHistoryItem } from '../../services/premium-api.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-premium',
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatExpansionModule,
    MatDividerModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    RouterLink,
  ],
  templateUrl: './premium.component.html',
  styleUrl: './premium.component.scss',
})
export class PremiumComponent implements OnInit, OnDestroy {
  app = inject(ApplicationService);
  accountState = inject(AccountStateService);
  premiumApi = inject(PremiumApiService);
  private logger = inject(LoggerService);
  environment = environment;
  private dialog = inject(MatDialog);
  private destroy$ = new Subject<void>();

  // History signals
  subscriptionHistory = signal<SubscriptionHistoryItem[]>([]);
  paymentHistory = signal<PaymentHistoryItem[]>([]);
  isLoadingHistory = signal(false);

  // Computed values
  isExpired = computed(() => {
    const expires = this.accountState.subscription()?.expires;
    return expires ? expires < Date.now() : false;
  });

  expiresIn = computed(() => {
    const expires = this.accountState.subscription()?.expires;
    if (!expires) return null;
    
    const now = Date.now();
    const diff = expires - now;
    
    if (diff <= 0) return 'Expired';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 30) {
      const months = Math.floor(days / 30);
      return `${months} month${months > 1 ? 's' : ''}`;
    }
    return `${days} day${days !== 1 ? 's' : ''}`;
  });

  // Check if subscription is expiring soon (within 30 days)
  isExpiringSoon = computed(() => {
    const expires = this.accountState.subscription()?.expires;
    if (!expires) return false;
    
    const thirtyDaysFromNow = Date.now() + (30 * 24 * 60 * 60 * 1000);
    return expires < thirtyDaysFromNow && expires > Date.now();
  });

  async ngOnInit() {
    // Refresh subscription status when the premium page is opened
    try {
      await this.accountState.refreshSubscription();
      // Load history if user has a subscription
      if (this.accountState.subscription()?.expires) {
        this.loadHistory();
      }
    } catch (error) {
      this.logger.error('Failed to refresh subscription on premium page load:', error);
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadHistory() {
    this.isLoadingHistory.set(true);
    
    // Load both histories in parallel
    this.premiumApi.getSubscriptionHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (history) => this.subscriptionHistory.set(history),
        error: (err) => this.logger.error('Failed to load subscription history:', err)
      });

    this.premiumApi.getPaymentHistory()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (history) => {
          this.paymentHistory.set(history);
          this.isLoadingHistory.set(false);
        },
        error: (err) => {
          this.logger.error('Failed to load payment history:', err);
          this.isLoadingHistory.set(false);
        }
      });
  }

  formatBillingCycle(cycle: string): string {
    switch (cycle) {
      case 'monthly': return '1 Month';
      case 'quarterly': return '3 Months';
      case 'yearly': return '12 Months';
      default: return cycle;
    }
  }

  formatPrice(cents: number, currency?: string): string {
    const currencyCode = currency || 'USD';
    return `$${(cents / 100).toFixed(2)} ${currencyCode}`;
  }

  openSetUsernameDialog(): void {
    const currentUsername = this.accountState.subscription()?.username;

    const dialogRef = this.dialog.open<SetUsernameDialogComponent, SetUsernameDialogData>(
      SetUsernameDialogComponent,
      {
        width: '500px',
        disableClose: false,
        data: { currentUsername },
      }
    );

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Username was set/changed successfully, refresh subscription to show new username
        this.logger.debug('Username operation completed successfully, refreshing subscription');
        this.accountState.refreshSubscription().catch(error => {
          this.logger.error('Failed to refresh subscription after username update:', error);
        });
      }
    });
  }
}
