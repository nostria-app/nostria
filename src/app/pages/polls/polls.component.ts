import { Component, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { nip19 } from 'nostr-tools';
import { PollService } from '../../services/poll.service';
import { ApplicationService } from '../../services/application.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { Poll, PollResponse, PollResults } from '../../interfaces';
import { PollCardComponent } from '../../components/poll-card/poll-card.component';
import { PollDetailsDialogComponent } from '../../components/poll-details-dialog/poll-details-dialog.component';

@Component({
  selector: 'app-polls',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTabsModule,
    PollCardComponent,
  ],
  templateUrl: './polls.component.html',
  styleUrl: './polls.component.scss',
})
export class PollsComponent {
  private pollService = inject(PollService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private app = inject(ApplicationService);
  private accountRelay = inject(AccountRelayService);

  polls = this.pollService.polls;
  drafts = this.pollService.drafts;

  // Local state
  selectedView = signal<'grid' | 'list'>('grid');
  selectedTab = signal<'feed' | 'yours'>('yours'); // Default to "Your Polls"
  selectedTabIndex = signal<number>(1); // 0 = feed, 1 = yours
  isLoading = signal(false);
  feedPolls = signal<Poll[]>([]);
  feedPollsLoaded = signal(false); // Track if feed polls have been loaded
  pollResults = signal<Map<string, { responses: PollResponse[], results: PollResults }>>(new Map());

  constructor() {
    // Fetch polls from Nostr when pubkey becomes available
    effect(() => {
      const pubkey = this.app.accountState.pubkey();
      if (pubkey) {
        this.loadYourPolls(pubkey);
        // Don't load feed polls automatically, load on tab switch
      }
    });
  }

  private async loadPolls(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    try {
      await this.pollService.fetchPollsFromNostr(pubkey);
      
      // Load responses for each poll
      const polls = this.polls();
      for (const poll of polls) {
        await this.loadPollResults(poll);
      }
    } catch (error) {
      console.error('Failed to load polls:', error);
      this.snackBar.open('Failed to load polls from Nostr', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Load your own polls
   */
  private async loadYourPolls(pubkey: string): Promise<void> {
    await this.loadPolls(pubkey);
  }

  /**
   * Load polls from people you follow (feed)
   * Optimized: Uses SharedRelayService with incremental updates like FeedService
   */
  private async loadFeedPolls(): Promise<void> {
    const currentUser = this.app.accountState.account();
    if (!currentUser) return;

    this.isLoading.set(true);
    try {
      // Get following list
      const contactList = await this.app.storage.getEventByPubkeyAndKind(
        [currentUser.pubkey],
        3 // kind 3 is contact list
      );

      if (!contactList) {
        console.log('No contact list found');
        this.snackBar.open('No following list found. Follow some users first!', 'Close', {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom'
        });
        this.isLoading.set(false);
        return;
      }

      // Extract pubkeys from p tags
      const followingPubkeys = contactList.tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1]);

      console.log(`Loading polls from ${followingPubkeys.length} followed users`);

      if (followingPubkeys.length === 0) {
        this.feedPollsLoaded.set(true);
        this.isLoading.set(false);
        return;
      }

      // Fetch polls with INCREMENTAL updates (show results as they arrive)
      await this.fetchPollsWithIncrementalUpdates(followingPubkeys);

      this.feedPollsLoaded.set(true);
    } catch (error) {
      console.error('Failed to load feed polls:', error);
      this.snackBar.open('Failed to load feed polls', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Fetch polls with incremental UI updates (like FeedService does)
   * Shows polls as they arrive instead of waiting for all
   */
  private async fetchPollsWithIncrementalUpdates(pubkeys: string[]): Promise<void> {
    // Use the optimized method from PollService (uses SharedRelayService)
    const pollsFromAllUsers = await this.pollService.fetchPollsForMultiplePubkeysOptimized(pubkeys);
    
    // Sort by creation time
    pollsFromAllUsers.sort((a: Poll, b: Poll) => b.created_at - a.created_at);
    
    // Update UI with all polls
    this.feedPolls.set(pollsFromAllUsers);

    console.log(`Loaded ${pollsFromAllUsers.length} polls from ${pubkeys.length} users`);
    
    // Load responses in batch
    const responsesMap = await this.pollService.fetchPollResponsesBatch(pollsFromAllUsers);
    
    // Update results
    const currentMap = this.pollResults();
    pollsFromAllUsers.forEach(poll => {
      const responses = responsesMap.get(poll.id) || [];
      const results = this.pollService.calculateResults(poll, responses);
      currentMap.set(poll.id, { responses, results });
    });
    this.pollResults.set(new Map(currentMap));
  }

  /**
   * Load poll results (responses and calculated results)
   * Cached to avoid redundant queries
   */
  private async loadPollResults(poll: Poll): Promise<void> {
    // Check if already loaded
    const existing = this.pollResults().get(poll.id);
    if (existing) {
      return; // Already cached
    }

    try {
      const responses = await this.pollService.fetchPollResponses(poll.eventId || poll.id, poll.endsAt);
      const results = this.pollService.calculateResults(poll, responses);
      
      const currentMap = this.pollResults();
      currentMap.set(poll.id, { responses, results });
      this.pollResults.set(new Map(currentMap));
    } catch (error) {
      console.error(`Failed to load results for poll ${poll.id}:`, error);
    }
  }

  createNewPoll(): void {
    // Create a new poll draft with default values
    const draft = this.pollService.createPoll(
      '', // empty content
      [ // default 2 empty options
        { id: this.generateOptionId(), label: '' },
        { id: this.generateOptionId(), label: '' }
      ],
      'singlechoice'
    );
    this.router.navigate(['/polls/edit', draft.id]);
  }

  private generateOptionId(): string {
    return Math.random().toString(36).substring(2, 11);
  }

  editPoll(poll: Poll): void {
    const draft = this.pollService.editPoll(poll);
    this.router.navigate(['/polls/edit', draft.id]);
  }

  async viewPollResults(poll: Poll): Promise<void> {
    // First load results if not cached
    await this.loadPollResults(poll);
    
    const pollData = this.pollResults().get(poll.id);
    if (!pollData) {
      this.snackBar.open('Failed to load poll results', 'Close', { duration: 3000 });
      return;
    }

    // Open dialog with results
    this.dialog.open(PollDetailsDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      data: {
        poll,
        results: pollData.results,
        responses: pollData.responses,
      },
    });
  }

  async submitVote(poll: Poll, optionIds: string[]): Promise<void> {
    try {
      await this.pollService.submitPollResponse(poll.eventId || poll.id, optionIds);
      this.snackBar.open('Vote submitted successfully!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
      
      // Clear caches to force fresh data
      this.pollService.clearResponseCache(poll.id);
      const currentMap = this.pollResults();
      currentMap.delete(poll.id);
      this.pollResults.set(new Map(currentMap));
      
      // Reload with fresh data
      await this.loadPollResults(poll);
    } catch (error) {
      console.error('Failed to submit vote:', error);
      this.snackBar.open('Failed to submit vote', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }

  deletePoll(poll: Poll): void {
    if (confirm(`Are you sure you want to delete "${poll.content}"?`)) {
      this.pollService.deletePoll(poll.id);
    }
  }

  loadDraft(draftId: string): void {
    this.pollService.loadDraft(draftId);
    this.router.navigate(['/polls/edit', draftId]);
  }

  deleteDraft(draftId: string): void {
    if (confirm('Are you sure you want to delete this draft?')) {
      this.pollService.removeDraft(draftId);
    }
  }

  toggleView(): void {
    this.selectedView.update(view => view === 'grid' ? 'list' : 'grid');
  }

  switchTab(index: number): void {
    this.selectedTabIndex.set(index);
    this.selectedTab.set(index === 0 ? 'feed' : 'yours');
    
    // Load feed polls when switching to feed tab for the first time
    if (index === 0 && !this.feedPollsLoaded()) {
      this.loadFeedPolls();
    }
  }

  getDisplayedPolls(): Poll[] {
    return this.selectedTab() === 'feed' ? this.feedPolls() : this.polls();
  }

  refreshFeed(): void {
    this.feedPollsLoaded.set(false);
    this.loadFeedPolls();
  }

  isPollEnded(poll: Poll): boolean {
    if (!poll.endsAt) return false;
    return Math.floor(Date.now() / 1000) > poll.endsAt;
  }

  hasUserVoted(poll: Poll): boolean {
    const pubkey = this.app.accountState.pubkey();
    if (!pubkey) return false;
    
    const pollData = this.pollResults().get(poll.id);
    if (!pollData) return false;
    
    return pollData.results.voters.includes(pubkey);
  }

  getResultsForPoll(poll: Poll): { responses: PollResponse[], results: PollResults } | undefined {
    return this.pollResults().get(poll.id);
  }

  getPercentage(optionId: string, results: PollResults): number {
    if (results.totalVotes === 0) return 0;
    return Math.round((results.optionCounts[optionId] / results.totalVotes) * 100);
  }

  /**
   * Copy nevent address for the poll to clipboard
   */
  async copyNeventAddress(poll: Poll): Promise<void> {
    if (!poll.eventId) {
      this.snackBar.open('This poll has not been published yet', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
      return;
    }

    try {
      const nevent = nip19.neventEncode({
        id: poll.eventId,
        relays: poll.relays,
      });

      await navigator.clipboard.writeText(nevent);
      this.snackBar.open('Poll address copied to clipboard!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } catch (error) {
      console.error('Failed to copy nevent address:', error);
      this.snackBar.open('Failed to copy address', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }

  /**
   * Copy raw event data as JSON to clipboard
   */
  async copyEventData(poll: Poll): Promise<void> {
    if (!poll.eventId) {
      this.snackBar.open('This poll has not been published yet', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
      return;
    }

    try {
      const eventData = {
        id: poll.eventId,
        kind: 1068,
        content: poll.content,
        created_at: poll.created_at,
        pubkey: poll.pubkey,
        tags: [
          ...poll.options.map(opt => ['option', opt.id, opt.label]),
          ...poll.relays.map(relay => ['relay', relay]),
          ['polltype', poll.pollType],
          ...(poll.endsAt ? [['endsAt', poll.endsAt.toString()]] : []),
        ],
      };

      await navigator.clipboard.writeText(JSON.stringify(eventData, null, 2));
      this.snackBar.open('Event data copied to clipboard!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } catch (error) {
      console.error('Failed to copy event data:', error);
      this.snackBar.open('Failed to copy event data', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }
}
