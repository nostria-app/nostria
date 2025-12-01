import { Component, input, output, computed, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { Poll, PollResults } from '../../interfaces';

@Component({
  selector: 'app-poll-card',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatChipsModule,
    MatRadioModule,
    MatCheckboxModule,
    FormsModule
],
  templateUrl: './poll-card.component.html',
  styleUrl: './poll-card.component.scss',
})
export class PollCardComponent {
  // Inputs
  poll = input.required<Poll>();
  results = input<PollResults | null>(null);
  hasVoted = input<boolean>(false);
  canVote = input<boolean>(true);

  // Outputs
  vote = output<string[]>();
  viewDetails = output<string>();

  // Local state
  selectedOptions = signal<string[]>([]);

  // Computed
  isExpired = computed(() => {
    const poll = this.poll();
    if (!poll.endsAt) return false;
    return Date.now() / 1000 > poll.endsAt;
  });

  isSingleChoice = computed(() => {
    return this.poll().pollType === 'singlechoice';
  });

  canSubmit = computed(() => {
    return this.selectedOptions().length > 0 && !this.hasVoted() && !this.isExpired();
  });

  // Get percentage for an option
  getPercentage(optionId: string): number {
    const results = this.results();
    if (!results || results.totalVotes === 0) return 0;
    
    const count = results.optionCounts[optionId] || 0;
    return Math.round((count / results.totalVotes) * 100);
  }

  // Get vote count for an option
  getVoteCount(optionId: string): number {
    const results = this.results();
    if (!results) return 0;
    return results.optionCounts[optionId] || 0;
  }

  // Check if this option is winning (has most votes)
  isWinningOption(optionId: string): boolean {
    const results = this.results();
    if (!results || results.totalVotes === 0) return false;
    
    const thisCount = this.getVoteCount(optionId);
    const maxCount = Math.max(...Object.values(results.optionCounts));
    
    return thisCount === maxCount && thisCount > 0;
  }

  // Handle single choice selection
  onSingleChoiceChange(optionId: string): void {
    this.selectedOptions.set([optionId]);
  }

  // Handle multiple choice selection
  onMultipleChoiceChange(optionId: string, checked: boolean): void {
    const current = this.selectedOptions();
    if (checked) {
      this.selectedOptions.set([...current, optionId]);
    } else {
      this.selectedOptions.set(current.filter(id => id !== optionId));
    }
  }

  // Submit vote
  submitVote(): void {
    const selected = this.selectedOptions();
    if (selected.length > 0) {
      this.vote.emit(selected);
      this.selectedOptions.set([]);
    }
  }

  // View poll details
  onViewDetails(): void {
    this.viewDetails.emit(this.poll().id);
  }

  // Format time remaining
  getTimeRemaining(): string {
    const poll = this.poll();
    if (!poll.endsAt) return 'No time limit';
    
    const now = Date.now() / 1000;
    const remaining = poll.endsAt - now;
    
    if (remaining <= 0) return 'Expired';
    
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} left`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} left`;
    return `${minutes} minute${minutes > 1 ? 's' : ''} left`;
  }
}
