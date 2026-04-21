import { Component, computed, inject, input, signal, ElementRef, ViewChild, AfterViewInit, effect, untracked, ChangeDetectionStrategy } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Event } from 'nostr-tools';
import { CommentComponent } from '../comment/comment.component';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';
import { SharedRelayService } from '../../services/relays/shared-relay';

export type CommentKindFilter = 'nip22' | 'nip10' | 'all';

// Interface for threaded comments
export interface CommentThread {
  comment: NostrRecord;
  replies: CommentThread[];
  depth: number;
}

@Component({
  selector: 'app-comments-list',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatButtonToggleModule,
    CommentComponent
  ],
  templateUrl: './comments-list.component.html',
  styleUrl: './comments-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentsListComponent implements AfterViewInit {
  event = input.required<Event>();
  autoExpand = input<boolean>(false);
  label = input<string>('Comments');
  singularLabel = input<string>('Comment');
  allowedKinds = input<number[]>([1111]);
  replyType = input<'text' | 'audio'>('text');
  /** Whether to show the kind filter toggle (replies vs comments vs all) */
  showKindFilter = input<boolean>(true);

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

  /** Current kind filter for comment display */
  commentKindFilter = signal<CommentKindFilter>('all');

  /** Effective kinds to query based on the current filter */
  private effectiveKinds = computed(() => {
    const filter = this.commentKindFilter();
    const base = this.allowedKinds();
    switch (filter) {
      case 'nip22': return base.filter(k => k !== 1); // Only NIP-22 kinds (1111, 1244, etc.)
      case 'nip10': return [1];
      case 'all': return [...new Set([...base, 1])];
    }
  });

  private readonly INITIAL_LIMIT = 30;
  private readonly LOAD_MORE_LIMIT = 20;
  private oldestCommentTimestamp: number | null = null;

  // Computed count of comments
  commentCount = computed(() => this.comments().length);

  // Build threaded comment tree from flat list
  commentThreads = computed(() => this.buildThreadTree(this.comments()));

  /** Track optimistically added event IDs so refreshComments preserves them */
  private optimisticEventIds = new Set<string>();

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
          this.isExpanded.set(true);
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

    // Set up scroll listener for infinite scroll (passive for smoother scrolling)
    if (this.commentsContainer) {
      const container = this.commentsContainer.nativeElement;
      container.addEventListener('scroll', this.onScroll, { passive: true });
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

  private onScroll = (): void => {
    if (!this.commentsContainer) return;

    const container = this.commentsContainer.nativeElement;
    const scrollPosition = container.scrollTop + container.clientHeight;
    const scrollHeight = container.scrollHeight;

    // Load more when scrolled to within 200px of bottom
    if (scrollPosition >= scrollHeight - 200 && !this.isLoadingMore() && this.hasMore()) {
      this.loadMoreComments();
    }
  };

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
      // For regular events, query by both 'e' and 'E' tags
      const isAddressable = event.kind >= 30000 && event.kind < 40000;
      const filter: Record<string, unknown> = {
        kinds: this.effectiveKinds(),
        limit: this.INITIAL_LIMIT,
      };

      if (isAddressable) {
        // Get the 'd' tag (identifier) for addressable events
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;
        filter['#A'] = [aTagValue];
      } else {
        // Regular events use event ID in both tag variants
        const uppercaseEventTagFilter: Record<string, unknown> = {
          ...filter,
          '#E': [event.id],
        };

        const [lowercaseTagComments, uppercaseTagComments] = await Promise.all([
          this.sharedRelay.getMany(userPubkey, {
            ...filter,
            '#e': [event.id],
          }),
          this.sharedRelay.getMany(userPubkey, uppercaseEventTagFilter),
        ]);

        const dedupedById = new Map<string, Event>();
        for (const commentEvent of [...lowercaseTagComments, ...uppercaseTagComments]) {
          dedupedById.set(commentEvent.id, commentEvent);
        }

        const commentEvents = Array.from(dedupedById.values());

        if (commentEvents.length === 0) {
          this.hasMore.set(false);
          this.hasLoadedInitial.set(true);
          this.isLoading.set(false);
          return;
        }

        const commentRecords = commentEvents.map((e) => this.data.toRecord(e));
        commentRecords.sort((a, b) => a.event.created_at - b.event.created_at);

        if (commentRecords.length > 0) {
          this.oldestCommentTimestamp = commentRecords[0].event.created_at;
        }

        const reachedLimit = lowercaseTagComments.length >= this.INITIAL_LIMIT || uppercaseTagComments.length >= this.INITIAL_LIMIT;
        this.hasMore.set(reachedLimit);

        this.comments.set(commentRecords);
        this.hasLoadedInitial.set(true);
        return;
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
        kinds: this.effectiveKinds(),
        until: this.oldestCommentTimestamp - 1,
        limit: this.LOAD_MORE_LIMIT,
      };

      if (isAddressable) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;
        filter['#A'] = [aTagValue];
      } else {
        const uppercaseEventTagFilter: Record<string, unknown> = {
          ...filter,
          '#E': [event.id],
        };

        const [lowercaseTagComments, uppercaseTagComments] = await Promise.all([
          this.sharedRelay.getMany(userPubkey, {
            ...filter,
            '#e': [event.id],
          }),
          this.sharedRelay.getMany(userPubkey, uppercaseEventTagFilter),
        ]);

        const dedupedById = new Map<string, Event>();
        for (const commentEvent of [...lowercaseTagComments, ...uppercaseTagComments]) {
          dedupedById.set(commentEvent.id, commentEvent);
        }

        const commentEvents = Array.from(dedupedById.values());

        if (commentEvents.length === 0) {
          this.hasMore.set(false);
          this.isLoadingMore.set(false);
          return;
        }

        const newComments = commentEvents.map((e) => this.data.toRecord(e));

        if (newComments.length > 0) {
          const oldestNew = Math.min(...newComments.map((c) => c.event.created_at));
          this.oldestCommentTimestamp = oldestNew;
        }

        const reachedLimit = lowercaseTagComments.length >= this.LOAD_MORE_LIMIT || uppercaseTagComments.length >= this.LOAD_MORE_LIMIT;
        this.hasMore.set(reachedLimit);

        const allComments = [...newComments, ...this.comments()];
        const dedupedComments = new Map<string, NostrRecord>();
        for (const comment of allComments) {
          dedupedComments.set(comment.event.id, comment);
        }

        const mergedComments = Array.from(dedupedComments.values());
        mergedComments.sort((a, b) => a.event.created_at - b.event.created_at);
        this.comments.set(mergedComments);
        return;
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
      const result = await this.eventService.createComment(this.event());

      // Handle dialog result
      if (result?.published && result.event) {
        this.addCommentToList(result.event);
      }
    }
  }

  private addCommentToList(event: Event) {
    // Track this as an optimistic event
    this.optimisticEventIds.add(event.id);

    // Immediately add the new comment to the list (optimistic update)
    const newCommentRecord = this.data.toRecord(event);
    const currentComments = this.comments();

    // Deduplicate
    if (currentComments.some(c => c.event.id === event.id)) return;

    const updatedComments = [...currentComments, newCommentRecord];

    // Sort by created_at (oldest first for display)
    updatedComments.sort((a, b) => a.event.created_at - b.event.created_at);

    this.comments.set(updatedComments);
  }

  // Handle reply added from nested comment component
  onCommentReplyAdded(event: Event): void {
    this.addCommentToList(event);
  }

  async refreshComments(): Promise<void> {
    // Save optimistic events before clearing
    const optimistic = this.comments().filter(c => this.optimisticEventIds.has(c.event.id));

    this.hasLoadedInitial.set(false);
    this.oldestCommentTimestamp = null;
    this.comments.set([]);
    this.hasMore.set(true);
    await this.loadComments();

    // Merge back any optimistic events that weren't returned in the fetch
    if (optimistic.length > 0) {
      const currentIds = new Set(this.comments().map(c => c.event.id));
      const missing = optimistic.filter(c => !currentIds.has(c.event.id));
      if (missing.length > 0) {
        const merged = [...this.comments(), ...missing];
        merged.sort((a, b) => a.event.created_at - b.event.created_at);
        this.comments.set(merged);
      }
    }
  }

  /** Switch the kind filter and reload comments */
  onKindFilterChange(filter: CommentKindFilter): void {
    this.commentKindFilter.set(filter);
    this.refreshComments();
  }

  /**
   * Build a threaded tree structure from flat list of comments.
   * Handles both NIP-22 (kind 1111) and NIP-10 (kind 1) threading.
   * NIP-22: root tags (E/A/I) and parent tags (e/a/i) point to same value for top-level
   * NIP-10: e tags with root/reply markers for kind 1 threading
   */
  private buildThreadTree(comments: NostrRecord[]): CommentThread[] {
    if (comments.length === 0) return [];

    const rootEvent = this.event();
    const rootEventId = rootEvent.id;

    // For addressable events, also check the A tag format
    const isAddressable = rootEvent.kind >= 30000 && rootEvent.kind < 40000;
    const dTag = rootEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';
    const aTagValue = isAddressable ? `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}` : null;

    // Create a map of comment ID to thread node
    const threadMap = new Map<string, CommentThread>();

    // Initialize all threads
    for (const comment of comments) {
      threadMap.set(comment.event.id, {
        comment,
        replies: [],
        depth: 0
      });
    }

    // Build the tree by finding parent relationships
    const rootThreads: CommentThread[] = [];

    for (const comment of comments) {
      const thread = threadMap.get(comment.event.id)!;
      const parentInfo = this.getParentCommentId(comment.event, rootEventId, aTagValue);

      if (parentInfo.isTopLevel) {
        // This is a top-level comment on the root event
        thread.depth = 0;
        rootThreads.push(thread);
      } else if (parentInfo.parentCommentId) {
        // This is a reply to another comment
        const parentThread = threadMap.get(parentInfo.parentCommentId);
        if (parentThread) {
          thread.depth = parentThread.depth + 1;
          parentThread.replies.push(thread);
        } else {
          // Parent not found (might not be loaded yet), treat as top-level
          thread.depth = 0;
          rootThreads.push(thread);
        }
      } else {
        // Couldn't determine parent, treat as top-level
        thread.depth = 0;
        rootThreads.push(thread);
      }
    }

    // Sort each level by created_at (oldest first)
    const sortReplies = (threads: CommentThread[]) => {
      threads.sort((a, b) => a.comment.event.created_at - b.comment.event.created_at);
      for (const thread of threads) {
        sortReplies(thread.replies);
      }
    };

    sortReplies(rootThreads);

    return rootThreads;
  }

  /**
   * Determine the parent comment ID for a given comment event.
   * Handles both NIP-22 (kind 1111) and NIP-10 (kind 1) threading.
   */
  private getParentCommentId(
    commentEvent: Event,
    rootEventId: string,
    aTagValue: string | null
  ): { isTopLevel: boolean; parentCommentId?: string } {
    const tags = commentEvent.tags;

    // Handle NIP-10 kind 1 threading
    if (commentEvent.kind === 1) {
      return this.getParentFromNip10(tags, rootEventId);
    }

    // Handle NIP-22 kind 1111+ threading
    const parentKindTag = tags.find(tag => tag[0] === 'k');
    const parentKind = parentKindTag?.[1];

    // If parent kind is 1111 (or another comment kind), it's a reply to another comment
    if (parentKind === '1111' || parentKind === '1244') {
      const parentETag = tags.find(tag => tag[0] === 'e');
      if (parentETag && parentETag[1]) {
        return { isTopLevel: false, parentCommentId: parentETag[1] };
      }
    }

    // Check if this is a top-level comment by comparing root and parent references
    const rootETag = tags.find(tag => tag[0] === 'E');
    const parentETag = tags.find(tag => tag[0] === 'e');
    const rootATag = tags.find(tag => tag[0] === 'A');
    const parentATag = tags.find(tag => tag[0] === 'a');

    if (rootETag && parentETag && rootETag[1] === parentETag[1]) {
      return { isTopLevel: true };
    }

    if (rootATag && parentATag && rootATag[1] === parentATag[1]) {
      return { isTopLevel: true };
    }

    if (parentETag && parentETag[1] === rootEventId) {
      return { isTopLevel: true };
    }

    if (aTagValue && parentATag && parentATag[1] === aTagValue) {
      return { isTopLevel: true };
    }

    if (parentETag && parentETag[1] && (parentKind === '1111' || parentKind === '1244')) {
      return { isTopLevel: false, parentCommentId: parentETag[1] };
    }

    return { isTopLevel: true };
  }

  /**
   * Parse NIP-10 threading from kind 1 events.
   * Looks for e tags with root/reply markers or uses positional convention.
   */
  private getParentFromNip10(
    tags: string[][],
    rootEventId: string
  ): { isTopLevel: boolean; parentCommentId?: string } {
    const eTags = tags.filter(tag => tag[0] === 'e');
    if (eTags.length === 0) return { isTopLevel: true };

    // Preferred: NIP-10 marked tags
    const rootTag = eTags.find(t => t[3] === 'root');
    const replyTag = eTags.find(t => t[3] === 'reply');

    if (rootTag && replyTag) {
      // Has explicit root and reply markers
      if (replyTag[1] === rootEventId) {
        // Replying directly to the root event
        return { isTopLevel: true };
      }
      return { isTopLevel: false, parentCommentId: replyTag[1] };
    }

    if (rootTag && !replyTag) {
      // Only root marker = direct reply to root
      if (rootTag[1] === rootEventId) {
        return { isTopLevel: true };
      }
      // Root points elsewhere, but this event references our root event
      return { isTopLevel: true };
    }

    // Fallback: positional convention (deprecated but still used)
    // First e tag = root, last e tag = reply (if different)
    if (eTags.length === 1) {
      // Single e tag - direct reply to that event
      if (eTags[0][1] === rootEventId) {
        return { isTopLevel: true };
      }
      return { isTopLevel: false, parentCommentId: eTags[0][1] };
    }

    // Multiple e tags without markers: first=root, last=reply
    const firstETag = eTags[0];
    const lastETag = eTags[eTags.length - 1];

    if (lastETag[1] === rootEventId || lastETag[1] === firstETag[1]) {
      return { isTopLevel: true };
    }

    return { isTopLevel: false, parentCommentId: lastETag[1] };
  }
}
