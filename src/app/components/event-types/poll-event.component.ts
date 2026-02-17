import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
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
    effect(() => {
      const event = this.event();
      untracked(() => {
        void this.loadPollResults(event, false);
      });
    });
  }

  private async loadPollResults(event: Event, forceRefresh = false): Promise<void> {
    const poll = this.pollService.parseNostrPollEvent(event);
    this.isLoading.set(true);

    try {
      const responses = await this.pollService.fetchPollResponses(
        poll.eventId || poll.id,
        poll.endsAt,
        forceRefresh,
        poll.relays
      );
      this.responses.set(responses);

      const results = this.pollService.calculateResults(poll, responses);
      this.results.set(results);

      const currentPubkey = this.app.accountState.pubkey();
      if (!currentPubkey) {
        this.selectedOptions.set([]);
        return;
      }

      const currentResponse = responses.find(response => response.pubkey === currentPubkey);
      this.selectedOptions.set(currentResponse?.responseIds ?? []);
    } catch (error) {
      console.error('Failed to load poll results:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async submitVote(): Promise<void> {
    const selectedOptionIds = this.selectedOptions();
    if (selectedOptionIds.length === 0) return;

    const poll = this.poll();
    const pollId = poll.eventId || poll.id;
    const currentPubkey = this.app.accountState.pubkey();

    if (!currentPubkey) {
      return;
    }

    this.isLoading.set(true);

    try {
      await this.pollService.submitPollResponse(
        pollId,
        selectedOptionIds,
        poll.relays
      );

      const createdAt = Math.floor(Date.now() / 1000);
      const existingResponses = this.responses().filter(response => response.pubkey !== currentPubkey);
      const optimisticResponse: PollResponse = {
        id: `local-${pollId}-${createdAt}`,
        pollId,
        responseIds: [...selectedOptionIds],
        pubkey: currentPubkey,
        created_at: createdAt,
      };

      const updatedResponses = [...existingResponses, optimisticResponse];
      this.responses.set(updatedResponses);
      this.results.set(this.pollService.calculateResults(poll, updatedResponses));
      this.selectedOptions.set([...selectedOptionIds]);

      // Reload results after voting
      this.pollService.clearResponseCache(pollId);
      setTimeout(() => {
        void this.loadPollResults(this.event(), true);
      }, 1200);
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
