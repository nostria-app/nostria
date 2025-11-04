import { Injectable, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { EncryptionService } from './encryption.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UserDataService } from './user-data.service';
import { Note } from '../models/note.model';
import { v2 } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils.js';

/**
 * Service for managing private encrypted notes using NIP-78 (app-specific data)
 * with NIP-44 encryption.
 *
 * All notes are stored in a single kind 30078 event with:
 * - d tag: "nostria-notes"
 * - content: NIP-44 encrypted JSON array of all notes
 */
@Injectable({
  providedIn: 'root',
})
export class NotesService {
  private readonly nostrService = inject(NostrService);
  private readonly encryptionService = inject(EncryptionService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly userDataService = inject(UserDataService);

  // Signal for reactive notes list
  readonly notes = signal<Note[]>([]);

  private readonly NOTE_KIND = 30078;
  private readonly D_TAG = 'nostria-notes';

  /**
   * Load all notes for the current user
   */
  async loadNotes(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('[NotesService] Cannot load notes - no account');
      return;
    }

    try {
      this.logger.info('[NotesService] Loading notes for pubkey:', pubkey.substring(0, 8));

      // Query for the specific parameterized replaceable event by d-tag
      // Use invalidateCache to always fetch the latest from relays
      const noteEvent = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        this.NOTE_KIND,
        this.D_TAG,
        { cache: false, save: true, invalidateCache: true }
      );

      if (!noteEvent || !noteEvent.event.content) {
        this.logger.info('[NotesService] No notes event found');
        this.notes.set([]);
        return;
      }

      this.logger.info('[NotesService] Found notes event:', {
        id: noteEvent.event.id,
        created_at: noteEvent.event.created_at,
        contentLength: noteEvent.event.content.length
      });

      // Decrypt and parse the notes array
      try {
        const decryptedContent = await this.decryptNotesContent(noteEvent.event.content);
        this.logger.info('[NotesService] Decrypted content length:', decryptedContent.length);

        const notesArray: Note[] = JSON.parse(decryptedContent);

        // Sort by updated date, newest first
        notesArray.sort((a, b) => b.updatedAt - a.updatedAt);

        this.logger.info('[NotesService] Successfully loaded notes:', notesArray.length, notesArray.map(n => ({ id: n.id, content: n.content.substring(0, 20) })));
        this.notes.set(notesArray);
      } catch (error) {
        this.logger.error('[NotesService] Failed to decrypt notes', error);
        this.notes.set([]);
      }
    } catch (error) {
      this.logger.error('[NotesService] Failed to load notes', error);
    }
  }

  /**
   * Create a new note
   */
  async createNote(content: string, color = 'default'): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[NotesService] Cannot create note - no account');
      return false;
    }

    try {
      const now = this.nostrService.currentDate();
      const noteId = this.generateNoteId();

      const newNote: Note = {
        id: noteId,
        content,
        color,
        createdAt: now,
        updatedAt: now,
      };

      // Add to current notes array
      const currentNotes = [...this.notes(), newNote];

      // Save all notes
      return await this.saveAllNotes(currentNotes);
    } catch (error) {
      this.logger.error('[NotesService] Failed to create note', error);
      return false;
    }
  }

  /**
   * Update an existing note
   */
  async updateNote(noteId: string, content: string, color: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[NotesService] Cannot update note - no account');
      return false;
    }

    try {
      const now = this.nostrService.currentDate();

      // Update the note in the array
      const updatedNotes = this.notes().map(note =>
        note.id === noteId
          ? { ...note, content, color, updatedAt: now }
          : note
      );

      // Save all notes
      return await this.saveAllNotes(updatedNotes);
    } catch (error) {
      this.logger.error('[NotesService] Failed to update note', error);
      return false;
    }
  }

  /**
   * Delete a note
   */
  async deleteNote(noteId: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[NotesService] Cannot delete note - no account');
      return false;
    }

    try {
      // Remove the note from the array
      const updatedNotes = this.notes().filter(note => note.id !== noteId);

      // Save all notes
      return await this.saveAllNotes(updatedNotes);
    } catch (error) {
      this.logger.error('[NotesService] Failed to delete note', error);
      return false;
    }
  }

  /**
   * Save all notes to a single event
   */
  private async saveAllNotes(notes: Note[]): Promise<boolean> {
    try {
      this.logger.info('[NotesService] Saving notes:', notes.length, notes.map(n => ({ id: n.id, content: n.content.substring(0, 20) })));

      // Encrypt the entire notes array
      const encryptedContent = await this.encryptNotesContent(notes);

      // Create event with single d tag
      const event = this.nostrService.createEvent(
        this.NOTE_KIND,
        encryptedContent,
        [['d', this.D_TAG]]
      );

      this.logger.info('[NotesService] Publishing event:', {
        kind: event.kind,
        created_at: event.created_at,
        contentLength: event.content.length
      });

      const result = await this.nostrService.signAndPublish(event);

      if (result.success) {
        this.logger.info('[NotesService] Successfully published notes event');
        // Update local state
        this.notes.set(notes);
        return true;
      }

      this.logger.error('[NotesService] Failed to publish notes event');
      return false;
    } catch (error) {
      this.logger.error('[NotesService] Failed to save notes', error);
      return false;
    }
  }

  /**
   * Encrypt notes array using NIP-44 self-encryption
   * Uses the user's own public key as recipient
   */
  private async encryptNotesContent(notes: Note[]): Promise<string> {
    const account = this.accountState.account();
    if (!account) {
      throw new Error('No account available');
    }

    const pubkey = account.pubkey;
    const jsonContent = JSON.stringify(notes);

    // For self-encryption, we need to get the conversation key with our own pubkey
    if (account.source === 'extension' && window.nostr?.nip44) {
      return await window.nostr.nip44.encrypt(pubkey, jsonContent);
    }

    if (!account.privkey) {
      throw new Error('Private key not available for encryption');
    }

    // Get decrypted private key
    const decryptedPrivkey = await this.nostrService.getDecryptedPrivateKeyWithPrompt(account);
    if (!decryptedPrivkey) {
      throw new Error('Failed to decrypt private key');
    }

    // Use NIP-44 v2 self-encryption
    const privateKeyBytes = hexToBytes(decryptedPrivkey);
    const conversationKey = v2.utils.getConversationKey(privateKeyBytes, pubkey);

    return v2.encrypt(jsonContent, conversationKey);
  }

  /**
   * Decrypt notes content using NIP-44 self-decryption
   */
  private async decryptNotesContent(ciphertext: string): Promise<string> {
    const account = this.accountState.account();
    if (!account) {
      throw new Error('No account available');
    }

    const pubkey = account.pubkey;

    // Check if we can use the browser extension
    if (account.source === 'extension' && window.nostr?.nip44) {
      return await window.nostr.nip44.decrypt(pubkey, ciphertext);
    }

    if (!account.privkey) {
      throw new Error('Private key not available for decryption');
    }

    // Get decrypted private key
    const decryptedPrivkey = await this.nostrService.getDecryptedPrivateKeyWithPrompt(account);
    if (!decryptedPrivkey) {
      throw new Error('Failed to decrypt private key');
    }

    // Use NIP-44 v2 self-decryption
    const privateKeyBytes = hexToBytes(decryptedPrivkey);
    const conversationKey = v2.utils.getConversationKey(privateKeyBytes, pubkey);

    return v2.decrypt(ciphertext, conversationKey);
  }

  /**
   * Download the encrypted Nostr event
   */
  async downloadEncryptedEvent(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      throw new Error('No account available');
    }

    // Get the encrypted event from storage/relay
    const noteEvent = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
      pubkey,
      this.NOTE_KIND,
      this.D_TAG,
      { cache: false, save: false }
    );

    if (!noteEvent) {
      throw new Error('No notes event found');
    }

    // Download as JSON file
    const eventJson = JSON.stringify(noteEvent.event, null, 2);
    const blob = new Blob([eventJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nostria-notes-encrypted-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Download notes as readable JSON
   */
  async downloadReadableJson(): Promise<void> {
    const notes = this.notes();

    if (notes.length === 0) {
      throw new Error('No notes to download');
    }

    // Create a readable export format
    const exportData = {
      exportedAt: new Date().toISOString(),
      pubkey: this.accountState.pubkey(),
      notesCount: notes.length,
      notes: notes.map(note => ({
        id: note.id,
        content: note.content,
        color: note.color,
        createdAt: new Date(note.createdAt * 1000).toISOString(),
        updatedAt: new Date(note.updatedAt * 1000).toISOString(),
      })),
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nostria-notes-readable-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Generate a unique note ID
   */
  private generateNoteId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
