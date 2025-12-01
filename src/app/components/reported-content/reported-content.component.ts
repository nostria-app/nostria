import { Component, input, inject, signal, effect, untracked } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { Event } from 'nostr-tools';
import { ReportingService } from '../../services/reporting.service';
import { EventService, ReportEvents } from '../../services/event';
import { ReportsDialogComponent } from '../reports-dialog/reports-dialog.component';

@Component({
  selector: 'app-reported-content',
  imports: [MatButtonModule, MatIconModule, MatCardModule, MatChipsModule],
  templateUrl: './reported-content.component.html',
  styleUrl: './reported-content.component.scss',
})
export class ReportedContentComponent {
  event = input.required<Event>();
  private reportingService = inject(ReportingService);
  private eventService = inject(EventService);
  private dialog = inject(MatDialog);

  reports = signal<ReportEvents>({ events: [], data: new Map() });
  isLoadingReports = signal(false);

  constructor() {
    // Load reports when component initializes
    effect(() => {
      const currentEvent = this.event();
      if (currentEvent) {
        untracked(() => {
          this.loadReports(currentEvent);
        });
      }
    });

    // Effect to reload reports when a new report is published for this event
    effect(() => {
      const reportNotification = this.reportingService.getReportPublishedSignal()();
      const currentEvent = this.event();

      if (reportNotification && currentEvent && reportNotification.eventId === currentEvent.id) {
        untracked(async () => {
          console.log('🚨 [Report Notification] New report detected for reported content:', currentEvent.id.substring(0, 8));
          // Reload reports to get the fresh data
          await this.loadReports(currentEvent);
        });
      }
    });
  }

  private async loadReports(event: Event): Promise<void> {
    try {
      this.isLoadingReports.set(true);
      const reportData = await this.eventService.loadReports(event.id, event.pubkey);
      this.reports.set(reportData);
    } catch (error) {
      console.error('Error loading reports for event:', event.id, error);
    } finally {
      this.isLoadingReports.set(false);
    }
  }

  showContent(): void {
    this.reportingService.toggleContentOverride(this.event().id);
  }

  isContentVisible(): boolean {
    return this.reportingService.isContentOverrideActive(this.event().id);
  }

  showReportsDialog(): void {
    this.dialog.open(ReportsDialogComponent, {
      data: {
        eventId: this.event().id,
        eventPubkey: this.event().pubkey,
      },
      width: '600px',
      maxWidth: '90vw',
    });
  }

  getTopReportTypes(): { type: string; count: number }[] {
    const reportData = this.reports().data;
    return Array.from(reportData.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3); // Show top 3 report types
  }

  getTotalReports(): number {
    return this.reports().events.length;
  }

  getReportTypeLabel(reportType: string): string {
    const labels: Record<string, string> = {
      nudity: 'Nudity',
      malware: 'Malware',
      profanity: 'Hateful Speech',
      illegal: 'Illegal Content',
      spam: 'Spam',
      impersonation: 'Impersonation',
      other: 'Other',
    };
    return labels[reportType] || reportType;
  }

  getReportTypeIcon(reportType: string): string {
    const icons: Record<string, string> = {
      nudity: 'explicit',
      malware: 'security',
      profanity: 'sentiment_very_dissatisfied',
      illegal: 'gavel',
      spam: 'report',
      impersonation: 'person_off',
      other: 'flag',
    };
    return icons[reportType] || 'flag';
  }
}
