import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { Event } from 'nostr-tools';
import { PollService } from '../../services/poll.service';
import { Poll, PollResults, PollResponse } from '../../interfaces';
import { ApplicationService } from '../../services/application.service';
import { TimestampPipe } from '../../pipes/timestamp.pipe';

@Component({
  selector: 'app-poll-event',
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatRadioModule,
    MatCheckboxModule,
    FormsModule,
    TimestampPipe,
  ],
  templateUrl: './poll-event.component.html',
  styleUrl: './poll-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PollEventComponent {
  private pollService = inject(PollService);
  private app = inject(ApplicationService);

  event = input.required<Event>();

  // Local state
  selectedOptions = signal<string[]>([]);
  isLoading = signal(false);
  results = signal<PollResults | null>(null);
  responses = signal<PollResponse[]>([]);

  // Parse the event into a Poll object
  poll = computed<Poll>(() => {
    const event = this.event();
    return this.pollService.parseNostrPollEvent(event);
  });

  isExpired = computed(() => {
    const poll = this.poll();
    if (!poll.endsAt) return false;
    return Date.now() / 1000 > poll.endsAt;
  });

  isSingleChoice = computed(() => {
    return this.poll().pollType === 'singlechoice';
  });

  hasVoted = computed(() => {
    const pubkey = this.app.accountState.pubkey();
    if (!pubkey) return false;

    const pollResults = this.results();
    if (!pollResults) return false;

    return pollResults.voters.includes(pubkey);
  });

  canVote = computed(() => {
    return !this.isExpired() && !this.hasVoted();
  });

  constructor() {
    // Load poll results when component initializes
    this.loadPollResults();
  }

  private async loadPollResults(): Promise<void> {
    const poll = this.poll();
    this.isLoading.set(true);

    try {
      const responses = await this.pollService.fetchPollResponses(
        poll.eventId || poll.id,
        poll.endsAt
      );
      this.responses.set(responses);

      const results = this.pollService.calculateResults(poll, responses);
      this.results.set(results);
    } catch (error) {
      console.error('Failed to load poll results:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async submitVote(): Promise<void> {
    const selectedOptions = this.selectedOptions();
    if (selectedOptions.length === 0) return;

    const poll = this.poll();
    this.isLoading.set(true);

    try {
      await this.pollService.submitPollResponse(
        poll.eventId || poll.id,
        selectedOptions
      );

      // Reload results after voting
      await this.loadPollResults();

      // Clear selection
      this.selectedOptions.set([]);
    } catch (error) {
      console.error('Failed to submit vote:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  toggleOption(optionId: string): void {
    const poll = this.poll();
    const currentSelection = this.selectedOptions();

    if (poll.pollType === 'singlechoice') {
      // Single choice: replace selection
      this.selectedOptions.set([optionId]);
    } else {
      // Multiple choice: toggle selection
      if (currentSelection.includes(optionId)) {
        this.selectedOptions.set(currentSelection.filter(id => id !== optionId));
      } else {
        this.selectedOptions.set([...currentSelection, optionId]);
      }
    }
  }

  getPercentage(optionId: string): number {
    const results = this.results();
    if (!results || results.totalVotes === 0) return 0;
    return Math.round((results.optionCounts[optionId] / results.totalVotes) * 100);
  }

  getVoteCount(optionId: string): number {
    const results = this.results();
    if (!results) return 0;
    return results.optionCounts[optionId] || 0;
  }
}
