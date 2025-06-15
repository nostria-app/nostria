import { Injectable, signal, computed } from '@angular/core';
import { NostrRecord } from '../interfaces';
import { inject } from '@angular/core';
import { NotificationService } from './notification.service';
import { NotificationType } from './storage.service';
import { UserRelayService } from './user-relay.service';
import { kinds } from 'nostr-tools';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class ProfileStateService {
  private logger = inject(LoggerService);
  
  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);

  notes = signal<NostrRecord[]>([]);

  replies = signal<NostrRecord[]>([]);

  articles = signal<NostrRecord[]>([]);

  media = signal<NostrRecord[]>([]);

  relay: UserRelayService | null = null;

  // Current profile pubkey
  currentProfilePubkey = signal<string>('');

  // Loading states
  isLoadingMoreNotes = signal<boolean>(false);
  hasMoreNotes = signal<boolean>(true);
  
  private notificationService = inject(NotificationService);

  constructor() { }

  // setFollowingList(list: string[]): void {
  //   this.followingList.set(list);
  // }

  setCurrentProfilePubkey(pubkey: string): void {
    this.reset();
    this.currentProfilePubkey.set(pubkey);
  }

  reset() {
    this.followingList.set([]);
    this.notes.set([]);
    this.replies.set([]);
    this.articles.set([]);
    this.media.set([]);
    this.hasMoreNotes.set(true);
  }

  // Computed signals for sorted data
  sortedNotes = computed(() => 
    [...this.notes()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  sortedReplies = computed(() => 
    [...this.replies()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  sortedArticles = computed(() => 
    [...this.articles()].sort((a, b) => b.event.created_at - a.event.created_at)
  );

  /**
   * Load more notes for the current profile
   * @param beforeTimestamp - Load notes before this timestamp
   */
  async loadMoreNotes(beforeTimestamp?: number): Promise<NostrRecord[]> {
    if (this.isLoadingMoreNotes() || !this.hasMoreNotes() || !this.relay) {
      return [];
    }

    this.isLoadingMoreNotes.set(true);
    const pubkey = this.currentProfilePubkey();

    let foundAnything = false;
    
    try {
      const currentNotes = this.notes();
      const oldestTimestamp = beforeTimestamp || 
        (currentNotes.length > 0 
          ? Math.min(...currentNotes.map(n => n.event.created_at)) - 1 
          : Math.floor(Date.now() / 1000));

      this.logger.debug(`Loading more notes for ${pubkey}, before timestamp: ${oldestTimestamp}`);

      return new Promise<NostrRecord[]>((resolve) => {
        const newNotes: NostrRecord[] = [];
        
        this.relay!.subscribeEose([{
          kinds: [kinds.ShortTextNote],
          authors: [pubkey],
          until: oldestTimestamp,
          limit: 10
        }], (event) => {

          foundAnything = true;

          // Check if this is a root post (not a reply)
          const isRootPost = !event.tags.some(tag => tag[0] === 'e');
          
          if (isRootPost) {
            // Create a NostrRecord - assuming this structure based on existing code
            const record: NostrRecord = {
              event: event,
              data: event.content // Adjust this based on your actual NostrRecord structure
            };
            
            // Check if we already have this note to avoid duplicates
            const existingNotes = this.notes();
            const exists = existingNotes.some(n => n.event.id === event.id);
            
            if (!exists) {
              newNotes.push(record);
            }
          }
        }, () => {
          // EOSE callback - subscription finished
          this.logger.debug(`Loaded ${newNotes.length} more notes`);
          
          // One relay might say there are no more events, but another might have some, so
          // they will set the flag back to true if we found any new notes.
          if (!foundAnything) {
            debugger;
            this.hasMoreNotes.set(false);
          } else {
            // Add new notes to the existing ones
            this.notes.update(existing => [...existing, ...newNotes]);
            this.hasMoreNotes.set(true);
          }
          
          this.isLoadingMoreNotes.set(false);
          resolve(newNotes);
        });
      });
    } catch (error) {
      this.logger.error('Failed to load more notes:', error);
      this.isLoadingMoreNotes.set(false);
      return [];
    }
  }
}