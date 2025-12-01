import { Component, computed, inject, input, signal, ElementRef, ViewChild, AfterViewInit, effect, untracked } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';
import { CommentComponent } from '../comment/comment.component';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';
import { SharedRelayService } from '../../services/relays/shared-relay';

@Component({
  selector: 'app-comments-list',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    CommentComponent
],
  templateUrl: './comments-list.component.html',
  styleUrl: './comments-list.component.scss',
})
export class CommentsListComponent implements AfterViewInit {
  event = input.required<Event>();
  autoExpand = input<boolean>(false);
  label = input<string>('Comments');
  singularLabel = input<string>('Comment');
  allowedKinds = input<number[]>([1111]);
  replyType = input<'text' | 'audio'>('text');

  @ViewChild('commentsContainer') commentsContainer?: ElementRef<HTMLElement>;

  private data = inject(DataService);
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private eventService = inject(EventService);
  private sharedRelay = inject(SharedRelayService);

  comments = signal<NostrRecord[]>([]);
  isLoading = signal(false);
  isLoadingMore = signal(false);
  isExpanded = signal(false);
  hasMore = signal(true);
  hasLoadedInitial = signal(false);

  private readonly INITIAL_LIMIT = 30;
  private readonly LOAD_MORE_LIMIT = 20;
  private oldestCommentTimestamp: number | null = null;

  // Computed count of comments
  commentCount = computed(() => this.comments().length);

  constructor() {
    // Reset and reload comments when event changes
    effect(() => {
      const event = this.event(); // Track event changes
      const autoExpand = this.autoExpand(); // Track autoExpand

      // Use untracked to prevent infinite loops when updating signals
      untracked(() => {
        // Reset state
        this.comments.set([]);
        this.hasLoadedInitial.set(false);
        this.hasMore.set(true);
        this.oldestCommentTimestamp = null;

        // Reload comments if auto-expanded
        if (autoExpand && event) {
          this.loadComments();
        }
      });
    });
  }

  ngAfterViewInit(): void {
    // Auto-expand if requested
    if (this.autoExpand()) {
      this.isExpanded.set(true);
      // Comments will be loaded by the effect in constructor
    }

    // Set up scroll listener for infinite scroll
    if (this.commentsContainer) {
      const container = this.commentsContainer.nativeElement;
      container.addEventListener('scroll', this.onScroll.bind(this));
    }
  }

  async toggleComments(): Promise<void> {
    const wasExpanded = this.isExpanded();
    this.isExpanded.update((v) => !v);

    // Load initial comments when expanding for the first time
    if (!wasExpanded && !this.hasLoadedInitial()) {
      await this.loadComments();
    }
  }

  private onScroll(): void {
    if (!this.commentsContainer) return;

    const container = this.commentsContainer.nativeElement;
    const scrollPosition = container.scrollTop + container.clientHeight;
    const scrollHeight = container.scrollHeight;

    // Load more when scrolled to within 200px of bottom
    if (scrollPosition >= scrollHeight - 200 && !this.isLoadingMore() && this.hasMore()) {
      this.loadMoreComments();
    }
  }

  async loadComments(): Promise<void> {
    const event = this.event();
    if (!event || this.hasLoadedInitial()) return;

    this.isLoading.set(true);

    try {
      const userPubkey = this.accountState.pubkey();
      if (!userPubkey) {
        this.isLoading.set(false);
        return;
      }

      // Determine filter based on event kind
      // For addressable events (like articles, kind 30023), query by 'A' tag
      // For regular events, query by 'e' tag
      const isAddressable = event.kind >= 30000 && event.kind < 40000;
      const filter: Record<string, unknown> = {
        kinds: this.allowedKinds(),
        limit: this.INITIAL_LIMIT,
      };

      if (isAddressable) {
        // Get the 'd' tag (identifier) for addressable events
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;
        filter['#A'] = [aTagValue];
      } else {
        // Regular events use event ID
        filter['#e'] = [event.id];
      }

      // Query for initial batch of comments (most recent 30)
      const commentEvents = await this.sharedRelay.getMany(userPubkey, filter);

      if (!commentEvents || commentEvents.length === 0) {
        this.hasMore.set(false);
        this.hasLoadedInitial.set(true);
        this.isLoading.set(false);
        return;
      }

      // Convert to records
      const commentRecords = commentEvents.map((e) => this.data.toRecord(e));

      // Sort by created_at (oldest first for display)
      commentRecords.sort((a, b) => a.event.created_at - b.event.created_at);

      // Track oldest timestamp for pagination
      if (commentRecords.length > 0) {
        this.oldestCommentTimestamp = commentRecords[0].event.created_at;
      }

      // Set hasMore based on whether we got the full limit
      this.hasMore.set(commentEvents.length >= this.INITIAL_LIMIT);

      this.comments.set(commentRecords);
      this.hasLoadedInitial.set(true);
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMoreComments(): Promise<void> {
    const event = this.event();
    if (!event || this.isLoadingMore() || !this.hasMore() || this.oldestCommentTimestamp === null) {
      return;
    }

    this.isLoadingMore.set(true);

    try {
      const userPubkey = this.accountState.pubkey();
      if (!userPubkey) {
        this.isLoadingMore.set(false);
        return;
      }

      // Determine filter based on event kind
      const isAddressable = event.kind >= 30000 && event.kind < 40000;
      const filter: Record<string, unknown> = {
        kinds: [1111],
        until: this.oldestCommentTimestamp - 1,
        limit: this.LOAD_MORE_LIMIT,
      };

      if (isAddressable) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;
        filter['#A'] = [aTagValue];
      } else {
        filter['#e'] = [event.id];
      }

      // Query for older comments using until timestamp
      const commentEvents = await this.sharedRelay.getMany(userPubkey, filter);

      if (!commentEvents || commentEvents.length === 0) {
        this.hasMore.set(false);
        this.isLoadingMore.set(false);
        return;
      }

      // Convert to records
      const newComments = commentEvents.map((e) => this.data.toRecord(e));

      // Update oldest timestamp
      if (newComments.length > 0) {
        const oldestNew = Math.min(...newComments.map((c) => c.event.created_at));
        this.oldestCommentTimestamp = oldestNew;
      }

      // Check if we got fewer than requested (means no more)
      this.hasMore.set(commentEvents.length >= this.LOAD_MORE_LIMIT);

      // Prepend new comments (they're older, so go at the beginning)
      const allComments = [...newComments, ...this.comments()];
      allComments.sort((a, b) => a.event.created_at - b.event.created_at);
      this.comments.set(allComments);
    } catch (error) {
      console.error('Failed to load more comments:', error);
    } finally {
      this.isLoadingMore.set(false);
    }
  }

  async onAddComment(): Promise<void> {
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) {
      await this.layout.showLoginDialog();
      return;
    }

    if (this.replyType() === 'audio') {
      const event = await this.eventService.createAudioReply(this.event());
      if (event) {
        this.addCommentToList(event);
      }
    } else {
      // Open comment creation dialog
      const dialogRef = this.eventService.createComment(this.event());

      // Handle dialog result
      dialogRef.afterClosed().subscribe((result: { published: boolean; event?: Event } | undefined) => {
        if (result?.published && result.event) {
          this.addCommentToList(result.event);
        }
      });
    }
  }

  private addCommentToList(event: Event) {
    // Immediately add the new comment to the list (optimistic update)
    const newCommentRecord = this.data.toRecord(event);
    const currentComments = this.comments();
    const updatedComments = [...currentComments, newCommentRecord];

    // Sort by created_at (oldest first for display)
    updatedComments.sort((a, b) => a.event.created_at - b.event.created_at);

    this.comments.set(updatedComments);

    // Optionally refresh after a delay to catch any other new comments
    setTimeout(() => {
      this.refreshComments();
    }, 2000);
  }

  async refreshComments(): Promise<void> {
    // Reset state and reload
    this.hasLoadedInitial.set(false);
    this.oldestCommentTimestamp = null;
    this.comments.set([]);
    this.hasMore.set(true);
    await this.loadComments();
  }
}
