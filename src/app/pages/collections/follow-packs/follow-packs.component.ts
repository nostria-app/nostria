import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { nip19 } from 'nostr-tools';
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
import { MatMenuModule } from '@angular/material/menu';
import { FollowPacksService, FollowPack } from '../../../services/follow-packs.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { TwoColumnLayoutService } from '../../../services/two-column-layout.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog.component';
import { ProfileDisplayNameComponent } from '../../../components/user-profile/display-name/profile-display-name.component';

@Component({
  selector: 'app-follow-packs',
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
    MatMenuModule,
    ProfileDisplayNameComponent,
  ],
  templateUrl: './follow-packs.component.html',
  styleUrl: './follow-packs.component.scss',
})
export class FollowPacksComponent implements OnInit {
  private followPacksService = inject(FollowPacksService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private layout = inject(LayoutService);
  private twoColumnLayout = inject(TwoColumnLayoutService);

  // State
  isLoading = signal(false);
  followPacks = signal<FollowPack[]>([]);

  // Editing state for existing packs
  editingPackId = signal<string | null>(null);
  editingTitle = signal('');
  editingDescription = signal('');
  editingImage = signal('');
  editingPubkeys = signal('');

  // Creating new pack state
  isCreatingNew = signal(false);
  newPackTitle = signal('');
  newPackDescription = signal('');
  newPackImage = signal('');
  newPackPubkeys = signal('');

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

      const packs = await this.followPacksService.getFollowPacks(pubkey);
      this.followPacks.set(packs);
    } catch (error) {
      this.logger.error('Error loading follow packs:', error);
      this.snackBar.open('Error loading follow packs', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Start creating a new follow pack
  startCreatingNew() {
    this.isCreatingNew.set(true);
    this.newPackTitle.set('');
    this.newPackDescription.set('');
    this.newPackImage.set('');
    this.newPackPubkeys.set('');
  }

  // Cancel creating new pack
  cancelCreatingNew() {
    this.isCreatingNew.set(false);
    this.newPackTitle.set('');
    this.newPackDescription.set('');
    this.newPackImage.set('');
    this.newPackPubkeys.set('');
  }

  // Save new follow pack
  async saveNewPack() {
    const title = this.newPackTitle().trim();
    const input = this.newPackPubkeys().trim();

    if (!title) {
      this.snackBar.open('Please enter a title for the follow pack', 'Close', { duration: 3000 });
      return;
    }

    if (!input) {
      this.snackBar.open('Please enter at least one pubkey', 'Close', { duration: 3000 });
      return;
    }

    const pubkeys = this.parsePubkeys(input);

    if (pubkeys.length === 0) {
      this.snackBar.open('Please enter at least one valid pubkey', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const description = this.newPackDescription().trim() || undefined;
      const image = this.newPackImage().trim() || undefined;
      const newPack = await this.followPacksService.createFollowPack(title, pubkeys, description, image);

      if (newPack) {
        this.snackBar.open('Follow pack created', 'Close', { duration: 3000 });
        this.cancelCreatingNew();
        await this.loadData();
      } else {
        this.snackBar.open('Failed to create follow pack', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error creating follow pack:', error);
      this.snackBar.open('Error creating follow pack', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Start editing an existing pack
  startEditing(pack: FollowPack) {
    this.editingPackId.set(pack.identifier);
    this.editingTitle.set(pack.title);
    this.editingDescription.set(pack.description || '');
    this.editingImage.set(pack.image || '');
    this.editingPubkeys.set(pack.pubkeys.join('\n'));
  }

  // Cancel editing
  cancelEditing() {
    this.editingPackId.set(null);
    this.editingTitle.set('');
    this.editingDescription.set('');
    this.editingImage.set('');
    this.editingPubkeys.set('');
  }

  // Save edited pack
  async saveEdit() {
    const identifier = this.editingPackId();
    if (!identifier) return;

    const title = this.editingTitle().trim();
    const input = this.editingPubkeys().trim();

    if (!title) {
      this.snackBar.open('Please enter a title', 'Close', { duration: 3000 });
      return;
    }

    if (!input) {
      this.snackBar.open('Please enter at least one pubkey', 'Close', { duration: 3000 });
      return;
    }

    const pubkeys = this.parsePubkeys(input);

    if (pubkeys.length === 0) {
      this.snackBar.open('Please enter at least one valid pubkey', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const description = this.editingDescription().trim() || undefined;
      const image = this.editingImage().trim() || undefined;
      const success = await this.followPacksService.saveFollowPack(
        identifier, title, pubkeys, description, image
      );

      if (success) {
        this.snackBar.open('Follow pack saved', 'Close', { duration: 3000 });
        this.cancelEditing();
        await this.loadData();
      } else {
        this.snackBar.open('Failed to save follow pack', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving follow pack:', error);
      this.snackBar.open('Error saving follow pack', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete a follow pack
  async deletePack(pack: FollowPack) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Follow Pack',
        message: `Are you sure you want to delete "${pack.title}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        this.isLoading.set(true);
        try {
          const success = await this.followPacksService.deleteFollowPack(pack.identifier);

          if (success) {
            this.snackBar.open('Follow pack deleted', 'Close', { duration: 3000 });
            await this.loadData();
          } else {
            this.snackBar.open('Failed to delete follow pack', 'Close', { duration: 3000 });
          }
        } catch (error) {
          this.logger.error('Error deleting follow pack:', error);
          this.snackBar.open('Error deleting follow pack', 'Close', { duration: 3000 });
        } finally {
          this.isLoading.set(false);
        }
      }
    });
  }

  // Navigate to a profile
  openProfile(pubkey: string): void {
    this.layout.openProfile(pubkey);
  }

  /**
   * Parse pubkeys from input - one per line, supports both hex and npub formats.
   */
  private parsePubkeys(input: string): string[] {
    return input
      .split(/[\n,]+/)
      .map(pk => pk.trim())
      .filter(pk => pk.length > 0)
      .map(pk => {
        // If it's an npub, convert to hex for storage
        if (pk.startsWith('npub1')) {
          try {
            const decoded = nip19.decode(pk);
            if (decoded.type === 'npub') {
              return decoded.data as string;
            }
          } catch {
            // Return as-is if decode fails
          }
        }
        return pk;
      })
      .filter(pk => pk.length === 64);
  }
}
