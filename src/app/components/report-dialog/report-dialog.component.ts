import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Event } from 'nostr-tools';
import { ReportingService, ReportTarget, ReportType } from '../../services/reporting.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { NostrService } from '../../services/nostr.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';
import { PublishService } from '../../services/publish.service';

export interface ReportDialogData {
  target: ReportTarget;
  userDisplayName?: string;
}

interface PublishOption {
  id: 'account' | 'author' | 'custom';
  label: string;
  description: string;
}

interface RelayPublishResult {
  url: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
}

@Component({
  selector: 'app-report-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatListModule,
    MatDividerModule,
    MatSlideToggleModule,
  ],
  templateUrl: './report-dialog.component.html',
  styleUrl: './report-dialog.component.scss',
})
export class ReportDialogComponent {
  private dialogRef = inject(MatDialogRef<ReportDialogComponent>);
  data: ReportDialogData = inject(MAT_DIALOG_DATA);
  private reportingService = inject(ReportingService);
  accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private layout = inject(LayoutService);
  private accountState = inject(AccountStateService);
  private publishService = inject(PublishService);

  selectedReportType = signal<ReportType>('spam');
  reportDescription = signal<string>('');
  selectedOptions = signal<Set<'account' | 'author' | 'custom'>>(new Set(['account']));
  customRelayInput = signal<string>('');
  customRelays = signal<string[]>([]);
  publishResults = signal<RelayPublishResult[]>([]);
  isSubmitting = signal<boolean>(false);
  authorRelays = signal<string[]>([]);
  loadingAuthorRelays = signal<boolean>(false);
  showRelaysView = signal<boolean>(false);
  shouldBlock = signal<boolean>(false);

  reportTypeOptions = this.reportingService.getReportTypeOptions();

  publishOptions: PublishOption[] = [
    {
      id: 'account',
      label: 'Account Relays',
      description: 'Publish to your configured account relays',
    },
    {
      id: 'author',
      label: "Author's Relays",
      description: "Publish to the reported user's relays",
    },
    {
      id: 'custom',
      label: 'Additional Relays',
      description: 'Publish to manually specified relays',
    },
  ];

  constructor() {
    // Load author's relays when component initializes
    effect(async () => {
      if (this.data?.target?.pubkey) {
        this.loadingAuthorRelays.set(true);
        try {
          const relays = await this.discoveryRelay.getUserRelayUrls(this.data.target.pubkey);
          this.authorRelays.set(relays || []);
        } catch (error) {
          console.error('Error loading author relays:', error);
          this.authorRelays.set([]);
        } finally {
          this.loadingAuthorRelays.set(false);
        }
      }
    });
  }

  getTargetDescription(): string {
    if (this.data.target.type === 'user') {
      return this.data.userDisplayName || `User (${this.data.target.pubkey.slice(0, 8)}...)`;
    } else {
      return `Note (${this.data.target.eventId?.slice(0, 8) || 'unknown'}...)`;
    }
  }

  onOptionChange(option: 'account' | 'author' | 'custom', checked: boolean): void {
    this.selectedOptions.update(options => {
      const newOptions = new Set(options);
      if (checked) {
        newOptions.add(option);
      } else {
        newOptions.delete(option);
      }
      return newOptions;
    });
  }

  isOptionSelected(option: 'account' | 'author' | 'custom'): boolean {
    return this.selectedOptions().has(option);
  }

  addCustomRelay(): void {
    const relay = this.customRelayInput().trim();
    if (relay && !this.customRelays().includes(relay)) {
      // Basic URL validation
      try {
        new URL(relay);
        this.customRelays.update(relays => [...relays, relay]);
        this.customRelayInput.set('');
      } catch {
        this.snackBar.open('Please enter a valid relay URL', 'Dismiss', {
          duration: 3000,
        });
      }
    } else if (this.customRelays().includes(relay)) {
      this.snackBar.open('This relay is already in the list', 'Dismiss', {
        duration: 3000,
      });
    }
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relay));
  }

  getTargetRelays(): string[] {
    const selectedOptions = this.selectedOptions();
    const allRelays: string[] = [];

    if (selectedOptions.has('account')) {
      allRelays.push(...this.accountRelay.getRelayUrls());
    }

    if (selectedOptions.has('author')) {
      allRelays.push(...this.authorRelays());
    }

    if (selectedOptions.has('custom')) {
      allRelays.push(...this.customRelays());
    }

    // Remove duplicates
    return [...new Set(allRelays)];
  }

  async submitReport(): Promise<void> {
    const targetRelays = this.getTargetRelays();

    if (targetRelays.length === 0) {
      this.snackBar.open('No relays selected for publishing', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    this.isSubmitting.set(true);

    try {
      // Create the report event
      const reportEvent = this.reportingService.createReportEvent(
        this.data.target,
        this.selectedReportType(),
        this.reportDescription()
      );

      // Sign and publish the report
      const signedEvent = await this.nostrService.signEvent(reportEvent);

      if (!signedEvent) {
        throw new Error('Failed to sign report event');
      }

      // Initialize publish results
      const initialResults: RelayPublishResult[] = targetRelays.map(url => ({
        url,
        status: 'pending',
      }));
      this.publishResults.set(initialResults);

      // Publish to relays
      const publishPromises = await this.accountRelay.publishToRelay(signedEvent, targetRelays);

      if (!publishPromises) {
        console.error('Error during publishing: No promises returned.');
        return;
      }

      // Wait for all publish attempts to complete
      const results = await Promise.allSettled(
        publishPromises.map(async (promise, index) => {
          try {
            await promise;
            this.updatePublishResult(targetRelays[index], 'success', 'Published successfully');
            return { success: true };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.updatePublishResult(targetRelays[index], 'error', errorMessage);
            return { success: false };
          }
        })
      );

      // Check if at least one publish succeeded
      const successCount = results.filter(
        r => r.status === 'fulfilled' && r.value.success
      ).length;

      if (successCount > 0 && this.data.target.eventId) {
        // Notify that a new report was published for this event
        this.reportingService.notifyReportPublished(this.data.target.eventId);
      }

      // Show success message
      this.snackBar.open('Report submitted successfully', 'Dismiss', {
        duration: 3000,
      });

      // Handle blocking if requested
      if (this.shouldBlock()) {
        await this.blockTarget();
      }

      // Close dialog after successful submission
      setTimeout(() => {
        this.dialogRef.close(true);
      }, 2000);
    } catch (error) {
      console.error('Error submitting report:', error);
      this.snackBar.open('Failed to submit report', 'Dismiss', {
        duration: 3000,
      });
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private updatePublishResult(url: string, status: 'success' | 'error', message?: string): void {
    this.publishResults.update(results =>
      results.map(result => (result.url === url ? { ...result, status, message } : result))
    );
  }

  close(): void {
    this.dialogRef.close(false);
  }

  canSubmit(): boolean {
    return (
      !this.isSubmitting() &&
      this.selectedReportType() !== null &&
      this.getTargetRelays().length > 0
    );
  }

  toggleRelaysView(): void {
    this.showRelaysView.update(show => !show);
  }

  async blockTarget(): Promise<void> {
    try {
      if (this.data.target.type === 'user') {
        // Create a fresh mute list event with the user
        const freshMuteList = await this.createFreshMuteListWithUser(this.data.target.pubkey);
        if (freshMuteList) {
          await this.publishService.signAndPublishAuto(
            freshMuteList,
            (event) => this.nostrService.signEvent(event)
          );
        }

        this.snackBar.open('User blocked successfully', 'Dismiss', {
          duration: 3000,
        });
      } else if (this.data.target.eventId) {
        // Create a fresh mute list event with the event
        const freshMuteList = await this.createFreshMuteListWithEvent(this.data.target.eventId);
        if (freshMuteList) {
          await this.publishService.signAndPublishAuto(
            freshMuteList,
            (event) => this.nostrService.signEvent(event)
          );
        }

        this.snackBar.open('Content blocked successfully', 'Dismiss', {
          duration: 3000,
        });
      }
    } catch (error) {
      console.error('Error blocking target:', error);
      this.snackBar.open('Failed to block target', 'Dismiss', {
        duration: 3000,
      });
    }
  }

  private async createFreshMuteListWithUser(pubkey: string): Promise<Event | null> {
    return this.reportingService.createFreshMuteListEvent('user', pubkey);
  }

  private async createFreshMuteListWithEvent(eventId: string): Promise<Event | null> {
    return this.reportingService.createFreshMuteListEvent('event', eventId);
  }
}
