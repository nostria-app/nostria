import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NotesService } from '../../services/notes.service';
import { NoteCardComponent } from './note-card/note-card.component';
import { Note } from '../../models/note.model';
import { AccountStateService } from '../../services/account-state.service';
import { InfoTooltipComponent } from '../../components/info-tooltip/info-tooltip.component';
import { NotesDownloadDialogComponent } from './notes-download-dialog/notes-download-dialog.component';

@Component({
  selector: 'app-notes',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    NoteCardComponent,
    InfoTooltipComponent,
  ],
  template: `


    <div class="notes-container">

      <header class="notes-header">
        <h1>
          Notes 
          <mat-icon class="premium-icon">diamond</mat-icon>
          <app-info-tooltip [content]="notesInfoContent" ariaLabel="Learn about Notes privacy" />
        </h1>
        <div class="header-actions">
          <button mat-raised-button (click)="downloadNotes()">
            <mat-icon>download</mat-icon>
            Download
          </button>
          <button mat-flat-button (click)="createNewNote()">
            <mat-icon>add</mat-icon>
            New Note
          </button>
        </div>
      </header>

      <ng-template #notesInfoContent>
        <div class="info-content">
          <h3>About Notes</h3>
          <p>
            Notes are stored as <strong>encrypted events</strong> using NIP-44 encryption, 
            which means only you can read them with your private key.
          </p>
          <p>
            <strong>⚠️ Important Privacy Notice:</strong>
          </p>
          <ul>
            <li>Notes are published to <strong>public relays</strong>, making them retrievable by anyone</li>
            <li>While currently encrypted, future advances in computing power could potentially decrypt them</li>
            <li>Avoid storing highly sensitive personal information (passwords, private keys, etc.)</li>
            <li>Think of Notes as "encrypted but not completely secret"</li>
          </ul>
          <p>
            <strong>Best practices:</strong> Use Notes for personal reminders, ideas, and non-critical information 
            that you want synced across devices.
          </p>
        </div>
      </ng-template>

      @if (loading()) {
        <div class="loading-container">
          <mat-spinner />
        </div>
      } @else if (notes().length === 0) {
        <div class="empty-state">
          <mat-icon>note</mat-icon>
          <h2>No notes yet</h2>
          <p>Create your first encrypted note</p>
          <button mat-raised-button color="primary" (click)="createNewNote()">
            <mat-icon>add</mat-icon>
            Create Note
          </button>
        </div>
      } @else {
        <div class="notes-grid">
          @for (note of notes(); track note.id) {
            <app-note-card
              [note]="note"
              (save)="handleSaveNote($event)"
              (delete)="handleDeleteNote($event)"
            />
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .notes-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }

    .notes-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
    }

    .notes-header h1 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    .info-content {
      max-width: 500px;
      padding: 16px;
    }

    .info-content h3 {
      margin-top: 0;
      margin-bottom: 12px;
    }

    .info-content p {
      margin-bottom: 12px;
      line-height: 1.6;
    }

    .info-content ul {
      margin: 8px 0;
      padding-left: 20px;
      line-height: 1.6;
    }

    .info-content ul li {
      margin-bottom: 8px;
    }

    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 400px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      gap: 16px;
      color: var(--text-secondary);
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      opacity: 0.5;
    }

    .empty-state h2 {
      margin: 0;
      font-size: 24px;
    }

    .empty-state p {
      margin: 0;
      font-size: 16px;
    }

    .notes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      padding-bottom: 32px;
    }

    @media (max-width: 768px) {
      .notes-container {
        padding: 16px;
      }

      .notes-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 16px;
      }

      .notes-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class NotesComponent {
  private readonly notesService = inject(NotesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly accountState = inject(AccountStateService);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(false);
  readonly notes = this.notesService.notes;
  private isLoadingNotes = false;

  constructor() {
    // Reload notes when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      console.log('[NotesComponent] Account changed, pubkey:', pubkey?.substring(0, 8));
      if (pubkey) {
        // Use setTimeout to avoid effect timing issues
        setTimeout(() => this.loadNotes(), 0);
      } else {
        // Clear notes if no account
        this.notesService.notes.set([]);
      }
    });
  }

  async loadNotes() {
    // Prevent duplicate loads
    if (this.isLoadingNotes) {
      console.log('[NotesComponent] Already loading notes, skipping...');
      return;
    }

    console.log('[NotesComponent] loadNotes called');
    this.isLoadingNotes = true;
    this.loading.set(true);
    try {
      await this.notesService.loadNotes();
    } finally {
      this.loading.set(false);
      this.isLoadingNotes = false;
    }
  }

  async createNewNote() {
    const success = await this.notesService.createNote('', 'default');
    if (success) {
      this.snackBar.open('Note created', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to create note', 'Close', { duration: 3000 });
    }
  }

  async downloadNotes() {
    const dialogRef = this.dialog.open(NotesDownloadDialogComponent, {
      width: '500px',
    });

    const format = await dialogRef.afterClosed().toPromise();

    if (!format) {
      return; // User cancelled
    }

    try {
      if (format === 'encrypted') {
        await this.notesService.downloadEncryptedEvent();
        this.snackBar.open('Encrypted event downloaded', 'Close', { duration: 2000 });
      } else if (format === 'json') {
        await this.notesService.downloadReadableJson();
        this.snackBar.open('JSON file downloaded', 'Close', { duration: 2000 });
      }
    } catch (error) {
      console.error('Download failed:', error);
      this.snackBar.open('Failed to download notes', 'Close', { duration: 3000 });
    }
  }

  async handleSaveNote(note: Note) {
    const success = await this.notesService.updateNote(note.id, note.content, note.color);
    if (success) {
      this.snackBar.open('Note saved', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to save note', 'Close', { duration: 3000 });
    }
  }

  async handleDeleteNote(noteId: string) {
    const success = await this.notesService.deleteNote(noteId);
    if (success) {
      this.snackBar.open('Note deleted', 'Close', { duration: 2000 });
    } else {
      this.snackBar.open('Failed to delete note', 'Close', { duration: 3000 });
    }
  }
}
