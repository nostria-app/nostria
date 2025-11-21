import { Injectable, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { EncryptionService } from './encryption.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UserDataService } from './user-data.service';
import { Memo, MemoBackup } from '../models/memo.model';
import { v2 } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils.js';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../components/confirm-dialog/confirm-dialog.component';
import { firstValueFrom } from 'rxjs';
import { LocalStorageService } from './local-storage.service';

/**
 * Service for managing private encrypted memos using NIP-78 (app-specific data)
 * with NIP-44 encryption.
 *
 * All memos are stored in a single kind 30078 event with:
 * - d tag: "nostria-notes"
 * - content: NIP-44 encrypted JSON array of all memos
 */
@Injectable({
  providedIn: 'root',
})
export class MemosService {
  private readonly nostrService = inject(NostrService);
  private readonly encryptionService = inject(EncryptionService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly userDataService = inject(UserDataService);
  private readonly dialog = inject(MatDialog);
  private readonly localStorage = inject(LocalStorageService);

  // Signal for reactive memos list
  readonly memos = signal<Memo[]>([]);

  private readonly NOTE_KIND = 30078;
  private readonly D_TAG = 'nostria-notes';
  private readonly BACKUP_KEY = 'nostria-memos-history';

  /**
   * Load all memos for the current user
   */
  async loadMemos(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('[MemosService] Cannot load memos - no account');
      return;
    }

    try {
      this.logger.info('[MemosService] Loading memos for pubkey:', pubkey.substring(0, 8));

      // Query for the specific parameterized replaceable event by d-tag
      // Use invalidateCache to always fetch the latest from relays
      const memoEvent = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
        pubkey,
        this.NOTE_KIND,
        this.D_TAG,
        { cache: false, save: true, invalidateCache: true }
      );

      if (!memoEvent || !memoEvent.event.content) {
        this.logger.info('[MemosService] No memos event found');
        if (this.memos().length === 0) {
          this.memos.set([]);
        }
        return;
      }

      this.logger.info('[MemosService] Found memos event:', {
        id: memoEvent.event.id,
        created_at: memoEvent.event.created_at,
        contentLength: memoEvent.event.content.length
      });

      // Decrypt and parse the memos array
      try {
        const decryptedContent = await this.decryptMemosContent(memoEvent.event.content);
        this.logger.info('[MemosService] Decrypted content length:', decryptedContent.length);

        const remoteMemos: Memo[] = JSON.parse(decryptedContent);
        const localMemos = this.memos();

        // Sort by updated date, newest first
        remoteMemos.sort((a, b) => b.updatedAt - a.updatedAt);

        if (localMemos.length > 0) {
          const mergedMemos = this.mergeMemos(localMemos, remoteMemos);

          // Check if merged result is different from local
          const hasChanges = mergedMemos.length !== localMemos.length ||
            mergedMemos.some((m, i) => m.id !== localMemos[i].id || m.updatedAt !== localMemos[i].updatedAt);

          if (hasChanges) {
            const dialogRef = this.dialog.open(ConfirmDialogComponent, {
              data: {
                title: 'Merge Memos?',
                message: 'We found memos on the network that are different from your local version. Do you want to merge them?',
                confirmText: 'Merge',
                cancelText: 'Keep Local'
              }
            });

            const shouldMerge = await firstValueFrom(dialogRef.afterClosed());

            if (shouldMerge) {
              // saveAllMemos will handle backup of current state
              this.memos.set(mergedMemos);
              await this.saveAllMemos(mergedMemos);
            }
          }
        } else {
          // If we have local memos but are overwriting with remote (no merge needed/wanted), backup first
          if (localMemos.length > 0) {
            this.saveBackup(localMemos);
          }
          this.logger.info('[MemosService] Successfully loaded memos:', remoteMemos.length, remoteMemos.map(n => ({ id: n.id, content: n.content.substring(0, 20) })));
          this.memos.set(remoteMemos);
        }
      } catch (error) {
        this.logger.error('[MemosService] Failed to decrypt memos', error);
      }
    } catch (error) {
      this.logger.error('[MemosService] Failed to load memos', error);
    }
  }

  private mergeMemos(local: Memo[], remote: Memo[]): Memo[] {
    const map = new Map<string, Memo>();

    // Add remote first
    for (const m of remote) {
      map.set(m.id, m);
    }

    // Merge local
    for (const m of local) {
      if (map.has(m.id)) {
        const existing = map.get(m.id)!;
        // If local is newer, overwrite
        if (m.updatedAt > existing.updatedAt) {
          map.set(m.id, m);
        }
      } else {
        map.set(m.id, m);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Create a new memo
   */
  async createMemo(content: string, color = 'default'): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[MemosService] Cannot create memo - no account');
      return false;
    }

    try {
      const now = this.nostrService.currentDate();
      const memoId = this.generateMemoId();

      const newMemo: Memo = {
        id: memoId,
        content,
        color,
        createdAt: now,
        updatedAt: now,
      };

      // Add to current memos array
      const currentMemos = [...this.memos(), newMemo];

      // Save all memos
      return await this.saveAllMemos(currentMemos);
    } catch (error) {
      this.logger.error('[MemosService] Failed to create memo', error);
      return false;
    }
  }

  /**
   * Update an existing memo
   */
  async updateMemo(memoId: string, content: string, color: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[MemosService] Cannot update memo - no account');
      return false;
    }

    try {
      const now = this.nostrService.currentDate();

      // Update the memo in the array
      const updatedMemos = this.memos().map(memo =>
        memo.id === memoId
          ? { ...memo, content, color, updatedAt: now }
          : memo
      );

      // Save all memos
      return await this.saveAllMemos(updatedMemos);
    } catch (error) {
      this.logger.error('[MemosService] Failed to update memo', error);
      return false;
    }
  }

  /**
   * Delete a memo
   */
  async deleteMemo(memoId: string): Promise<boolean> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.error('[MemosService] Cannot delete memo - no account');
      return false;
    }

    try {
      // Remove the memo from the array
      const updatedMemos = this.memos().filter(memo => memo.id !== memoId);

      // Save all memos
      return await this.saveAllMemos(updatedMemos);
    } catch (error) {
      this.logger.error('[MemosService] Failed to delete memo', error);
      return false;
    }
  }

  /**
   * Get local backups
   */
  getBackups(): MemoBackup[] {
    const backupsJson = this.localStorage.getItem(this.BACKUP_KEY);
    if (!backupsJson) return [];
    try {
      return JSON.parse(backupsJson);
    } catch (e) {
      this.logger.error('[MemosService] Failed to parse backups', e);
      return [];
    }
  }

  /**
   * Save a backup of the current memos
   */
  private saveBackup(memos: Memo[]): void {
    if (memos.length === 0) return;

    try {
      const backups = this.getBackups();
      const newBackup: MemoBackup = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        memos: [...memos]
      };

      // Add new backup to the beginning
      backups.unshift(newBackup);

      // Limit to 10 backups
      if (backups.length > 10) {
        backups.length = 10;
      }

      this.localStorage.setItem(this.BACKUP_KEY, JSON.stringify(backups));
      this.logger.info('[MemosService] Backup saved', newBackup.id);
    } catch (e) {
      this.logger.error('[MemosService] Failed to save backup', e);
    }
  }

  /**
   * Restore a backup
   */
  async restoreBackup(backupId: string): Promise<boolean> {
    const backups = this.getBackups();
    const backup = backups.find(b => b.id === backupId);

    if (!backup) {
      this.logger.error('[MemosService] Backup not found', backupId);
      return false;
    }

    try {
      const currentMemos = this.memos();
      const mergedMemos = this.mergeMemos(currentMemos, backup.memos);
      return await this.saveAllMemos(mergedMemos);
    } catch (e) {
      this.logger.error('[MemosService] Failed to restore backup', e);
      return false;
    }
  }

  /**
   * Save all memos to a single event
   */
  private async saveAllMemos(memos: Memo[]): Promise<boolean> {
    try {
      // Backup current state before saving new state
      // We only backup if we have existing memos, to avoid backing up empty initial state
      // and if the new state is different (though saveAllMemos is usually called with changes)
      if (this.memos().length > 0) {
        this.saveBackup(this.memos());
      }

      this.logger.info('[MemosService] Saving memos:', memos.length, memos.map(n => ({ id: n.id, content: n.content.substring(0, 20) })));

      // Encrypt the entire memos array
      const encryptedContent = await this.encryptMemosContent(memos);

      // Create event with single d tag
      const event = this.nostrService.createEvent(
        this.NOTE_KIND,
        encryptedContent,
        [['d', this.D_TAG]]
      );

      this.logger.info('[MemosService] Publishing event:', {
        kind: event.kind,
        created_at: event.created_at,
        contentLength: event.content.length
      });

      const result = await this.nostrService.signAndPublish(event);

      if (result.success) {
        this.logger.info('[MemosService] Successfully published memos event');
        // Update local state
        this.memos.set(memos);
        return true;
      }

      this.logger.error('[MemosService] Failed to publish memos event');
      return false;
    } catch (error) {
      this.logger.error('[MemosService] Failed to save memos', error);
      return false;
    }
  }

  /**
   * Encrypt notes array using NIP-44 self-encryption
   * Uses the user's own public key as recipient
   */
  private async encryptMemosContent(memos: Memo[]): Promise<string> {
    const account = this.accountState.account();
    if (!account) {
      throw new Error('No account available');
    }

    const pubkey = account.pubkey;
    const jsonContent = JSON.stringify(memos);

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
   * Decrypt memos content using NIP-44 self-decryption
   */
  private async decryptMemosContent(ciphertext: string): Promise<string> {
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
    const memos = this.memos();

    if (memos.length === 0) {
      throw new Error('No memos to download');
    }

    // Create a readable export format
    const exportData = {
      exportedAt: new Date().toISOString(),
      pubkey: this.accountState.pubkey(),
      memosCount: memos.length,
      memos: memos.map(memo => ({
        id: memo.id,
        content: memo.content,
        color: memo.color,
        createdAt: new Date(memo.createdAt * 1000).toISOString(),
        updatedAt: new Date(memo.updatedAt * 1000).toISOString(),
      })),
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nostria-memos-readable-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Generate a unique memo ID
   */
  private generateMemoId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
