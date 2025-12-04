import { Component, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';

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
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatProgressBarModule,
    PollCardComponent
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
  isLoading = signal(false);
  pollResults = signal<Map<string, { responses: PollResponse[], results: PollResults }>>(new Map());

  constructor() {
    // Fetch polls from Nostr when pubkey becomes available
    effect(() => {
      const pubkey = this.app.accountState.pubkey();
      if (pubkey) {
        this.loadYourPolls(pubkey);
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

  getDisplayedPolls(): Poll[] {
    return this.polls();
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
        kind: 1068,
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
