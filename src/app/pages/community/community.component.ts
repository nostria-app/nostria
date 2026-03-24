import { Component, inject, signal, computed, OnDestroy, OnInit, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Event, nip19 } from 'nostr-tools';
import { CommunityService, Community, COMMUNITY_DEFINITION_KIND } from '../../services/community.service';
import { CommunityListService } from '../../services/community-list.service';
import { ApplicationService } from '../../services/application.service';
import { AccountStateService } from '../../services/account-state.service';
import { NostrService } from '../../services/nostr.service';
import { ReactionService } from '../../services/reaction.service';
import { EventService, type ReactionEvents } from '../../services/event';
import { LayoutService } from '../../services/layout.service';
import { EventActionsToolbarComponent } from '../../components/event-actions-toolbar/event-actions-toolbar.component';
import { EventHeaderComponent } from '../../components/event/header/header.component';
import { ContentComponent } from '../../components/content/content.component';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-community',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatChipsModule,
    MatTabsModule,
    MatDividerModule,
    MatMenuModule,
    RouterLink,
    EventActionsToolbarComponent,
    EventHeaderComponent,
    ContentComponent,
    UserProfileComponent,
  ],
  templateUrl: './community.component.html',
  styleUrls: ['./community.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private communityService = inject(CommunityService);
  private communityListService = inject(CommunityListService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private nostrService = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private reactionService = inject(ReactionService);
  private eventService = inject(EventService);
  private layout = inject(LayoutService);

  /** Community event passed via router state for instant rendering */
  private routerStateEvent: Event | undefined;
  /** Current naddr for building links */
  currentNaddr = signal('');

  community = signal<Community | null>(null);
  loading = signal(true);
  loadingPosts = signal(true);

  // Posts
  allPosts = signal<Event[]>([]);
  private postMap = new Map<string, Event>();

  // Approvals
  allApprovals = signal<Event[]>([]);
  private approvalMap = new Map<string, Event>();

  // Tab state
  selectedTab = signal(0);

  // Show approved only filter
  showApprovedOnly = signal(false);

  // Post editing state
  editingPostId = signal<string | null>(null);
  editContent = signal('');
  savingEdit = signal(false);

  // Vote state per post
  postReactions = signal<Map<string, ReactionEvents>>(new Map());
  votingPostIds = signal<Set<string>>(new Set());

  private postsSub: { close: () => void } | null = null;
  private approvalsSub: { close: () => void } | null = null;

  constructor() {
    // Capture router state in constructor - it's only available during navigation
    const navigation = this.router.getCurrentNavigation();
    const stateEvent = navigation?.extras?.state?.['communityEvent'] as Event | undefined;
    if (stateEvent) {
      this.routerStateEvent = stateEvent;
    }
  }

  isAuthenticated = computed(() => this.app.authenticated());
  currentPubkey = computed(() => this.accountState.pubkey());

  // Check if current user is the owner
  isOwner = computed(() => {
    const comm = this.community();
    const pubkey = this.currentPubkey();
    if (!comm || !pubkey) return false;
    return comm.creatorPubkey === pubkey;
  });

  // Check if current user is a moderator
  isModerator = computed(() => {
    const comm = this.community();
    const pubkey = this.currentPubkey();
    if (!comm || !pubkey) return false;
    return comm.creatorPubkey === pubkey ||
      comm.moderators.some(m => m.pubkey === pubkey);
  });

  // Check if current user has joined this community
  isJoined = computed(() => {
    const comm = this.community();
    if (!comm) return false;
    return this.communityListService.isCommunityInList(comm.coordinate);
  });

  // Sorted posts (newest first), optionally filtered by approval status
  sortedPosts = computed(() => {
    const posts = this.allPosts();
    const approvals = this.allApprovals();
    const comm = this.community();
    const approvedOnly = this.showApprovedOnly();

    let filtered = posts;

    if (approvedOnly && comm) {
      filtered = posts.filter(post => {
        // Creator's posts are always visible
        if (post.pubkey === comm.creatorPubkey) return true;
        // Check for moderator approval
        return this.communityService.isApprovedByModerator(
          approvals,
          [...comm.moderators, { pubkey: comm.creatorPubkey }],
          post.id
        );
      });
    }

    // Only show top-level posts (not replies)
    filtered = filtered.filter(post => {
      // Kind 1111 top-level posts have lowercase 'a' pointing to community
      const hasLowercaseA = post.tags.some(t => t[0] === 'a' && t[1]?.startsWith('34550:'));
      const hasReplyE = post.tags.some(t => t[0] === 'e');
      // If it has an 'e' tag, it's a reply (for kind 1111)
      if (post.kind === 1111) {
        return !hasReplyE || hasLowercaseA;
      }
      // For legacy kind 1, just check no reply markers
      const hasRootTag = post.tags.some(t => t[0] === 'e' && t[3] === 'root');
      return !hasRootTag;
    });

    return filtered.sort((a, b) => b.created_at - a.created_at);
  });

  // Count of approved posts
  approvedCount = computed(() => {
    const posts = this.allPosts();
    const approvals = this.allApprovals();
    const comm = this.community();
    if (!comm) return 0;

    return posts.filter(post =>
      post.pubkey === comm.creatorPubkey ||
      this.communityService.isApprovedByModerator(
        approvals,
        [...comm.moderators, { pubkey: comm.creatorPubkey }],
        post.id
      )
    ).length;
  });

  ngOnInit(): void {
    const naddrParam = this.route.snapshot.paramMap.get('naddr');
    if (naddrParam) {
      this.currentNaddr.set(naddrParam);
      this.loadCommunityFromNaddr(naddrParam);
    }
  }

  ngOnDestroy(): void {
    this.postsSub?.close();
    this.approvalsSub?.close();
  }

  /** Get the title of a post from its subject tag or first line of content */
  getPostTitle(post: Event): string {
    const subject = post.tags.find(t => t[0] === 'subject')?.[1];
    if (subject) return subject;
    // Use first line of content as fallback title
    const firstLine = post.content.split('\n')[0];
    if (firstLine.length > 120) return firstLine.substring(0, 120) + '...';
    return firstLine;
  }

  /** Get the body text of a post (content after first line if no subject tag) */
  getPostBody(post: Event): string {
    const subject = post.tags.find(t => t[0] === 'subject')?.[1];
    if (subject) return post.content;
    // If no subject, the first line is used as title, return rest
    const lines = post.content.split('\n');
    if (lines.length <= 1) return '';
    return lines.slice(1).join('\n').trim();
  }

  /** Get URL images from url tags */
  getPostImages(post: Event): string[] {
    return post.tags
      .filter(t => t[0] === 'url' && t[1])
      .map(t => t[1])
      .filter(url => /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?|$)/i.test(url));
  }

  /** Get the link URL from r tag */
  getPostLink(post: Event): string | null {
    return post.tags.find(t => t[0] === 'r')?.[1] || null;
  }

  /** Navigate to create post page */
  navigateToCreatePost(): void {
    this.router.navigate(['/n', this.currentNaddr(), 'post']);
  }

  /** Start editing a post */
  startEdit(post: Event): void {
    this.editingPostId.set(post.id);
    this.editContent.set(post.content);
  }

  /** Cancel editing */
  cancelEdit(): void {
    this.editingPostId.set(null);
    this.editContent.set('');
  }

  /** Get the vote score (upvotes minus downvotes) for a post */
  getVoteScore(post: Event): number {
    const reactions = this.postReactions().get(post.id);
    if (!reactions) return 0;
    let score = 0;
    for (const record of reactions.events) {
      if (record.event.content === '+') score++;
      else if (record.event.content === '-') score--;
    }
    return score;
  }

  /** Get the current user's vote on a post: 'up', 'down', or null */
  getUserVote(post: Event): 'up' | 'down' | null {
    const pubkey = this.currentPubkey();
    if (!pubkey) return null;
    const reactions = this.postReactions().get(post.id);
    if (!reactions) return null;
    const userReaction = reactions.events.find(r => r.event.pubkey === pubkey);
    if (!userReaction) return null;
    if (userReaction.event.content === '+') return 'up';
    if (userReaction.event.content === '-') return 'down';
    return null;
  }

  /** Check if a post vote is in progress */
  isVoting(post: Event): boolean {
    return this.votingPostIds().has(post.id);
  }

  /** Load reactions for a post */
  async loadPostReactions(post: Event): Promise<void> {
    try {
      const reactions = await this.eventService.loadReactions(post.id, post.pubkey);
      const current = new Map(this.postReactions());
      current.set(post.id, reactions);
      this.postReactions.set(current);
    } catch (error) {
      this.logger.error('[Community] Error loading post reactions:', error);
    }
  }

  /** Upvote a post (NIP-25 '+' reaction) */
  async upvote(post: Event): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) {
      await this.layout.showLoginDialog();
      return;
    }

    const currentVote = this.getUserVote(post);
    this.setVoting(post.id, true);

    try {
      if (currentVote === 'up') {
        // Toggle off: delete the existing upvote
        const reactions = this.postReactions().get(post.id);
        const userReaction = reactions?.events.find(r => r.event.pubkey === pubkey && r.event.content === '+');
        if (userReaction) {
          await this.reactionService.deleteReaction(userReaction.event);
        }
      } else {
        if (currentVote === 'down') {
          // Remove existing downvote first
          const reactions = this.postReactions().get(post.id);
          const userReaction = reactions?.events.find(r => r.event.pubkey === pubkey && r.event.content === '-');
          if (userReaction) {
            await this.reactionService.deleteReaction(userReaction.event);
          }
        }
        await this.reactionService.addLike(post);
      }
      // Reload reactions to get fresh state
      await this.loadPostReactions(post);
    } catch (error) {
      this.logger.error('[Community] Error voting:', error);
      this.snackBar.open('Failed to vote', 'Close', { duration: 3000 });
    } finally {
      this.setVoting(post.id, false);
    }
  }

  /** Downvote a post (NIP-25 '-' reaction) */
  async downvote(post: Event): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) {
      await this.layout.showLoginDialog();
      return;
    }

    const currentVote = this.getUserVote(post);
    this.setVoting(post.id, true);

    try {
      if (currentVote === 'down') {
        // Toggle off: delete the existing downvote
        const reactions = this.postReactions().get(post.id);
        const userReaction = reactions?.events.find(r => r.event.pubkey === pubkey && r.event.content === '-');
        if (userReaction) {
          await this.reactionService.deleteReaction(userReaction.event);
        }
      } else {
        if (currentVote === 'up') {
          // Remove existing upvote first
          const reactions = this.postReactions().get(post.id);
          const userReaction = reactions?.events.find(r => r.event.pubkey === pubkey && r.event.content === '+');
          if (userReaction) {
            await this.reactionService.deleteReaction(userReaction.event);
          }
        }
        await this.reactionService.addDislike(post);
      }
      // Reload reactions to get fresh state
      await this.loadPostReactions(post);
    } catch (error) {
      this.logger.error('[Community] Error voting:', error);
      this.snackBar.open('Failed to vote', 'Close', { duration: 3000 });
    } finally {
      this.setVoting(post.id, false);
    }
  }

  private setVoting(postId: string, isVoting: boolean): void {
    const current = new Set(this.votingPostIds());
    if (isVoting) {
      current.add(postId);
    } else {
      current.delete(postId);
    }
    this.votingPostIds.set(current);
  }

  /** Save edited post — publishes a new kind 1111 post referencing the original */
  async saveEdit(post: Event): Promise<void> {
    const comm = this.community();
    if (!comm) return;

    const newContent = this.editContent().trim();
    if (!newContent) return;

    this.savingEdit.set(true);
    try {
      // Create an edit event (kind 1010-style) pointing to the original post
      // For community posts, we create a kind 1010 edit event with the 'e' tag
      const tags: string[][] = [
        ['e', post.id],
      ];

      const unsignedEvent = this.nostrService.createEvent(1010, newContent, tags);
      const result = await this.nostrService.signAndPublish(unsignedEvent);

      if (result.success) {
        // Optimistically update the post content in-place
        this.postMap.set(post.id, { ...post, content: newContent } as Event);
        this.allPosts.set(Array.from(this.postMap.values()));
        this.snackBar.open('Post updated', 'Close', { duration: 3000 });
        this.cancelEdit();
      } else {
        this.snackBar.open('Failed to update post', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[Community] Error saving edit:', error);
      this.snackBar.open('Failed to update post', 'Close', { duration: 3000 });
    } finally {
      this.savingEdit.set(false);
    }
  }

  private async loadCommunityFromNaddr(naddrStr: string): Promise<void> {
    this.loading.set(true);

    try {
      const decoded = nip19.decode(naddrStr);
      if (decoded.type !== 'naddr') {
        this.logger.error('[Community] Invalid naddr:', naddrStr);
        this.loading.set(false);
        return;
      }

      const { pubkey, identifier, relays } = decoded.data;

      // Check for pre-loaded event from router state or history.state
      const stateEvent = this.routerStateEvent
        ?? (this.isBrowser ? (history.state?.communityEvent as Event | undefined) : undefined);

      if (stateEvent && stateEvent.pubkey === pubkey && stateEvent.kind === COMMUNITY_DEFINITION_KIND) {
        const dTag = stateEvent.tags.find(t => t[0] === 'd')?.[1] || '';
        if (dTag === identifier) {
          const community = this.communityService.parseCommunity(stateEvent);
          this.community.set(community);
          this.loading.set(false);
          this.startPostsSubscription(community.coordinate);
          this.startApprovalsSubscription(community.coordinate);
          return;
        }
      }

      // Fetch from relays
      const community = await this.communityService.fetchCommunity(pubkey, identifier, relays);
      if (community) {
        this.community.set(community);
        this.startPostsSubscription(community.coordinate);
        this.startApprovalsSubscription(community.coordinate);
      }
    } catch (error) {
      this.logger.error('[Community] Error loading community:', error);
    } finally {
      this.loading.set(false);
    }
  }

  private startPostsSubscription(coordinate: string): void {
    this.postsSub?.close();
    this.loadingPosts.set(true);

    const loadingTimeout = setTimeout(() => {
      if (this.loadingPosts()) {
        this.loadingPosts.set(false);
      }
    }, 8000);

    this.postsSub = this.communityService.subscribeCommunityPosts(
      coordinate,
      (event: Event) => {
        const existing = this.postMap.get(event.id);
        if (existing) return;

        this.postMap.set(event.id, event);
        this.allPosts.set(Array.from(this.postMap.values()));

        // Load reactions for the post (for vote counts)
        void this.loadPostReactions(event);

        if (this.loadingPosts()) {
          clearTimeout(loadingTimeout);
          this.loadingPosts.set(false);
        }
      },
      { limit: 200 }
    );
  }

  private startApprovalsSubscription(coordinate: string): void {
    this.approvalsSub?.close();

    this.approvalsSub = this.communityService.subscribeCommunityApprovals(
      coordinate,
      (event: Event) => {
        const existing = this.approvalMap.get(event.id);
        if (existing) return;

        this.approvalMap.set(event.id, event);
        this.allApprovals.set(Array.from(this.approvalMap.values()));
      },
      { limit: 500 }
    );
  }

  async approvePost(post: Event): Promise<void> {
    const comm = this.community();
    if (!comm) return;

    try {
      const result = await this.communityService.publishApproval(
        comm.coordinate,
        post,
      );

      if (result.success) {
        this.snackBar.open('Post approved', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to approve post', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[Community] Error approving post:', error);
    }
  }

  isPostApproved(post: Event): boolean {
    const comm = this.community();
    if (!comm) return false;

    return this.communityService.isApprovedByModerator(
      this.allApprovals(),
      [...comm.moderators, { pubkey: comm.creatorPubkey }],
      post.id
    );
  }

  toggleApprovedFilter(): void {
    this.showApprovedOnly.update(v => !v);
  }

  async joinCommunity(): Promise<void> {
    const comm = this.community();
    if (!comm) return;

    try {
      await this.communityListService.addCommunity(comm.coordinate);
      this.snackBar.open('Joined community', 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('[Community] Error joining community:', error);
      this.snackBar.open('Failed to join community', 'Close', { duration: 3000 });
    }
  }

  async leaveCommunity(): Promise<void> {
    const comm = this.community();
    if (!comm) return;

    try {
      await this.communityListService.removeCommunity(comm.coordinate);
      this.snackBar.open('Left community', 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('[Community] Error leaving community:', error);
      this.snackBar.open('Failed to leave community', 'Close', { duration: 3000 });
    }
  }

  copyEventData(): void {
    const comm = this.community();
    if (!comm?.event) return;

    navigator.clipboard.writeText(JSON.stringify(comm.event, null, 2)).then(() => {
      this.snackBar.open('Event data copied to clipboard', 'Close', { duration: 3000 });
    }).catch(() => {
      this.snackBar.open('Failed to copy event data', 'Close', { duration: 3000 });
    });
  }

  editCommunity(): void {
    const comm = this.community();
    if (!comm) return;

    const naddr = nip19.naddrEncode({
      kind: COMMUNITY_DEFINITION_KIND,
      pubkey: comm.creatorPubkey,
      identifier: comm.id,
    });

    this.router.navigate(['/n', 'edit', naddr], {
      state: { communityEvent: comm.event },
    });
  }

  refresh(): void {
    const comm = this.community();
    if (!comm) return;

    this.postMap.clear();
    this.approvalMap.clear();
    this.allPosts.set([]);
    this.allApprovals.set([]);
    this.loadingPosts.set(true);

    this.startPostsSubscription(comm.coordinate);
    this.startApprovalsSubscription(comm.coordinate);
  }
}
