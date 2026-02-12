import { ChangeDetectionStrategy, Component, inject, signal, effect, untracked } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { EventService, ReportEvents } from '../../services/event';
import { AgoPipe } from '../../pipes/ago.pipe';
import { UserProfileComponent } from '../user-profile/user-profile.component';

export interface ReportsDialogData {
  eventId: string;
  eventPubkey: string;
}

@Component({
  selector: 'app-reports-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    AgoPipe,
    UserProfileComponent,
  ],
  templateUrl: './reports-dialog.component.html',
  styleUrl: './reports-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsDialogComponent {
  private dialogRef = inject(MatDialogRef<ReportsDialogComponent>);
  private data = inject<ReportsDialogData>(MAT_DIALOG_DATA);
  private eventService = inject(EventService);

  reports = signal<ReportEvents>({ events: [], data: new Map() });
  isLoading = signal(true);
  error = signal<string | null>(null);

  constructor() {
    effect(() => {
      untracked(async () => {
        await this.loadReports();
      });
    });
  }

  private async loadReports(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const reportData = await this.eventService.loadReports(
        this.data.eventId,
        this.data.eventPubkey
      );

      this.reports.set(reportData);
    } catch (error) {
      console.error('Error loading reports:', error);
      this.error.set('Failed to load reports');
    } finally {
      this.isLoading.set(false);
    }
  }

  getReportTypeLabel(reportType: string): string {
    const labels: Record<string, string> = {
      nudity: 'Nudity/Adult Content',
      malware: 'Malware/Security Threat',
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

  getTotalReports(): number {
    return this.reports().events.length;
  }

  getUniqueReportTypes(): { type: string; count: number }[] {
    const reportData = this.reports().data;
    return Array.from(reportData.entries()).map(([type, count]) => ({
      type,
      count,
    }));
  }

  close(): void {
    this.dialogRef.close();
  }
}
