import { Component, OnInit, inject, signal } from '@angular/core';
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
import { MatChipsModule } from '@angular/material/chips';
import { CollectionSetsService, InterestSet } from '../../../services/collection-sets.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { TwoColumnLayoutService } from '../../../services/two-column-layout.service';

@Component({
  selector: 'app-interest-sets',
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
    MatChipsModule,
  ],
  templateUrl: './interest-sets.component.html',
  styleUrl: './interest-sets.component.scss',
})
export class InterestSetsComponent implements OnInit {
  private collectionSetsService = inject(CollectionSetsService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);
  private twoColumnLayout = inject(TwoColumnLayoutService);

  // State
  isLoading = signal(false);
  interestSet = signal<InterestSet | null>(null);

  // Editing state
  isEditing = signal(false);
  editingHashtags = signal('');

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

      const set = await this.collectionSetsService.getInterestSet(pubkey);
      this.interestSet.set(set);
    } catch (error) {
      this.logger.error('Error loading interest set:', error);
      this.snackBar.open('Error loading interests', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  startEditing() {
    const set = this.interestSet();
    if (set) {
      this.editingHashtags.set(set.hashtags.join('\n'));
    } else {
      // Use default hashtags for new users
      this.editingHashtags.set('');
    }
    this.isEditing.set(true);
  }

  cancelEditing() {
    this.isEditing.set(false);
    this.editingHashtags.set('');
  }

  async resetToDefaults() {
    this.isLoading.set(true);
    try {
      const success = await this.collectionSetsService.resetInterestSetToDefaults();

      if (success) {
        this.snackBar.open('Interests reset to defaults', 'Close', { duration: 3000 });
        await this.loadData();
      } else {
        this.snackBar.open('Failed to reset interests', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error resetting interests:', error);
      this.snackBar.open('Error resetting interests', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  async saveEdit() {
    const input = this.editingHashtags().trim();

    if (!input) {
      this.snackBar.open('Please enter at least one hashtag', 'Close', { duration: 3000 });
      return;
    }

    // Parse hashtags - one per line, remove # if present
    const hashtags = input
      .split(/[\n,]+/)
      .map(h => h.trim().replace(/^#/, ''))
      .filter(h => h.length > 0);

    if (hashtags.length === 0) {
      this.snackBar.open('Please enter at least one hashtag', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const success = await this.collectionSetsService.saveInterestSet(hashtags);

      if (success) {
        this.snackBar.open('Interests saved successfully', 'Close', { duration: 3000 });
        this.cancelEditing();
        await this.loadData();
      } else {
        this.snackBar.open('Failed to save interests', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving interests:', error);
      this.snackBar.open('Error saving interests', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  searchHashtag(hashtag: string): void {
    // Open search in the left panel
    this.layout.openSearchInLeftPanel(`#${hashtag}`);
  }
}
