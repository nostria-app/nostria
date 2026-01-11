import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
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
import { CollectionSetsService, EmojiSet, EmojiItem } from '../../../services/collection-sets.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-emoji-sets',
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
  templateUrl: './emoji-sets.component.html',
  styleUrl: './emoji-sets.component.scss',
})
export class EmojiSetsComponent implements OnInit {
  private collectionSetsService = inject(CollectionSetsService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  // State
  isLoading = signal(false);
  emojiSets = signal<EmojiSet[]>([]);
  preferredEmojis = signal<EmojiItem[]>([]);
  copiedEmoji: string | null = null;

  // Editing state
  isEditingSet = signal(false);
  editingSetId = signal<string | null>(null);
  editingSetName = signal('');
  editingSetEmojis = signal('');

  async ngOnInit() {
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

      // Load emoji sets (kind 30030)
      const sets = await this.collectionSetsService.getEmojiSets(pubkey);
      this.logger.info('Loaded emoji sets:', sets);
      this.emojiSets.set(sets);

      // Load preferred emojis (kind 10030)
      const preferred = await this.collectionSetsService.getPreferredEmojis(pubkey);
      this.logger.info('Loaded preferred emojis:', preferred);
      this.preferredEmojis.set(preferred);
    } catch (error) {
      this.logger.error('Error loading emoji data:', error);
      this.snackBar.open('Error loading emoji data', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  startCreatingSet() {
    this.editingSetId.set(null);
    this.editingSetName.set('');
    this.editingSetEmojis.set('');
    this.isEditingSet.set(true);
  }

  startEditingSet(set: EmojiSet) {
    this.editingSetId.set(set.identifier);
    this.editingSetName.set(set.name);
    this.editingSetEmojis.set(set.emojis.join('\n'));
    this.isEditingSet.set(true);
  }

  cancelEditingSet() {
    this.isEditingSet.set(false);
    this.editingSetId.set(null);
    this.editingSetName.set('');
    this.editingSetEmojis.set('');
  }

  async saveSetEdit() {
    const name = this.editingSetName().trim();
    const emojisInput = this.editingSetEmojis().trim();

    if (!name) {
      this.snackBar.open('Please enter a set name', 'Close', { duration: 3000 });
      return;
    }

    if (!emojisInput) {
      this.snackBar.open('Please enter at least one emoji', 'Close', { duration: 3000 });
      return;
    }

    // Parse emojis - one per line or space-separated
    const emojis = emojisInput
      .split(/[\n\s]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (emojis.length === 0) {
      this.snackBar.open('Please enter at least one emoji', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const identifier = this.editingSetId() || Date.now().toString();
      const success = await this.collectionSetsService.saveEmojiSet(identifier, name, emojis);

      if (success) {
        this.snackBar.open('Emoji set saved successfully', 'Close', { duration: 3000 });
        this.cancelEditingSet();
        await this.loadData();
      } else {
        this.snackBar.open('Failed to save emoji set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving emoji set:', error);
      this.snackBar.open('Error saving emoji set', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteSet(set: EmojiSet) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Emoji Set',
        message: `Are you sure you want to delete "${set.name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (!result) return;

    this.isLoading.set(true);
    try {
      const success = await this.collectionSetsService.deleteEmojiSet(set.identifier);

      if (success) {
        this.snackBar.open('Emoji set deleted', 'Close', { duration: 3000 });
        await this.loadData();
      } else {
        this.snackBar.open('Failed to delete emoji set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error deleting emoji set:', error);
      this.snackBar.open('Error deleting emoji set', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  findEmojis(): void {
    this.router.navigate(['/search'], {
      queryParams: { q: 'kind:30030' }
    });
  }

  async copyEmoji(emoji: EmojiItem, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(`:${emoji.shortcode}:`);
      this.copiedEmoji = emoji.shortcode;

      setTimeout(() => {
        this.copiedEmoji = null;
      }, 2000);
    } catch (err) {
      this.logger.error('Failed to copy emoji:', err);
    }
  }
}
