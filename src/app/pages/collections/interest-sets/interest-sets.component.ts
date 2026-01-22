import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
import { MatMenuModule } from '@angular/material/menu';
import { CollectionSetsService, InterestSet } from '../../../services/collection-sets.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { TwoColumnLayoutService } from '../../../services/two-column-layout.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog.component';

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
    MatMenuModule,
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
  private router = inject(Router);

  // State - multiple interest sets
  isLoading = signal(false);
  interestSets = signal<InterestSet[]>([]);

  // Editing state for existing lists
  editingListId = signal<string | null>(null);
  editingHashtags = signal('');
  editingTitle = signal('');

  // Creating new list state
  isCreatingNew = signal(false);
  newListTitle = signal('');
  newListHashtags = signal('');

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

      const sets = await this.collectionSetsService.getInterestSets(pubkey);
      this.interestSets.set(sets);
    } catch (error) {
      this.logger.error('Error loading interest sets:', error);
      this.snackBar.open('Error loading interests', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Start creating a new interest list
  startCreatingNew() {
    this.isCreatingNew.set(true);
    this.newListTitle.set('');
    this.newListHashtags.set('');
  }

  // Cancel creating new list
  cancelCreatingNew() {
    this.isCreatingNew.set(false);
    this.newListTitle.set('');
    this.newListHashtags.set('');
  }

  // Save new interest list
  async saveNewList() {
    const title = this.newListTitle().trim();
    const input = this.newListHashtags().trim();

    if (!title) {
      this.snackBar.open('Please enter a title for the list', 'Close', { duration: 3000 });
      return;
    }

    if (!input) {
      this.snackBar.open('Please enter at least one hashtag', 'Close', { duration: 3000 });
      return;
    }

    // Parse hashtags - one per line or comma-separated, remove # if present
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
      const newSet = await this.collectionSetsService.createInterestSet(title, hashtags);

      if (newSet) {
        this.snackBar.open('Interest list created', 'Close', { duration: 3000 });
        this.cancelCreatingNew();
        await this.loadData();
      } else {
        this.snackBar.open('Failed to create interest list', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error creating interest list:', error);
      this.snackBar.open('Error creating interest list', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Start editing an existing list
  startEditing(set: InterestSet) {
    this.editingListId.set(set.identifier);
    this.editingTitle.set(set.title);
    this.editingHashtags.set(set.hashtags.join('\n'));
  }

  // Cancel editing
  cancelEditing() {
    this.editingListId.set(null);
    this.editingTitle.set('');
    this.editingHashtags.set('');
  }

  // Save edited list
  async saveEdit() {
    const identifier = this.editingListId();
    if (!identifier) return;

    const title = this.editingTitle().trim();
    const input = this.editingHashtags().trim();

    if (!input) {
      this.snackBar.open('Please enter at least one hashtag', 'Close', { duration: 3000 });
      return;
    }

    // Parse hashtags - one per line or comma-separated
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
      const success = await this.collectionSetsService.saveInterestSet(hashtags, identifier, title || undefined);

      if (success) {
        this.snackBar.open('Interest list saved', 'Close', { duration: 3000 });
        this.cancelEditing();
        await this.loadData();
      } else {
        this.snackBar.open('Failed to save interest list', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving interest list:', error);
      this.snackBar.open('Error saving interest list', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete an interest list
  async deleteList(set: InterestSet) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Interest List',
        message: `Are you sure you want to delete "${set.title}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        this.isLoading.set(true);
        try {
          const success = await this.collectionSetsService.deleteInterestSet(set.identifier);

          if (success) {
            this.snackBar.open('Interest list deleted', 'Close', { duration: 3000 });
            await this.loadData();
          } else {
            this.snackBar.open('Failed to delete interest list', 'Close', { duration: 3000 });
          }
        } catch (error) {
          this.logger.error('Error deleting interest list:', error);
          this.snackBar.open('Error deleting interest list', 'Close', { duration: 3000 });
        } finally {
          this.isLoading.set(false);
        }
      }
    });
  }

  // Open a single hashtag as a dynamic feed
  openHashtagFeed(hashtag: string): void {
    // Navigate to feeds page with hashtag query param
    this.router.navigate(['/f'], {
      queryParams: { t: hashtag },
    });
  }

  // Open all hashtags from a list as a dynamic feed
  openListFeed(set: InterestSet): void {
    if (set.hashtags.length === 0) return;

    // Navigate to feeds page with all hashtags as comma-separated query param
    this.router.navigate(['/f'], {
      queryParams: { t: set.hashtags.join(',') },
    });
  }

  // Reset the default "interests" list to defaults
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
}
