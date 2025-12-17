import { Injectable, inject, effect, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { LocalStorageService } from './local-storage.service';
import { Event, kinds } from 'nostr-tools';
import { DatabaseService } from './database.service';

/**
 * Backup structure for following list
 */
export interface FollowingBackup {
  id: string;
  timestamp: number;
  pubkeys: string[];
  event: Event; // The original kind 3 event
}

/**
 * Service for managing automatic backups of the following list (kind 3)
 * Keeps the last 10 backups and allows restore/merge operations
 */
@Injectable({
  providedIn: 'root',
})
export class FollowingBackupService {
  private readonly nostrService = inject(NostrService);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly database = inject(DatabaseService);

  private readonly BACKUP_KEY = 'nostria-following-history';
  private readonly MAX_BACKUPS = 10;

  /** Reactive signal for backups list */
  readonly backups = signal<FollowingBackup[]>(this.loadBackups());

  constructor() {
    // Automatically backup when following list changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const followingList = this.accountState.followingList();

      if (pubkey) {
        // Schedule backup asynchronously to not block the effect
        // Backup even if following list is empty - user may have intentionally cleared it
        queueMicrotask(() => {
          this.createBackup().catch(err => {
            this.logger.error('[FollowingBackupService] Failed to create automatic backup', err);
          });
        });
      }
    });
  }

  /**
   * Load backups from local storage
   */
  private loadBackups(): FollowingBackup[] {
    const backupsJson = this.localStorage.getItem(this.BACKUP_KEY);
    if (!backupsJson) return [];
    try {
      return JSON.parse(backupsJson);
    } catch (e) {
      this.logger.error('[FollowingBackupService] Failed to parse backups', e);
      return [];
    }
  }

  /**
   * Get all backups
   */
  getBackups(): FollowingBackup[] {
    return this.backups();
  }

  /**
   * Create a backup of the current following list
   */
  async createBackup(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.logger.warn('[FollowingBackupService] Cannot create backup - no account');
      return;
    }

    try {
      // Get the current kind 3 event from database
      const event = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);

      if (!event) {
        this.logger.warn('[FollowingBackupService] No kind 3 event found, cannot backup');
        return;
      }

      // Extract pubkeys from the event's "p" tags - this is the source of truth
      const pubkeysFromEvent = event.tags
        .filter(tag => tag[0] === 'p' && tag[1])
        .map(tag => tag[1]);

      // Skip backup if no pubkeys in the event
      if (pubkeysFromEvent.length === 0) {
        this.logger.debug('[FollowingBackupService] Skipping backup - no pubkeys in event');
        return;
      }

      const backups = this.getBackups();

      // Check if the most recent backup is the same
      if (backups.length > 0) {
        const lastBackup = backups[0];
        // Compare pubkey arrays
        if (this.areArraysEqual(lastBackup.pubkeys, pubkeysFromEvent)) {
          this.logger.debug('[FollowingBackupService] No changes detected, skipping backup');
          return;
        }
      }

      const newBackup: FollowingBackup = {
        id: this.generateBackupId(),
        timestamp: Date.now(),
        pubkeys: pubkeysFromEvent,
        event: event,
      };

      // Add new backup to the beginning
      backups.unshift(newBackup);

      // Limit to MAX_BACKUPS
      if (backups.length > this.MAX_BACKUPS) {
        backups.length = this.MAX_BACKUPS;
      }

      this.localStorage.setItem(this.BACKUP_KEY, JSON.stringify(backups));
      this.backups.set([...backups]);
      this.logger.info('[FollowingBackupService] Backup saved', {
        id: newBackup.id,
        count: pubkeysFromEvent.length,
        totalBackups: backups.length
      });
    } catch (e) {
      this.logger.error('[FollowingBackupService] Failed to save backup', e);
    }
  }

  /**
   * Restore a backup (replace current following list)
   */
  async restoreBackup(backupId: string): Promise<boolean> {
    const backups = this.getBackups();
    const backup = backups.find(b => b.id === backupId);

    if (!backup) {
      this.logger.error('[FollowingBackupService] Backup not found', backupId);
      return false;
    }

    try {
      this.logger.info('[FollowingBackupService] Restoring backup', {
        id: backup.id,
        timestamp: backup.timestamp,
        count: backup.pubkeys.length
      });

      // Publish the old event as a new event with current timestamp
      const restoredEvent = await this.publishFollowingList(backup.pubkeys, backup.event.content);

      if (restoredEvent) {
        this.logger.info('[FollowingBackupService] Backup restored successfully');
        return true;
      }

      return false;
    } catch (e) {
      this.logger.error('[FollowingBackupService] Failed to restore backup', e);
      return false;
    }
  }

  /**
   * Merge a backup with the current following list
   * Combines both lists without duplicates
   */
  async mergeBackup(backupId: string): Promise<boolean> {
    const backups = this.getBackups();
    const backup = backups.find(b => b.id === backupId);

    if (!backup) {
      this.logger.error('[FollowingBackupService] Backup not found', backupId);
      return false;
    }

    try {
      const currentFollowing = this.accountState.followingList();
      const backupFollowing = backup.pubkeys;

      // Merge and deduplicate
      const mergedSet = new Set([...currentFollowing, ...backupFollowing]);
      const mergedList = Array.from(mergedSet);

      this.logger.info('[FollowingBackupService] Merging backup', {
        id: backup.id,
        current: currentFollowing.length,
        backup: backupFollowing.length,
        merged: mergedList.length,
        added: mergedList.length - currentFollowing.length
      });

      // Get current event content to preserve it
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.logger.error('[FollowingBackupService] No pubkey found');
        return false;
      }

      const currentEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.Contacts);
      const content = currentEvent?.content || '';

      // Publish the merged list
      const mergedEvent = await this.publishFollowingList(mergedList, content);

      if (mergedEvent) {
        this.logger.info('[FollowingBackupService] Backup merged successfully');
        return true;
      }

      return false;
    } catch (e) {
      this.logger.error('[FollowingBackupService] Failed to merge backup', e);
      return false;
    }
  }

  /**
   * Publish a following list event
   */
  private async publishFollowingList(pubkeys: string[], content: string): Promise<Event | null> {
    const account = this.accountState.account();
    if (!account) {
      this.logger.error('[FollowingBackupService] No account found');
      return null;
    }

    // Create tags for all followed pubkeys
    const tags: string[][] = pubkeys.map(pubkey => ['p', pubkey]);

    // Create the event
    const event = this.nostrService.createEvent(
      kinds.Contacts,
      content,
      tags
    );

    // Sign and publish
    const result = await this.nostrService.signAndPublish(event);

    if (result.success && result.event) {
      this.logger.info('[FollowingBackupService] Published following list event', {
        count: pubkeys.length,
        eventId: result.event.id
      });
      return result.event;
    }

    this.logger.error('[FollowingBackupService] Failed to publish following list event');
    return null;
  }

  /**
   * Helper to compare two arrays
   */
  private areArraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  }

  /**
   * Delete a backup
   */
  deleteBackup(backupId: string): boolean {
    try {
      const backups = this.getBackups();
      const filtered = backups.filter(b => b.id !== backupId);

      if (filtered.length === backups.length) {
        this.logger.warn('[FollowingBackupService] Backup not found', backupId);
        return false;
      }

      this.localStorage.setItem(this.BACKUP_KEY, JSON.stringify(filtered));
      this.backups.set([...filtered]);
      this.logger.info('[FollowingBackupService] Backup deleted', backupId);
      return true;
    } catch (e) {
      this.logger.error('[FollowingBackupService] Failed to delete backup', e);
      return false;
    }
  }

  /**
   * Clear all backups
   */
  clearAllBackups(): void {
    this.localStorage.removeItem(this.BACKUP_KEY);
    this.backups.set([]);
    this.logger.info('[FollowingBackupService] All backups cleared');
  }

  /**
   * Generate a backup ID that works in all environments
   * Uses crypto.randomUUID when available, falls back to secure random generation
   */
  private generateBackupId(): string {
    // Modern browsers with crypto.randomUUID
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // Fallback with crypto.getRandomValues if available (more secure than Math.random)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      // Convert to hex string
      const hex = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
      return `backup-${hex}`;
    }

    // Last resort fallback for very old browsers or non-secure contexts
    const timestamp = Date.now();
    const random1 = Math.random().toString(36).substring(2, 15);
    const random2 = Math.random().toString(36).substring(2, 15);
    const random3 = Math.random().toString(36).substring(2, 15);
    return `backup-${timestamp}-${random1}${random2}${random3}`;
  }
}
