import { Injectable, inject, signal, computed, effect, untracked } from '@angular/core';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';

export interface ZapMetrics {
  totalSent: number;
  totalReceived: number;
  successRate: number;
  averagePaymentTime: number;
  totalVolumeSent: number; // in sats
  totalVolumeReceived: number; // in sats
  errorCounts: Record<string, number>;
  fastestPayment: number;
  slowestPayment: number;
  dailyStats: DailyZapStats[];
}

export interface DailyZapStats {
  date: string;
  sent: number;
  received: number;
  volumeSent: number;
  volumeReceived: number;
  successRate: number;
}

export interface ZapPerformanceEvent {
  timestamp: number;
  type: 'sent' | 'received' | 'failed';
  amount: number;
  paymentTime?: number; // in milliseconds
  errorCode?: string;
  recipientPubkey?: string;
  eventId?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ZapMetricsService {
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);

  // Performance data storage
  private performanceEvents = signal<ZapPerformanceEvent[]>([]);
  private readonly MAX_EVENTS = 1000; // Keep last 1000 events
  private readonly STORAGE_KEY = 'zap_performance_metrics';

  // Computed metrics
  metrics = computed<ZapMetrics>(() => {
    const events = this.performanceEvents();
    return this.calculateMetrics(events);
  });

  // Recent performance (last 24 hours)
  recentMetrics = computed<ZapMetrics>(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentEvents = this.performanceEvents().filter(event => event.timestamp > oneDayAgo);
    return this.calculateMetrics(recentEvents);
  });

  // Daily stats for the last 30 days
  dailyStats = computed<DailyZapStats[]>(() => {
    const events = this.performanceEvents();
    return this.calculateLast30DaysStats(events);
  });

  constructor() {
    // Load metrics when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      untracked(() => {
        if (pubkey) {
          this.loadFromStorage();
        } else {
          this.performanceEvents.set([]);
        }
      });
    });
  }

  /**
   * Record a successful zap sent
   */
  recordZapSent(
    amount: number,
    paymentTime: number,
    recipientPubkey?: string,
    eventId?: string
  ): void {
    const event: ZapPerformanceEvent = {
      timestamp: Date.now(),
      type: 'sent',
      amount,
      paymentTime,
      recipientPubkey,
      eventId,
    };

    this.addEvent(event);
    this.logger.debug('Recorded zap sent metric', { amount, paymentTime });
  }

  /**
   * Record a zap received
   */
  recordZapReceived(amount: number, senderPubkey?: string, eventId?: string): void {
    const event: ZapPerformanceEvent = {
      timestamp: Date.now(),
      type: 'received',
      amount,
      recipientPubkey: senderPubkey,
      eventId,
    };

    this.addEvent(event);
    this.logger.debug('Recorded zap received metric', { amount });
  }

  /**
   * Record a failed zap
   */
  recordZapFailed(amount: number, errorCode: string, recipientPubkey?: string): void {
    const event: ZapPerformanceEvent = {
      timestamp: Date.now(),
      type: 'failed',
      amount,
      errorCode,
      recipientPubkey,
    };

    this.addEvent(event);
    this.logger.debug('Recorded zap failed metric', { amount, errorCode });
  }

  /**
   * Get performance summary for display
   */
  getPerformanceSummary(): {
    todayStats: DailyZapStats;
    weekStats: ZapMetrics;
    allTimeStats: ZapMetrics;
  } {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;

    const todayEvents = this.performanceEvents().filter(event => event.timestamp >= todayStart);
    const weekEvents = this.performanceEvents().filter(event => event.timestamp >= weekStart);

    return {
      todayStats: this.calculateSingleDayStats(todayEvents, new Date().toISOString().split('T')[0]),
      weekStats: this.calculateMetrics(weekEvents),
      allTimeStats: this.metrics(),
    };
  }

  /**
   * Clear all metrics data
   */
  clearMetrics(): void {
    this.performanceEvents.set([]);
    this.saveToStorage();
    this.logger.info('Zap metrics cleared');
  }

  /**
   * Export metrics data for backup
   */
  exportMetrics(): string {
    return JSON.stringify({
      events: this.performanceEvents(),
      exportedAt: new Date().toISOString(),
    });
  }

  /**
   * Import metrics data from backup
   */
  importMetrics(data: string): boolean {
    try {
      const parsed = JSON.parse(data);
      if (parsed.events && Array.isArray(parsed.events)) {
        this.performanceEvents.set(parsed.events);
        this.saveToStorage();
        this.logger.info('Zap metrics imported successfully');
        return true;
      }
    } catch (error) {
      this.logger.error('Failed to import metrics:', error);
    }
    return false;
  }

  /**
   * Add a new performance event
   */
  private addEvent(event: ZapPerformanceEvent): void {
    const currentEvents = this.performanceEvents();

    // Add new event and trim if necessary
    const updatedEvents = [...currentEvents, event];
    if (updatedEvents.length > this.MAX_EVENTS) {
      updatedEvents.splice(0, updatedEvents.length - this.MAX_EVENTS);
    }

    this.performanceEvents.set(updatedEvents);
    this.saveToStorage();
  }

  /**
   * Calculate comprehensive metrics from events
   */
  private calculateMetrics(events: ZapPerformanceEvent[]): ZapMetrics {
    const sentEvents = events.filter(e => e.type === 'sent');
    const receivedEvents = events.filter(e => e.type === 'received');
    const failedEvents = events.filter(e => e.type === 'failed');

    const totalSent = sentEvents.length;
    const totalReceived = receivedEvents.length;
    const totalFailed = failedEvents.length;
    const totalAttempts = totalSent + totalFailed;

    const successRate = totalAttempts > 0 ? (totalSent / totalAttempts) * 100 : 0;

    const paymentTimes = sentEvents
      .map(e => e.paymentTime)
      .filter((time): time is number => time !== undefined);

    const averagePaymentTime =
      paymentTimes.length > 0
        ? paymentTimes.reduce((sum, time) => sum + time, 0) / paymentTimes.length
        : 0;

    const fastestPayment = paymentTimes.length > 0 ? Math.min(...paymentTimes) : 0;
    const slowestPayment = paymentTimes.length > 0 ? Math.max(...paymentTimes) : 0;

    const totalVolumeSent = sentEvents.reduce((sum, e) => sum + e.amount, 0);
    const totalVolumeReceived = receivedEvents.reduce((sum, e) => sum + e.amount, 0);

    // Count errors by type
    const errorCounts: Record<string, number> = {};
    failedEvents.forEach(event => {
      if (event.errorCode) {
        errorCounts[event.errorCode] = (errorCounts[event.errorCode] || 0) + 1;
      }
    });

    // Calculate daily stats for the last 30 days
    const dailyStats = this.calculateLast30DaysStats(events);

    return {
      totalSent,
      totalReceived,
      successRate,
      averagePaymentTime,
      totalVolumeSent,
      totalVolumeReceived,
      errorCounts,
      fastestPayment,
      slowestPayment,
      dailyStats,
    };
  }

  /**
   * Calculate daily stats for a specific date
   */
  private calculateSingleDayStats(events: ZapPerformanceEvent[], date: string): DailyZapStats {
    const dayStart = new Date(date).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const dayEvents = events.filter(
      event => event.timestamp >= dayStart && event.timestamp < dayEnd
    );

    const sent = dayEvents.filter(e => e.type === 'sent').length;
    const received = dayEvents.filter(e => e.type === 'received').length;
    const failed = dayEvents.filter(e => e.type === 'failed').length;
    const totalAttempts = sent + failed;

    return {
      date,
      sent,
      received,
      volumeSent: dayEvents.filter(e => e.type === 'sent').reduce((sum, e) => sum + e.amount, 0),
      volumeReceived: dayEvents
        .filter(e => e.type === 'received')
        .reduce((sum, e) => sum + e.amount, 0),
      successRate: totalAttempts > 0 ? (sent / totalAttempts) * 100 : 0,
    };
  }

  /**
   * Calculate daily stats for the last 30 days
   */
  private calculateLast30DaysStats(events: ZapPerformanceEvent[]): DailyZapStats[] {
    // Group events by day for the last 30 days
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split('T')[0];
    });

    return last30Days.map(date => this.calculateSingleDayStats(events, date));
  }

  /**
   * Save metrics to localStorage (pubkey-keyed)
   */
  private saveToStorage(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    try {
      // Load existing data for all accounts
      const stored = localStorage.getItem(this.STORAGE_KEY);
      let allData: Record<string, { events: ZapPerformanceEvent[]; lastUpdated: number }> = {};

      if (stored) {
        const parsed = JSON.parse(stored);
        // Check if it's already pubkey-keyed format
        if (!parsed.events) {
          allData = parsed;
        }
      }

      // Update current account's data
      allData[pubkey] = {
        events: this.performanceEvents(),
        lastUpdated: Date.now(),
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(allData));
    } catch (error) {
      this.logger.warn('Failed to save metrics to storage:', error);
    }
  }

  /**
   * Load metrics from localStorage (pubkey-keyed with migration)
   */
  private loadFromStorage(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.performanceEvents.set([]);
      return;
    }

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);

        // Check if this is old format (has 'events' at root level)
        if (data.events && Array.isArray(data.events)) {
          // Migrate: assign all existing events to current user
          this.logger.info('Migrating zap metrics to pubkey-keyed format');
          this.performanceEvents.set(data.events);
          // Save in new format
          this.saveToStorage();
          return;
        }

        // New pubkey-keyed format
        const accountData = data[pubkey];
        if (accountData?.events && Array.isArray(accountData.events)) {
          this.performanceEvents.set(accountData.events);
          this.logger.info('Zap metrics loaded from storage');
        } else {
          this.performanceEvents.set([]);
        }
      } else {
        this.performanceEvents.set([]);
      }
    } catch (error) {
      this.logger.warn('Failed to load metrics from storage:', error);
      this.performanceEvents.set([]);
    }
  }
}
