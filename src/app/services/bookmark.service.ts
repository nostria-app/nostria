import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class BookmarkService {

  bookmarks = signal<any[]>([]);

  addBookmark(id: string) {
    const existingBookmark = this.bookmarks().find(b => b.id === id);
    if (existingBookmark) {
      this.bookmarks.update(bookmarks => bookmarks.filter(b => b.id !== id));
    } else {
      this.bookmarks.update(bookmarks => [...bookmarks, { id }]);
    }
  }

  toggleBookmark(id: string) {
    const existingBookmark = this.bookmarks().find(b => b.id === id);
    if (existingBookmark) {
      this.bookmarks.update(bookmarks => bookmarks.filter(b => b.id !== id));
    } else {
      this.bookmarks.update(bookmarks => [...bookmarks, { id }]);
    }
  }

  constructor() { }
}
