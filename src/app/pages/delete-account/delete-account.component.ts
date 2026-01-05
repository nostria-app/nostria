import { Component, inject, OnInit, signal, computed } from '@angular/core';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { kinds } from 'nostr-tools';

import { DataService } from '../../services/data.service';
import { NostrService } from '../../services/nostr.service';
import { AccountStateService } from '../../services/account-state.service';
import { DatabaseService } from '../../services/database.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';

interface EventKindInfo {
  kind: number;
  name: string;
  description: string;
  count: number;
}

@Component({
  selector: 'app-delete-account',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressBarModule,
    MatDialogModule
],
  templateUrl: './delete-account.component.html',
  styleUrl: './delete-account.component.scss',
})
export class DeleteAccountComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly dataService = inject(DataService);
  private readonly nostrService = inject(NostrService);
  private readonly accountStateService = inject(AccountStateService);
  private readonly databaseService = inject(DatabaseService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  // Form
  deleteForm!: FormGroup;

  // Signals
  loading = signal(false);
  scanning = signal(false);
  deleting = signal(false);
  eventKinds = signal<EventKindInfo[]>([]);
  deletionProgress = signal(0);
  deletedCount = signal(0);
  failedCount = signal(0);

  // Computed values
  totalEventsCount = computed(() =>
    this.eventKinds().reduce((sum, kind) => sum + kind.count, 0)
  );

  hasEvents = computed(() => this.totalEventsCount() > 0);

  currentAccount = computed(() => this.accountStateService.account());

  ngOnInit() {
    this.initializeForm();
    this.scanUserEvents();
  }

  private initializeForm() {
    this.deleteForm = this.fb.group({
      confirmationText: ['', [Validators.required, this.confirmationValidator.bind(this)]],
    });
  }

  private confirmationValidator(control: AbstractControl) {
    const expectedText = 'DELETE MY ACCOUNT';
    return control.value === expectedText ? null : { invalidConfirmation: true };
  }

  private async scanUserEvents() {
    const currentAccount = this.currentAccount();
    if (!currentAccount) {
      this.showMessage('No active account found');
      return;
    }

    this.scanning.set(true);

    try {
      // Get all user events from storage
      const events = await this.databaseService.getUserEvents(currentAccount.pubkey);

      // Group events by kind and count them
      const kindCounts = new Map<number, number>();

      for (const event of events) {
        const count = kindCounts.get(event.kind) || 0;
        kindCounts.set(event.kind, count + 1);
      }

      // Convert to EventKindInfo array with descriptions
      const eventKinds: EventKindInfo[] = [];
      for (const [kind, count] of kindCounts.entries()) {
        eventKinds.push({
          kind,
          name: this.getKindName(kind),
          description: this.getKindDescription(kind),
          count,
        });
      }

      // Sort by kind number
      eventKinds.sort((a, b) => a.kind - b.kind);
      this.eventKinds.set(eventKinds);

    } catch (error) {
      console.error('Error scanning user events:', error);
      this.showMessage('Error scanning account events');
    } finally {
      this.scanning.set(false);
    }
  }

  private getKindName(kind: number): string {
    const kindNames: Record<number, string> = {
      [kinds.Metadata]: 'Profile Metadata',
      [kinds.ShortTextNote]: 'Text Notes',
      [kinds.RecommendRelay]: 'Recommend Relay',
      [kinds.Contacts]: 'Contact List',
      [kinds.EncryptedDirectMessage]: 'Direct Messages',
      [kinds.EventDeletion]: 'Event Deletions',
      [kinds.Repost]: 'Reposts',
      [kinds.Reaction]: 'Reactions',
      [kinds.BadgeAward]: 'Badge Awards',
      [kinds.Reporting]: 'Reports',
      [kinds.ZapRequest]: 'Zap Requests',
      [kinds.Zap]: 'Zaps',
      [kinds.RelayList]: 'Relay List',
      [kinds.Mutelist]: 'Mute List',
      [kinds.Pinlist]: 'Pin List',
      30000: 'People Lists',
      30001: 'Bookmark Lists',
      [kinds.LongFormArticle]: 'Long-form Articles',
    };

    return kindNames[kind] || `Event Kind ${kind}`;
  }

  private getKindDescription(kind: number): string {
    const descriptions: Record<number, string> = {
      [kinds.Metadata]: 'Your profile information (name, bio, avatar)',
      [kinds.ShortTextNote]: 'Your posts and notes',
      [kinds.RecommendRelay]: 'Relay recommendations you\'ve made',
      [kinds.Contacts]: 'Your following list',
      [kinds.EncryptedDirectMessage]: 'Private messages',
      [kinds.EventDeletion]: 'Previous deletion requests',
      [kinds.Repost]: 'Posts you\'ve shared',
      [kinds.Reaction]: 'Your likes and reactions',
      [kinds.BadgeAward]: 'Badges you\'ve awarded',
      [kinds.Reporting]: 'Content reports you\'ve made',
      [kinds.ZapRequest]: 'Lightning payment requests',
      [kinds.Zap]: 'Lightning payments sent/received',
      [kinds.RelayList]: 'Your relay configuration',
      [kinds.Mutelist]: 'Users and content you\'ve muted',
      [kinds.Pinlist]: 'Content you\'ve pinned',
      30000: 'Organized lists of people',
      30001: 'Organized bookmarks',
      [kinds.LongFormArticle]: 'Blog posts and articles',
    };

    return descriptions[kind] || 'Events of this type';
  }

  async deleteAllEvents() {
    const currentAccount = this.currentAccount();
    if (!currentAccount) {
      this.showMessage('No active account found');
      return;
    }

    if (!this.deleteForm.valid) {
      this.showMessage('Please enter the confirmation text correctly');
      return;
    }

    // Show final confirmation dialog
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Delete All Account Data',
        message: `This will attempt to delete ALL ${this.totalEventsCount()} events from your account. This action cannot be undone. Are you sure you want to proceed?`,
        confirmText: 'Delete Everything',
        cancelText: 'Cancel',
      } as ConfirmDialogData,
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (!result) {
      return;
    }

    this.deleting.set(true);
    this.deletionProgress.set(0);
    this.deletedCount.set(0);
    this.failedCount.set(0);

    try {
      // Get all user events again (in case of changes)
      const events = await this.databaseService.getUserEvents(currentAccount.pubkey);
      const totalEvents = events.length;

      if (totalEvents === 0) {
        this.showMessage('No events found to delete');
        return;
      }

      let processed = 0;
      let deleted = 0;
      let failed = 0;

      // Process events in batches to avoid overwhelming the system
      const batchSize = 10;
      const deletedEventIds: string[] = [];
      
      for (let i = 0; i < events.length; i += batchSize) {
        const batch = events.slice(i, i + batchSize);

        const batchPromises = batch.map(async (event) => {
          try {
            // Create deletion event (NIP-09)
            const deleteEvent = this.nostrService.createRetractionEvent(event);
            const result = await this.nostrService.signAndPublish(deleteEvent);
            if (result.success) {
              deletedEventIds.push(event.id);
            }
            return result.success;
          } catch (error) {
            console.error(`Failed to delete event ${event.id}:`, error);
            return false;
          }
        });

        const results = await Promise.all(batchPromises);

        for (const success of results) {
          if (success) {
            deleted++;
          } else {
            failed++;
          }
          processed++;

          // Update progress
          this.deletionProgress.set((processed / totalEvents) * 100);
          this.deletedCount.set(deleted);
          this.failedCount.set(failed);
        }

        // Small delay between batches
        if (i + batchSize < events.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Delete all successfully deleted events from local database
      if (deletedEventIds.length > 0) {
        try {
          await this.databaseService.deleteEvents(deletedEventIds);
        } catch (error) {
          console.error('Error deleting events from local database:', error);
        }
      }

      // Show completion message
      if (failed === 0) {
        this.showMessage(`Successfully deleted all ${deleted} events`);
      } else {
        this.showMessage(`Deleted ${deleted} events, ${failed} failed`);
      }

      // Rescan to update counts
      await this.scanUserEvents();

    } catch (error) {
      console.error('Error during account deletion:', error);
      this.showMessage('Error occurred during account deletion');
    } finally {
      this.deleting.set(false);
    }
  }

  rescanEvents() {
    this.scanUserEvents();
  }

  navigateBack() {
    this.router.navigate(['/settings/privacy']);
  }

  private showMessage(message: string) {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}
