import { Component, inject, signal, computed, OnDestroy, OnInit, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Event, nip19 } from 'nostr-tools';
import { CommunityService, Community, CommunityPost, COMMUNITY_DEFINITION_KIND } from '../../services/community.service';
import { ApplicationService } from '../../services/application.service';
import { AccountStateService } from '../../services/account-state.service';
import { NostrService } from '../../services/nostr.service';
import { LayoutService } from '../../services/layout.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { EventComponent } from '../../components/event/event.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-community',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatTooltipModule,
    MatChipsModule,
    MatTabsModule,
    MatDividerModule,
    RouterLink,
    FormsModule,
    UserProfileComponent,
    EventComponent,
    AgoPipe,
  ],
  templateUrl: './community.component.html',
  styleUrls: ['./community.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private communityService = inject(CommunityService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private nostrService = inject(NostrService);
  private layout = inject(LayoutService);
  private snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Community event passed via router state for instant rendering */
  private routerStateEvent: Event | undefined;

  community = signal<Community | null>(null);
  loading = signal(true);
  loadingPosts = signal(true);

  // Posts
  allPosts = signal<Event[]>([]);
  private postMap = new Map<string, Event>();

  // Approvals
  allApprovals = signal<Event[]>([]);
  private approvalMap = new Map<string, Event>();

  // Post compose
  newPostContent = signal('');
  isPublishing = signal(false);

  // Tab state
  selectedTab = signal(0);

  // Show approved only filter
  showApprovedOnly = signal(false);

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

  // Check if current user is a moderator
  isModerator = computed(() => {
    const comm = this.community();
    const pubkey = this.currentPubkey();
    if (!comm || !pubkey) return false;
    return comm.creatorPubkey === pubkey ||
      comm.moderators.some(m => m.pubkey === pubkey);
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
      this.loadCommunityFromNaddr(naddrParam);
    }
  }

  ngOnDestroy(): void {
    this.postsSub?.close();
    this.approvalsSub?.close();
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

  async submitPost(): Promise<void> {
    const content = this.newPostContent().trim();
    const comm = this.community();
    if (!content || !comm) return;

    this.isPublishing.set(true);
    try {
      const result = await this.communityService.publishCommunityPost(
        comm.coordinate,
        comm.creatorPubkey,
        content,
      );

      if (result.success) {
        this.newPostContent.set('');
        this.snackBar.open('Post published to community', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to publish post', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[Community] Error publishing post:', error);
      this.snackBar.open('Error publishing post', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
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
