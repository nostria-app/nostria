import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { BookmarkService, BookmarkList, BookmarkType } from '../../services/bookmark.service';
import { MatSnackBar } from '@angular/material/snack-bar';

export interface BookmarkListSelectorData {
  itemId: string;
  type: BookmarkType;
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
    FormsModule
  ],
  templateUrl: './bookmark-list-selector.component.html',
  styleUrl: './bookmark-list-selector.component.scss',
})
export class BookmarkListSelectorComponent {
  dialogRef = inject(MatDialogRef<BookmarkListSelectorComponent>);
  data = inject<BookmarkListSelectorData>(MAT_DIALOG_DATA);
  bookmarkService = inject(BookmarkService);
  snackBar = inject(MatSnackBar);

  showNewListInput = signal(false);
  newListName = signal('');
  creatingList = signal(false);

  allLists = this.bookmarkService.allBookmarkLists;

  getListsWithBookmark(): BookmarkList[] {
    return this.bookmarkService.getListsContainingBookmark(this.data.itemId, this.data.type);
  }

  isInList(listId: string): boolean {
    return this.bookmarkService.isBookmarked(this.data.itemId, this.data.type, listId);
  }

  async toggleBookmarkInList(listId: string) {
    await this.bookmarkService.addBookmark(this.data.itemId, this.data.type, listId);
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
        await this.bookmarkService.addBookmark(this.data.itemId, this.data.type, newList.id);
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
