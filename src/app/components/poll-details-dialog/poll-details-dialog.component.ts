import { Component, inject } from '@angular/core';

import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatListModule } from '@angular/material/list';
import { MatChipsModule } from '@angular/material/chips';
import { Poll, PollResults, PollResponse } from '../../interfaces';

interface PollDetailsData {
  poll: Poll;
  results: PollResults;
  responses: PollResponse[];
}

@Component({
  selector: 'app-poll-details-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatListModule,
    MatChipsModule
],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>poll</mat-icon>
      Poll Results
    </h2>
    
    <mat-dialog-content>
      <!-- Poll Question -->
      <div class="poll-question">
        <h3>{{ data.poll.content }}</h3>
      </div>

      <!-- Poll Metadata -->
      <div class="poll-metadata">
        <mat-chip-set>
          <mat-chip>
            <mat-icon>how_to_vote</mat-icon>
            {{ data.results.totalVotes }} total votes
          </mat-chip>
          <mat-chip>
            <mat-icon>{{ data.poll.pollType === 'singlechoice' ? 'radio_button_checked' : 'check_box' }}</mat-icon>
            {{ data.poll.pollType === 'singlechoice' ? 'Single Choice' : 'Multiple Choice' }}
          </mat-chip>
          @if (data.poll.endsAt) {
            <mat-chip>
              <mat-icon>schedule</mat-icon>
              {{ isExpired() ? 'Ended' : 'Active' }}
            </mat-chip>
          }
        </mat-chip-set>
      </div>

      <!-- Results by Option -->
      <div class="results-section">
        <h4>Results</h4>
        <mat-list>
          @for (option of data.poll.options; track option.id) {
            <mat-list-item>
              <div class="option-result">
                <div class="option-header">
                  <span class="option-label">{{ option.label }}</span>
                  <span class="option-stats">
                    {{ getVoteCount(option.id) }} votes ({{ getPercentage(option.id) }}%)
                  </span>
                </div>
                <mat-progress-bar 
                  mode="determinate" 
                  [value]="getPercentage(option.id)">
                </mat-progress-bar>
              </div>
            </mat-list-item>
          }
        </mat-list>
      </div>

      <!-- Voters List -->
      @if (data.results.voters.length > 0) {
        <div class="voters-section">
          <h4>Voters ({{ data.results.voters.length }})</h4>
          <mat-list dense>
            @for (voter of data.results.voters; track voter) {
              <mat-list-item>
                <mat-icon matListItemIcon>person</mat-icon>
                <span matListItemTitle class="voter-pubkey">{{ formatPubkey(voter) }}</span>
              </mat-list-item>
            }
          </mat-list>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .poll-question {
      margin-bottom: 1rem;
      
      h3 {
        font-size: 1.25rem;
        margin: 0;
      }
    }

    .poll-metadata {
      margin-bottom: 1.5rem;
    }

    .results-section {
      margin-bottom: 1.5rem;
      
      h4 {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
        font-weight: 500;
      }
    }

    .option-result {
      width: 100%;
      padding: 0.5rem 0;
    }

    .option-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .option-label {
      font-weight: 500;
    }

    .option-stats {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .voters-section {
      h4 {
        margin: 0 0 0.5rem 0;
        font-size: 1rem;
        font-weight: 500;
      }
    }

    .voter-pubkey {
      font-family: monospace;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    mat-dialog-content {
      max-height: 70vh;
      overflow-y: auto;
    }

    mat-icon {
      vertical-align: middle;
      margin-inline-end: 0.5rem;
    }
  `],
})
export class PollDetailsDialogComponent {
  data = inject<PollDetailsData>(MAT_DIALOG_DATA);

  getVoteCount(optionId: string): number {
    return this.data.results.optionCounts[optionId] || 0;
  }

  getPercentage(optionId: string): number {
    if (this.data.results.totalVotes === 0) return 0;
    const count = this.getVoteCount(optionId);
    return Math.round((count / this.data.results.totalVotes) * 100);
  }

  formatPubkey(pubkey: string): string {
    return `${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 4)}`;
  }

  isExpired(): boolean {
    if (!this.data.poll.endsAt) return false;
    return Date.now() / 1000 > this.data.poll.endsAt;
  }
}
