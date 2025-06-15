import { Injectable, signal, computed } from '@angular/core';
import { NostrRecord } from '../interfaces';
import { inject } from '@angular/core';
import { NotificationService } from './notification.service';
import { NotificationType } from './storage.service';
import { UserRelayService } from './user-relay.service';

@Injectable({
  providedIn: 'root'
})
export class ProfileStateService {
  // Signal to store the current profile's following list
  followingList = signal<string[]>([]);

  notes = signal<NostrRecord[]>([]);

  replies = signal<NostrRecord[]>([]);

  articles = signal<NostrRecord[]>([]);

  media = signal<NostrRecord[]>([]);

  relay: UserRelayService | null = null;

  // Current profile pubkey
  currentProfilePubkey = signal<string>('');

  private notificationService = inject(NotificationService);

  constructor() { }

  // setFollowingList(list: string[]): void {
  //   this.followingList.set(list);
  // }

  setCurrentProfilePubkey(pubkey: string): void {
    this.reset();
    this.currentProfilePubkey.set(pubkey);

    // Notify when a profile is loaded (example usage of notification service)
    // if (pubkey) {
    //   this.notificationService.notify(
    //     'Profile Loaded',
    //     `Successfully loaded profile information for ${pubkey.substring(0, 8)}...`,
    //     NotificationType.SUCCESS
    //   );
    // }
  }

  reset() {
    this.followingList.set([]);
    this.notes.set([]);
    this.replies.set([]);
    this.articles.set([]);
    this.media.set([]);
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
}