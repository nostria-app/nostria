import { ChangeDetectionStrategy, Component, inject, OnInit, signal, computed } from '@angular/core';
import { Location } from '@angular/common';

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
import { MatRadioModule } from '@angular/material/radio';
import { MatExpansionModule } from '@angular/material/expansion';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { kinds } from 'nostr-tools';

import { DataService } from '../../services/data.service';
import { NostrService } from '../../services/nostr.service';
import { AccountStateService } from '../../services/account-state.service';
import { DatabaseService } from '../../services/database.service';
import { PublishService } from '../../services/publish.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { RelaysService } from '../../services/relays/relays';
import { LoggerService } from '../../services/logger.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';
import { NPubPipe } from '../../pipes/npub.pipe';

interface EventKindInfo {
  kind: number;
  name: string;
  description: string;
  count: number;
}

type DeletionState = 'idle' | 'deleting' | 'completed' | 'vanishing';

/** NIP-62 vanish scope: targeted (user's relays only) or global (ALL_RELAYS) */
type VanishScope = 'targeted' | 'global';
type DeleteAccountSource = 'accounts' | 'privacy';

@Component({
  selector: 'app-delete-account',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressBarModule,
    MatDialogModule,
    MatRadioModule,
    MatExpansionModule,
    NPubPipe,
  ],
  templateUrl: './delete-account.component.html',
  styleUrl: './delete-account.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteAccountComponent implements OnInit {
  private readonly deleteConfirmationPhrase = 'DELETE MY ACCOUNT';
  private readonly vanishConfirmationPhrase = 'REQUEST TO VANISH';

  private readonly fb = inject(FormBuilder);
  private readonly dataService = inject(DataService);
  private readonly nostrService = inject(NostrService);
  private readonly accountStateService = inject(AccountStateService);
  private readonly databaseService = inject(DatabaseService);
  private readonly publishService = inject(PublishService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly relaysService = inject(RelaysService);
  private readonly logger = inject(LoggerService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

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
  deletionState = signal<DeletionState>('idle');

  // NIP-62 vanish signals
  vanishScope = signal<VanishScope>('global');
  vanishReason = signal('');
  vanishRelayCount = signal(0);
  vanishSuccessCount = signal(0);
  vanishFailCount = signal(0);
  vanishSent = signal(false);
  source = signal<DeleteAccountSource | null>(null);

  // Computed values
  totalEventsCount = computed(() =>
    this.eventKinds().reduce((sum, kind) => sum + kind.count, 0)
  );

  hasEvents = computed(() => this.totalEventsCount() > 0);

  currentAccount = computed(() => this.accountStateService.account());

  ngOnInit() {
    const navigation = this.router.getCurrentNavigation();
    const navigationState = (navigation?.extras.state ?? history.state) as { source?: DeleteAccountSource };
    this.source.set(navigationState.source ?? null);

    this.initializeForm();
    this.scanUserEvents();
  }

  private initializeForm() {
    this.deleteForm = this.fb.group({
      confirmationText: ['', [Validators.required, this.confirmationValidator.bind(this)]],
      vanishConfirmationText: ['', [Validators.required, this.vanishConfirmationValidator.bind(this)]],
    });
  }

  private confirmationValidator(control: AbstractControl) {
    return control.value === this.deleteConfirmationPhrase ? null : { invalidConfirmation: true };
  }

  private vanishConfirmationValidator(control: AbstractControl) {
    return control.value === this.vanishConfirmationPhrase ? null : { invalidVanishConfirmation: true };
  }

  isDeleteConfirmationValid(): boolean {
    return this.deleteForm.get('confirmationText')?.valid ?? false;
  }

  isVanishConfirmationValid(): boolean {
    return this.deleteForm.get('vanishConfirmationText')?.valid ?? false;
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

    if (!this.isDeleteConfirmationValid()) {
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
    this.deletionState.set('deleting');
    this.deletionProgress.set(0);
    this.deletedCount.set(0);
    this.failedCount.set(0);

    try {
      // Get all user events again (in case of changes)
      const events = await this.databaseService.getUserEvents(currentAccount.pubkey);
      const totalEvents = events.length;

      if (totalEvents === 0) {
        this.showMessage('No events found to delete');
        this.deletionState.set('idle');
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
            const publishResult = await this.nostrService.signAndPublish(deleteEvent);
            if (publishResult.success) {
              deletedEventIds.push(event.id);
            }
            return publishResult.success;
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

      // Move to completed state
      this.deletionState.set('completed');

    } catch (error) {
      console.error('Error during account deletion:', error);
      this.showMessage('Error occurred during account deletion');
      this.deletionState.set('idle');
    } finally {
      this.deleting.set(false);
    }
  }

  rescanEvents() {
    this.scanUserEvents();
  }

  /**
   * NIP-62: Request to Vanish
   *
   * Creates and publishes a kind 62 event requesting relays to delete all data
   * from this pubkey. Supports two modes:
   * - Targeted: sends to the user's configured relays only, tagging each relay URL
   * - Global: tags `ALL_RELAYS` and broadcasts to as many relays as possible
   */
  async requestToVanish() {
    const currentAccount = this.currentAccount();
    if (!currentAccount) {
      this.showMessage('No active account found');
      return;
    }

    if (!this.isDeleteConfirmationValid()) {
      this.showMessage('Please enter the confirmation text correctly');
      return;
    }

    if (!this.isVanishConfirmationValid()) {
      this.showMessage(`Please type "${this.vanishConfirmationPhrase}" to confirm vanish request`);
      return;
    }

    const scope = this.vanishScope();
    const scopeLabel = scope === 'global' ? 'ALL relays (global)' : 'your configured relays';

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Request to Vanish (NIP-62)',
        message: `This will broadcast a Request to Vanish event to ${scopeLabel}. ` +
          'Compliant relays will permanently delete ALL your events and block re-broadcast. ' +
          'This is irreversible. Are you sure?',
        confirmText: 'Request to Vanish',
        cancelText: 'Cancel',
      } as ConfirmDialogData,
    });

    const confirmed = await dialogRef.afterClosed().toPromise();
    if (!confirmed) {
      return;
    }

    this.deletionState.set('vanishing');
    this.vanishSent.set(false);
    this.vanishSuccessCount.set(0);
    this.vanishFailCount.set(0);

    try {
      const reason = this.vanishReason().trim();

      // Build the relay tag list and determine broadcast targets
      let relayTags: string[];
      let broadcastRelayUrls: string[];

      if (scope === 'global') {
        // Global vanish: tag ALL_RELAYS, broadcast to every relay we know about
        relayTags = ['ALL_RELAYS'];
        broadcastRelayUrls = this.collectAllKnownRelayUrls();
      } else {
        // Targeted vanish: tag each of the user's configured relays, send only to those
        const userRelays = this.accountRelay.getRelayUrls();
        relayTags = userRelays;
        broadcastRelayUrls = userRelays;
      }

      this.vanishRelayCount.set(broadcastRelayUrls.length);

      if (broadcastRelayUrls.length === 0) {
        this.showMessage('No relays found to send the vanish request to');
        this.deletionState.set('idle');
        return;
      }

      // Create the NIP-62 vanish event
      const vanishEvent = this.nostrService.createVanishEvent(relayTags, reason);

      // Sign the event
      const signedEvent = await this.nostrService.signEvent(vanishEvent);

      // Publish to the determined relay set
      const publishResult = await this.publishService.publish(signedEvent, {
        relayUrls: broadcastRelayUrls,
        timeout: 30000,
      });

      // Count successes and failures
      let successes = 0;
      let failures = 0;
      for (const [, relayResult] of publishResult.relayResults) {
        if (relayResult.success) {
          successes++;
        } else {
          failures++;
        }
      }

      this.vanishSuccessCount.set(successes);
      this.vanishFailCount.set(failures);
      this.vanishSent.set(true);

      if (publishResult.success) {
        this.logger.info(`[DeleteAccount] NIP-62 vanish request sent to ${successes}/${broadcastRelayUrls.length} relays`);
        this.showMessage(`Vanish request sent to ${successes} relay(s)`);
      } else {
        this.logger.warn('[DeleteAccount] NIP-62 vanish request failed on all relays');
        this.showMessage('Vanish request failed to reach any relays');
      }

      // Clear local data after vanish
      try {
        await this.databaseService.clearAllData();
        this.eventKinds.set([]);
      } catch (error) {
        this.logger.warn('[DeleteAccount] Failed to clear local data after vanish', error);
      }

      this.deletionState.set('completed');
    } catch (error) {
      console.error('Error during vanish request:', error);
      this.showMessage('Error sending vanish request');
      this.deletionState.set('idle');
    }
  }

  /**
   * Collect all relay URLs we know about: the user's relays + all relays with stats.
   * Used for global vanish to maximize broadcast reach.
   */
  private collectAllKnownRelayUrls(): string[] {
    const allUrls = new Set<string>();

    // User's own configured relays
    for (const url of this.accountRelay.getRelayUrls()) {
      allUrls.add(url);
    }

    // All relays we've seen (from relay stats tracking)
    for (const [url] of this.relaysService.getAllRelayStats()) {
      allUrls.add(url);
    }

    return Array.from(allUrls);
  }

  async signOut() {
    await this.nostrService.logout();
    this.router.navigate(['/']);
  }

  resetState() {
    this.deletionState.set('idle');
    this.deletionProgress.set(0);
    this.deletedCount.set(0);
    this.failedCount.set(0);
    // Reset NIP-62 vanish signals
    this.vanishSent.set(false);
    this.vanishSuccessCount.set(0);
    this.vanishFailCount.set(0);
    this.vanishRelayCount.set(0);
    this.vanishReason.set('');
    this.vanishScope.set('global');
    this.deleteForm.reset();
    this.scanUserEvents();
  }

  navigateBack() {
    if (this.source() === 'accounts') {
      this.router.navigate(['/accounts']);
      return;
    }

    if (this.source() === 'privacy') {
      this.router.navigate(['/settings/privacy']);
      return;
    }

    this.location.back();
  }

  private showMessage(message: string) {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}
