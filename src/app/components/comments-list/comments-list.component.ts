import { Component, computed, inject, input, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CommentComponent,
  ],
  templateUrl: './comments-list.component.html',
  styleUrl: './comments-list.component.scss',
})
export class CommentsListComponent implements AfterViewInit {
  event = input.required<Event>();

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

  private readonly INITIAL_LIMIT = 30;
  private readonly LOAD_MORE_LIMIT = 20;
  private oldestCommentTimestamp: number | null = null;
  private hasLoadedInitial = false;

  // Computed count of comments
  commentCount = computed(() => this.comments().length);

  ngAfterViewInit(): void {
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
    if (!wasExpanded && !this.hasLoadedInitial) {
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
    if (!event || this.hasLoadedInitial) return;

    this.isLoading.set(true);

    try {
      const userPubkey = this.accountState.pubkey();
      if (!userPubkey) {
        this.isLoading.set(false);
        return;
      }

      // Query for initial batch of comments (most recent 30)
      const commentEvents = await this.sharedRelay.getMany(userPubkey, {
        kinds: [1111],
        '#e': [event.id],
        limit: this.INITIAL_LIMIT,
      });

      if (!commentEvents || commentEvents.length === 0) {
        this.hasMore.set(false);
        this.hasLoadedInitial = true;
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
      this.hasLoadedInitial = true;
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

      // Query for older comments using until timestamp
      const commentEvents = await this.sharedRelay.getMany(userPubkey, {
        kinds: [1111],
        '#e': [event.id],
        until: this.oldestCommentTimestamp - 1, // Get events before the oldest we have
        limit: this.LOAD_MORE_LIMIT,
      });

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

    // Open comment creation dialog
    this.eventService.createComment(this.event());

    // Refresh comments after dialog closes (to show new comment)
    // We'll wait a bit for the event to propagate through relays
    setTimeout(() => {
      this.refreshComments();
    }, 1000);
  }

  async refreshComments(): Promise<void> {
    // Reset state and reload
    this.hasLoadedInitial = false;
    this.oldestCommentTimestamp = null;
    this.comments.set([]);
    this.hasMore.set(true);
    await this.loadComments();
  }
}
