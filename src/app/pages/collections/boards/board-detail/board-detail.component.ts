import { Component, OnInit, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { nip19 } from 'nostr-tools';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
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
import {
  CurationSetsService,
  CurationSet,
  CurationKind,
  EventRef,
  AddressableRef,
  ARTICLE_CURATION_KIND,
  VIDEO_CURATION_KIND,
  PICTURE_CURATION_KIND,
} from '../../../../services/curation-sets.service';
import { AccountStateService } from '../../../../services/account-state.service';
import { AccountLocalStateService } from '../../../../services/account-local-state.service';
import { LoggerService } from '../../../../services/logger.service';
import { TwoColumnLayoutService } from '../../../../services/two-column-layout.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../components/confirm-dialog/confirm-dialog.component';
import { EventComponent } from '../../../../components/event/event.component';
import { LayoutService } from '../../../../services/layout.service';

type BoardViewMode = 'compact' | 'standard';

interface BoardTab {
  kind: CurationKind;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-board-detail',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatMenuModule,
    EventComponent,
  ],
  templateUrl: './board-detail.component.html',
  styleUrl: './board-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardDetailComponent implements OnInit {
  private curationSetsService = inject(CurationSetsService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private layout = inject(LayoutService);

  tabs: BoardTab[] = [
    { kind: ARTICLE_CURATION_KIND, label: 'Posts & Articles', icon: 'article' },
    { kind: VIDEO_CURATION_KIND, label: 'Videos', icon: 'video_library' },
    { kind: PICTURE_CURATION_KIND, label: 'Pictures', icon: 'photo_library' },
  ];

  // State
  isLoading = signal(false);
  boardSet = signal<CurationSet | null>(null);
  viewMode = signal<BoardViewMode>('standard');

  boardTitle = computed(() => this.boardSet()?.title ?? 'Board');
  boardIcon = computed(() => {
    const set = this.boardSet();
    if (!set) return 'dashboard';
    const tab = this.tabs.find(t => t.kind === set.kind);
    return tab?.icon ?? 'dashboard';
  });

  // Editing state
  isEditing = signal(false);
  editingTitle = signal('');
  editingDescription = signal('');
  editingImage = signal('');
  editingEventRefs = signal<EventRef[]>([]);
  editingAddressableRefs = signal<AddressableRef[]>([]);

  async ngOnInit() {
    this.twoColumnLayout.setSplitView();

    // Restore view mode
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const savedViewMode = this.accountLocalState.getBoardsViewMode(pubkey);
      if (savedViewMode === 'compact' || savedViewMode === 'standard') {
        this.viewMode.set(savedViewMode);
      }
    }

    await this.loadBoard();
  }

  async loadBoard() {
    this.isLoading.set(true);
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.error('No authenticated user');
        return;
      }

      const kindParam = this.route.snapshot.paramMap.get('kind');
      const identifier = this.route.snapshot.paramMap.get('identifier');

      if (!kindParam || !identifier) {
        this.logger.error('Missing route params');
        this.router.navigate(['/collections/boards']);
        return;
      }

      const kind = parseInt(kindParam, 10) as CurationKind;
      if (kind !== ARTICLE_CURATION_KIND && kind !== VIDEO_CURATION_KIND && kind !== PICTURE_CURATION_KIND) {
        this.logger.error('Invalid board kind:', kind);
        this.router.navigate(['/collections/boards']);
        return;
      }

      const sets = await this.curationSetsService.getCurationSets(pubkey, kind);
      const board = sets.find(s => s.identifier === identifier);

      if (!board) {
        this.snackBar.open('Board not found', 'Close', { duration: 3000 });
        this.router.navigate(['/collections/boards']);
        return;
      }

      this.boardSet.set(board);
    } catch (error) {
      this.logger.error('Error loading board:', error);
      this.snackBar.open('Error loading board', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/collections/boards']);
  }

  // View mode toggle
  setViewMode(mode: BoardViewMode) {
    this.viewMode.set(mode);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setBoardsViewMode(pubkey, mode);
    }
  }

  supportsAddressableRefs(): boolean {
    return this.boardSet()?.kind === ARTICLE_CURATION_KIND;
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

  // Editing
  startEditing() {
    const set = this.boardSet();
    if (!set) return;
    this.isEditing.set(true);
    this.editingTitle.set(set.title);
    this.editingDescription.set(set.description || '');
    this.editingImage.set(set.image || '');
    this.editingEventRefs.set([...set.eventRefs]);
    this.editingAddressableRefs.set([...set.addressableRefs]);
  }

  cancelEditing() {
    this.isEditing.set(false);
    this.editingTitle.set('');
    this.editingDescription.set('');
    this.editingImage.set('');
    this.editingEventRefs.set([]);
    this.editingAddressableRefs.set([]);
  }

  async saveEdit() {
    const set = this.boardSet();
    if (!set) return;

    const title = this.editingTitle().trim();
    if (!title) {
      this.snackBar.open('Please enter a title', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    try {
      const description = this.editingDescription().trim() || undefined;
      const image = this.editingImage().trim() || undefined;
      const eventRefs = this.editingEventRefs();
      const addressableRefs = this.editingAddressableRefs();

      const success = await this.curationSetsService.saveCurationSet(
        set.identifier, set.kind, title, eventRefs, addressableRefs, description, image
      );

      if (success) {
        this.snackBar.open('Board saved', 'Close', { duration: 3000 });
        this.cancelEditing();
        await this.loadBoard();
      } else {
        this.snackBar.open('Failed to save board', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Error saving board:', error);
      this.snackBar.open('Error saving board', 'Close', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete
  async deleteBoard() {
    const set = this.boardSet();
    if (!set) return;

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
            this.router.navigate(['/collections/boards']);
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

  // Navigate to event in right panel
  openEvent(ref: EventRef): void {
    const nevent = nip19.neventEncode({
      id: ref.id,
      relays: ref.relay ? [ref.relay] : undefined,
      author: ref.pubkey,
    });
    this.layout.navigateToRightPanel(`e/${nevent}`);
  }

  // Navigate to addressable event in right panel
  openAddressableEvent(ref: AddressableRef): void {
    const parts = ref.coordinates.split(':');
    if (parts.length >= 3) {
      const kind = parseInt(parts[0], 10);
      const pubkey = parts[1];
      const identifier = parts.slice(2).join(':');
      const naddr = nip19.naddrEncode({
        kind,
        pubkey,
        identifier,
        relays: ref.relay ? [ref.relay] : undefined,
      });
      this.layout.navigateToRightPanel(`a/${naddr}`);
    }
  }

  encodeNevent(ref: EventRef): string {
    return nip19.neventEncode({
      id: ref.id,
      relays: ref.relay ? [ref.relay] : undefined,
      author: ref.pubkey,
    });
  }

  encodeNaddr(ref: AddressableRef): string {
    const parts = ref.coordinates.split(':');
    if (parts.length >= 3) {
      const kind = parseInt(parts[0], 10);
      const pubkey = parts[1];
      const identifier = parts.slice(2).join(':');
      return nip19.naddrEncode({
        kind,
        pubkey,
        identifier,
        relays: ref.relay ? [ref.relay] : undefined,
      });
    }
    return ref.coordinates;
  }

  formatRelay(relay: string): string {
    try {
      const url = new URL(relay);
      return url.hostname;
    } catch {
      return relay.length > 30 ? `${relay.slice(0, 27)}...` : relay;
    }
  }

  // ---- Editing helpers for structured refs ----

  updateEditingEventRef(index: number, field: 'id' | 'relay' | 'pubkey', value: string) {
    const refs = [...this.editingEventRefs()];
    if (index < 0 || index >= refs.length) return;
    refs[index] = { ...refs[index], [field]: value || undefined };
    this.editingEventRefs.set(refs);
  }

  removeEditingEventRef(index: number) {
    const refs = [...this.editingEventRefs()];
    refs.splice(index, 1);
    this.editingEventRefs.set(refs);
  }

  addEditingEventRef() {
    const refs = [...this.editingEventRefs()];
    refs.push({ id: '' });
    this.editingEventRefs.set(refs);
  }

  updateEditingAddressableRef(index: number, field: 'coordinates' | 'relay', value: string) {
    const refs = [...this.editingAddressableRefs()];
    if (index < 0 || index >= refs.length) return;
    refs[index] = { ...refs[index], [field]: value || undefined };
    this.editingAddressableRefs.set(refs);
  }

  removeEditingAddressableRef(index: number) {
    const refs = [...this.editingAddressableRefs()];
    refs.splice(index, 1);
    this.editingAddressableRefs.set(refs);
  }

  addEditingAddressableRef() {
    const refs = [...this.editingAddressableRefs()];
    refs.push({ coordinates: '' });
    this.editingAddressableRefs.set(refs);
  }
}
