import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { RelayFeedsService, RelaySet } from '../../../services/relay-feeds.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { TwoColumnLayoutService } from '../../../services/two-column-layout.service';

@Component({
  selector: 'app-relay-sets',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  templateUrl: './relay-sets.component.html',
  styleUrl: './relay-sets.component.scss',
})
export class RelaySetsComponent implements OnInit {
  private relayFeedsService = inject(RelayFeedsService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private twoColumnLayout = inject(TwoColumnLayoutService);

  // State
  isLoading = signal(false);
  relaySets = signal<RelaySet[]>([]);
  relayFeeds = computed(() => this.relayFeedsService.relayFeeds());

  // Editing state for relay feeds
  isEditingFeeds = signal(false);
  editingFeedsInput = signal('');

  // Editing state for relay sets
  isEditingSet = signal(false);
  editingSetId = signal<string | null>(null);
  editingSetName = signal('');
  editingSetDescription = signal('');
  editingSetRelays = signal('');

  async ngOnInit() {
    this.twoColumnLayout.setSplitView();
    await this.loadData();
  }

  async loadData() {
    this.isLoading.set(true);
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.error('No authenticated user');
        return;
      }

      // Load relay feeds
      await this.relayFeedsService.getRelayFeeds(pubkey);

      // Load relay sets
      const sets = await this.relayFeedsService.getRelaySets(pubkey);
      this.relaySets.set(sets);
    } catch (error) {
      this.logger.error('Error loading relay data:', error);
      this.snackBar.open('Error loading relay data', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Relay Feeds Management
  startEditingFeeds() {
    const feeds = this.relayFeeds();
    this.editingFeedsInput.set(feeds.join('\n'));
    this.isEditingFeeds.set(true);
  }

  cancelEditingFeeds() {
    this.isEditingFeeds.set(false);
    this.editingFeedsInput.set('');
  }

  async saveFeedsEdit() {
    const input = this.editingFeedsInput();
    const relays = input
      .split('\n')
      .map(r => r.trim())
      .filter(r => r.length > 0);

    if (relays.length === 0) {
      this.snackBar.open('Please add at least one relay', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const success = await this.relayFeedsService.saveRelayFeeds(relays);
      if (success) {
        this.snackBar.open('Relay feeds saved successfully', 'Close', { duration: 3000 });
        this.isEditingFeeds.set(false);
        this.editingFeedsInput.set('');
      } else {
        this.snackBar.open('Failed to save relay feeds', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving relay feeds:', error);
      this.snackBar.open('Error saving relay feeds', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  async resetFeedsToDefaults() {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Reset to Defaults',
        message: 'Are you sure you want to reset relay feeds to defaults? This will replace your current list.',
        confirmText: 'Reset',
        cancelText: 'Cancel',
      },
    });

    const confirmed = await dialogRef.afterClosed().toPromise();
    if (!confirmed) return;

    this.isLoading.set(true);
    try {
      const success = await this.relayFeedsService.resetToDefaults();
      if (success) {
        this.snackBar.open('Relay feeds reset to defaults', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to reset relay feeds', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error resetting relay feeds:', error);
      this.snackBar.open('Error resetting relay feeds', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Relay Set Management
  startCreatingSet() {
    this.editingSetId.set(null);
    this.editingSetName.set('');
    this.editingSetDescription.set('');
    this.editingSetRelays.set('');
    this.isEditingSet.set(true);
  }

  startEditingSet(set: RelaySet) {
    this.editingSetId.set(set.identifier);
    this.editingSetName.set(set.name);
    this.editingSetDescription.set(set.description || '');
    this.editingSetRelays.set(set.relays.join('\n'));
    this.isEditingSet.set(true);
  }

  cancelEditingSet() {
    this.isEditingSet.set(false);
    this.editingSetId.set(null);
    this.editingSetName.set('');
    this.editingSetDescription.set('');
    this.editingSetRelays.set('');
  }

  async saveSetEdit() {
    const name = this.editingSetName().trim();
    const description = this.editingSetDescription().trim();
    const relaysInput = this.editingSetRelays();

    if (!name) {
      this.snackBar.open('Please enter a name', 'Close', { duration: 3000 });
      return;
    }

    const relays = relaysInput
      .split('\n')
      .map(r => r.trim())
      .filter(r => r.length > 0);

    if (relays.length === 0) {
      this.snackBar.open('Please add at least one relay', 'Close', { duration: 3000 });
      return;
    }

    // Generate identifier from name if creating new set
    const identifier = this.editingSetId() || this.generateIdentifier(name);

    this.isLoading.set(true);
    try {
      const success = await this.relayFeedsService.saveRelaySet(
        identifier,
        name,
        relays,
        description || undefined
      );

      if (success) {
        this.snackBar.open('Relay set saved successfully', 'Close', { duration: 3000 });
        this.isEditingSet.set(false);
        this.cancelEditingSet();
        await this.loadData(); // Reload to show updated sets
      } else {
        this.snackBar.open('Failed to save relay set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving relay set:', error);
      this.snackBar.open('Error saving relay set', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteSet(set: RelaySet) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Relay Set',
        message: `Are you sure you want to delete "${set.name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
      },
    });

    const confirmed = await dialogRef.afterClosed().toPromise();
    if (!confirmed) return;

    this.isLoading.set(true);
    try {
      const success = await this.relayFeedsService.deleteRelaySet(set.identifier);
      if (success) {
        this.snackBar.open('Relay set deleted', 'Close', { duration: 3000 });
        await this.loadData(); // Reload to show updated sets
      } else {
        this.snackBar.open('Failed to delete relay set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error deleting relay set:', error);
      this.snackBar.open('Error deleting relay set', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  private generateIdentifier(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
}
