import { Component, inject, signal, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { BookmarkService, BookmarkList, BookmarkType } from '../../services/bookmark.service';
import { AccountStateService } from '../../services/account-state.service';
import {
  CurationSetsService,
  CurationSet,
  CurationKind,
} from '../../services/curation-sets.service';

export interface BookmarkListSelectorData {
  itemId: string;
  type: BookmarkType;
  eventKind?: number; // The kind of the event being bookmarked (1, 20, 21, 30023, etc.)
  pubkey?: string;    // Author pubkey for relay hints (NIP-51 e-tag format)
  relay?: string;     // Relay hint URL for findability
}

@Component({
  selector: 'app-bookmark-list-selector',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    FormsModule
  ],
  templateUrl: './bookmark-list-selector.component.html',
  styleUrl: './bookmark-list-selector.component.scss',
})
export class BookmarkListSelectorComponent implements OnInit {
  dialogRef = inject(MatDialogRef<BookmarkListSelectorComponent>);
  data = inject<BookmarkListSelectorData>(MAT_DIALOG_DATA);
  bookmarkService = inject(BookmarkService);
  curationSetsService = inject(CurationSetsService);
  accountState = inject(AccountStateService);
  snackBar = inject(MatSnackBar);

  showNewListInput = signal(false);
  newListName = signal('');
  creatingList = signal(false);

  // Board state
  boards = signal<CurationSet[]>([]);
  boardsLoading = signal(false);
  curationKind = signal<CurationKind | null>(null);
  boardLabel = signal('');
  // Track boards where the item has been toggled in this session
  boardToggleState = signal<Map<string, boolean>>(new Map());

  showNewBoardInput = signal(false);
  newBoardName = signal('');
  creatingBoard = signal(false);

  allLists = this.bookmarkService.allBookmarkLists;

  async ngOnInit() {
    // Determine if we should show boards based on event kind
    if (this.data.eventKind != null) {
      const kind = this.curationSetsService.getCurationKindForEvent(this.data.eventKind);
      if (kind) {
        this.curationKind.set(kind);
        this.boardLabel.set(this.curationSetsService.getCurationLabel(kind));
        await this.loadBoards(kind);
      }
    }
  }

  private async loadBoards(kind: CurationKind) {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    this.boardsLoading.set(true);
    try {
      const sets = await this.curationSetsService.getCurationSets(pubkey, kind);
      this.boards.set(sets);

      // Initialize toggle state from actual data
      const stateMap = new Map<string, boolean>();
      for (const set of sets) {
        stateMap.set(set.identifier, this.curationSetsService.isInCurationSet(set, this.data.itemId, this.data.type as 'e' | 'a'));
      }
      this.boardToggleState.set(stateMap);
    } finally {
      this.boardsLoading.set(false);
    }
  }

  getListsWithBookmark(): BookmarkList[] {
    return this.bookmarkService.getListsContainingBookmark(this.data.itemId, this.data.type);
  }

  isInList(listId: string): boolean {
    return this.bookmarkService.isBookmarked(this.data.itemId, this.data.type, listId);
  }

  async toggleBookmarkInList(listId: string) {
    await this.bookmarkService.addBookmark(this.data.itemId, this.data.type, listId, this.data.relay, this.data.pubkey);
  }

  // Board methods
  isInBoard(identifier: string): boolean {
    const state = this.boardToggleState();
    return state.get(identifier) ?? false;
  }

  async toggleBoard(identifier: string) {
    const kind = this.curationKind();
    if (!kind) return;

    const currentlyIn = this.isInBoard(identifier);

    // Optimistically update UI
    const newState = new Map(this.boardToggleState());
    newState.set(identifier, !currentlyIn);
    this.boardToggleState.set(newState);

    let success: boolean;
    if (currentlyIn) {
      success = await this.curationSetsService.removeFromCurationSet(
        identifier, kind, this.data.itemId, this.data.type as 'e' | 'a'
      );
    } else {
      success = await this.curationSetsService.addToCurationSet(
        identifier, kind, this.data.itemId, this.data.type as 'e' | 'a',
        this.data.relay, this.data.pubkey
      );
    }

    if (!success) {
      // Revert on failure
      const revertState = new Map(this.boardToggleState());
      revertState.set(identifier, currentlyIn);
      this.boardToggleState.set(revertState);
      this.snackBar.open('Failed to update board', 'Close', { duration: 3000 });
    }
  }

  showNewBoardForm() {
    this.showNewBoardInput.set(true);
  }

  cancelNewBoard() {
    this.showNewBoardInput.set(false);
    this.newBoardName.set('');
  }

  async createAndAddToNewBoard() {
    const name = this.newBoardName().trim();
    const kind = this.curationKind();
    if (!name || !kind) {
      this.snackBar.open('Please enter a board name', 'Close', { duration: 3000 });
      return;
    }

    this.creatingBoard.set(true);
    try {
      // Create with the current item already in it, including relay/pubkey hints
      const eventRefs = this.data.type === 'e'
        ? [{ id: this.data.itemId, relay: this.data.relay, pubkey: this.data.pubkey }]
        : [];
      const addressableRefs = this.data.type === 'a'
        ? [{ coordinates: this.data.itemId, relay: this.data.relay }]
        : [];

      const newSet = await this.curationSetsService.createCurationSet(
        kind, name, eventRefs, addressableRefs
      );
      if (newSet) {
        this.snackBar.open(`Added to "${name}"`, 'Close', { duration: 2000 });
        this.showNewBoardInput.set(false);
        this.newBoardName.set('');

        // Reload boards
        await this.loadBoards(kind);
      }
    } finally {
      this.creatingBoard.set(false);
    }
  }

  showNewListForm() {
    this.showNewListInput.set(true);
  }

  cancelNewList() {
    this.showNewListInput.set(false);
    this.newListName.set('');
  }

  async createAndAddToNewList() {
    const name = this.newListName().trim();
    if (!name) {
      this.snackBar.open('Please enter a list name', 'Close', { duration: 3000 });
      return;
    }

    this.creatingList.set(true);
    try {
      const newList = await this.bookmarkService.createBookmarkList(name);
      if (newList) {
        // Add the bookmark to the new list
        await this.bookmarkService.addBookmark(this.data.itemId, this.data.type, newList.id, this.data.relay, this.data.pubkey);
        this.snackBar.open(`Added to "${name}"`, 'Close', { duration: 2000 });
        this.showNewListInput.set(false);
        this.newListName.set('');
      }
    } finally {
      this.creatingList.set(false);
    }
  }

  close() {
    this.dialogRef.close();
  }
}
