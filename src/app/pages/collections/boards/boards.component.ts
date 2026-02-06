import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import {
  CurationSetsService,
  CurationSet,
  CurationKind,
  EventRef,
  AddressableRef,
  ARTICLE_CURATION_KIND,
  VIDEO_CURATION_KIND,
  PICTURE_CURATION_KIND,
} from '../../../services/curation-sets.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { TwoColumnLayoutService } from '../../../services/two-column-layout.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../components/confirm-dialog/confirm-dialog.component';

interface BoardTab {
  kind: CurationKind;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-boards',
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
    MatChipsModule,
    MatSelectModule,
  ],
  templateUrl: './boards.component.html',
  styleUrl: './boards.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardsComponent implements OnInit {
  private curationSetsService = inject(CurationSetsService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private router = inject(Router);

  tabs: BoardTab[] = [
    { kind: ARTICLE_CURATION_KIND, label: 'Posts & Articles', icon: 'article' },
    { kind: VIDEO_CURATION_KIND, label: 'Videos', icon: 'video_library' },
    { kind: PICTURE_CURATION_KIND, label: 'Pictures', icon: 'photo_library' },
  ];

  // State
  isLoading = signal(false);
  allBoards = signal<CurationSet[]>([]);

  // Creating new set state
  isCreatingNew = signal(false);
  newSetTitle = signal('');
  newSetDescription = signal('');
  newSetImage = signal('');
  newSetEventRefs = signal('');
  newSetAddressableRefs = signal('');
  newSetKind = signal<CurationKind>(ARTICLE_CURATION_KIND);

  async ngOnInit() {
    this.twoColumnLayout.setSplitView();
    await this.loadAllBoards();
  }

  async loadAllBoards() {
    this.isLoading.set(true);
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.error('No authenticated user');
        return;
      }

      // Load boards from all 3 kinds in parallel
      const [articles, videos, pictures] = await Promise.all([
        this.curationSetsService.getCurationSets(pubkey, ARTICLE_CURATION_KIND),
        this.curationSetsService.getCurationSets(pubkey, VIDEO_CURATION_KIND),
        this.curationSetsService.getCurationSets(pubkey, PICTURE_CURATION_KIND),
      ]);

      const all = [...articles, ...videos, ...pictures];
      // Sort by created_at descending (newest first)
      all.sort((a, b) => b.created_at - a.created_at);

      this.allBoards.set(all);
    } catch (error) {
      this.logger.error('Error loading boards:', error);
      this.snackBar.open('Error loading boards', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  navigateToBoard(set: CurationSet) {
    this.router.navigate(['/collections/boards', set.kind, set.identifier]);
  }

  /**
   * Generate a deterministic gradient based on the board identifier.
   */
  generateGradient(identifier: string): string {
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
      const char = identifier.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    const hue1 = Math.abs(hash % 360);
    const hue2 = (hue1 + 40 + Math.abs((hash >> 8) % 80)) % 360;
    const angle = Math.abs((hash >> 16) % 360);

    return `linear-gradient(${angle}deg, hsl(${hue1}, 60%, 45%), hsl(${hue2}, 70%, 55%))`;
  }

  getItemCount(set: CurationSet): number {
    return set.eventRefs.length + set.addressableRefs.length;
  }

  getItemLabel(count: number): string {
    return count === 1 ? '1 item' : `${count} items`;
  }

  getKindLabel(kind: CurationKind): string {
    const tab = this.tabs.find(t => t.kind === kind);
    return tab?.label ?? 'Unknown';
  }

  getKindIcon(kind: CurationKind): string {
    const tab = this.tabs.find(t => t.kind === kind);
    return tab?.icon ?? 'dashboard';
  }

  // Whether this kind supports addressable refs (only Articles/Posts)
  supportsAddressableRefs(kind: CurationKind): boolean {
    return kind === ARTICLE_CURATION_KIND;
  }

  // Creating new
  startCreatingNew() {
    this.isCreatingNew.set(true);
    this.newSetTitle.set('');
    this.newSetDescription.set('');
    this.newSetImage.set('');
    this.newSetEventRefs.set('');
    this.newSetAddressableRefs.set('');
    this.newSetKind.set(ARTICLE_CURATION_KIND);
  }

  cancelCreatingNew() {
    this.isCreatingNew.set(false);
    this.newSetTitle.set('');
    this.newSetDescription.set('');
    this.newSetImage.set('');
    this.newSetEventRefs.set('');
    this.newSetAddressableRefs.set('');
  }

  async saveNewSet() {
    const title = this.newSetTitle().trim();

    if (!title) {
      this.snackBar.open('Please enter a title for the board', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const kind = this.newSetKind();
      const description = this.newSetDescription().trim() || undefined;
      const image = this.newSetImage().trim() || undefined;
      const eventRefs = this.parseEventRefs(this.newSetEventRefs().trim());
      const addressableRefs = this.parseAddressableRefs(this.newSetAddressableRefs().trim());

      const newSet = await this.curationSetsService.createCurationSet(
        kind, title, eventRefs, addressableRefs, description, image
      );

      if (newSet) {
        this.snackBar.open('Board created', 'Close', { duration: 3000 });
        this.cancelCreatingNew();
        await this.loadAllBoards();
      } else {
        this.snackBar.open('Failed to create board', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error creating board:', error);
      this.snackBar.open('Error creating board', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete
  async deleteSet(event: MouseEvent, set: CurationSet) {
    event.stopPropagation(); // Prevent card click navigation

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Board',
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
          const success = await this.curationSetsService.deleteCurationSet(set.identifier, set.kind);

          if (success) {
            this.snackBar.open('Board deleted', 'Close', { duration: 3000 });
            await this.loadAllBoards();
          } else {
            this.snackBar.open('Failed to delete board', 'Close', { duration: 3000 });
          }
        } catch (error) {
          this.logger.error('Error deleting board:', error);
          this.snackBar.open('Error deleting board', 'Close', { duration: 3000 });
        } finally {
          this.isLoading.set(false);
        }
      }
    });
  }

  /**
   * Parse event references from input. Supports:
   * - Raw hex event IDs
   * - note1... (NIP-19)
   * - nevent1... (NIP-19, extracts relay hint and author)
   */
  private parseEventRefs(input: string): EventRef[] {
    if (!input) return [];

    return input
      .split(/[\n,]+/)
      .map(ref => ref.trim())
      .filter(ref => ref.length > 0)
      .map(ref => {
        if (ref.startsWith('note1') || ref.startsWith('nevent1')) {
          try {
            const decoded = nip19.decode(ref);
            if (decoded.type === 'note') {
              return { id: decoded.data as string };
            }
            if (decoded.type === 'nevent') {
              const data = decoded.data as nip19.EventPointer;
              return {
                id: data.id,
                relay: data.relays?.[0],
                pubkey: data.author,
              };
            }
          } catch {
            // Return as-is if decode fails
          }
        }
        return { id: ref };
      })
      .filter(ref => ref.id.length === 64);
  }

  /**
   * Parse addressable references from input. Supports:
   * - Raw kind:pubkey:d-tag format
   * - naddr1... (NIP-19, extracts relay hint)
   */
  private parseAddressableRefs(input: string): AddressableRef[] {
    if (!input) return [];

    return input
      .split(/[\n,]+/)
      .map(ref => ref.trim())
      .filter(ref => ref.length > 0)
      .map(ref => {
        if (ref.startsWith('naddr1')) {
          try {
            const decoded = nip19.decode(ref);
            if (decoded.type === 'naddr') {
              const data = decoded.data as nip19.AddressPointer;
              return {
                coordinates: `${data.kind}:${data.pubkey}:${data.identifier}`,
                relay: data.relays?.[0],
              };
            }
          } catch {
            // Return as-is if decode fails
          }
        }
        return { coordinates: ref };
      })
      .filter(ref => ref.coordinates.includes(':'));
  }
}
