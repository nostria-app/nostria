import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { Event } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AgoPipe } from '../../pipes/ago.pipe';

export interface ReactionsDialogData {
  event: Event;
  likes: NostrRecord[];
  zaps: {
    receipt: Event;
    zapRequest: Event | null;
    amount: number | null;
    comment: string;
    senderName?: string;
    senderPubkey: string;
    timestamp: number;
  }[];
  reposts: NostrRecord[];
  quotes: NostrRecord[];
  selectedTab?: 'likes' | 'zaps' | 'reposts' | 'quotes';
}

@Component({
  selector: 'app-reactions-dialog',
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatListModule,
    UserProfileComponent,
    AgoPipe,
  ],
  template: `
    <div class="reactions-dialog">
      <div class="dialog-header">
        <h2 mat-dialog-title>Reactions</h2>
        <button mat-icon-button [mat-dialog-close]="true" aria-label="Close dialog">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <mat-dialog-content class="dialog-content">
        <mat-tab-group
          [selectedIndex]="selectedTabIndex()"
          (selectedIndexChange)="onTabChange($event)"
        >
          <!-- Likes Tab -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>favorite</mat-icon>
              <span>Likes ({{ likes().length }})</span>
            </ng-template>

            <div class="tab-content">
              @if (likes().length === 0) {
                <div class="empty-state">
                  <mat-icon>favorite_border</mat-icon>
                  <p>No likes yet</p>
                </div>
              } @else {
                <mat-list>
                  @for (like of likes(); track like.event.id) {
                    <mat-list-item class="reaction-item">
                      <div class="reaction-content">
                        <app-user-profile
                          [pubkey]="like.event.pubkey"
                          view="compact"
                        ></app-user-profile>
                        <span class="reaction-time">{{ like.event.created_at | ago }}</span>
                      </div>
                    </mat-list-item>
                  }
                </mat-list>
              }
            </div>
          </mat-tab>

          <!-- Zaps Tab -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>bolt</mat-icon>
              <span>Zaps ({{ totalZapAmount() }} sats)</span>
            </ng-template>

            <div class="tab-content">
              @if (zaps().length === 0) {
                <div class="empty-state">
                  <mat-icon>bolt</mat-icon>
                  <p>No zaps yet</p>
                </div>
              } @else {
                <mat-list>
                  @for (zap of sortedZaps(); track zap.receipt.id) {
                    <mat-list-item class="reaction-item zap-item">
                      <div class="reaction-content">
                        <app-user-profile
                          [pubkey]="zap.senderPubkey"
                          view="compact"
                        ></app-user-profile>
                        <div class="zap-details">
                          <span class="zap-amount">{{ formatAmount(zap.amount) }} sats</span>
                          <span class="reaction-time">{{ zap.timestamp | ago }}</span>
                        </div>
                      </div>
                      @if (zap.comment) {
                        <div class="zap-comment">
                          <mat-icon class="comment-icon">format_quote</mat-icon>
                          <span class="comment-text">{{ zap.comment }}</span>
                        </div>
                      }
                    </mat-list-item>
                  }
                </mat-list>
              }
            </div>
          </mat-tab>

          <!-- Reposts Tab -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>repeat</mat-icon>
              <span>Reposts ({{ reposts().length }})</span>
            </ng-template>

            <div class="tab-content">
              @if (reposts().length === 0) {
                <div class="empty-state">
                  <mat-icon>repeat</mat-icon>
                  <p>No reposts yet</p>
                </div>
              } @else {
                <mat-list>
                  @for (repost of reposts(); track repost.event.id) {
                    <mat-list-item class="reaction-item">
                      <div class="reaction-content">
                        <app-user-profile
                          [pubkey]="repost.event.pubkey"
                          view="compact"
                        ></app-user-profile>
                        <span class="reaction-time">{{ repost.event.created_at | ago }}</span>
                      </div>
                    </mat-list-item>
                  }
                </mat-list>
              }
            </div>
          </mat-tab>

          <!-- Quotes Tab -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>format_quote</mat-icon>
              <span>Quotes ({{ quotes().length }})</span>
            </ng-template>

            <div class="tab-content">
              @if (quotes().length === 0) {
                <div class="empty-state">
                  <mat-icon>format_quote</mat-icon>
                  <p>No quotes yet</p>
                </div>
              } @else {
                <mat-list>
                  @for (quote of quotes(); track quote.event.id) {
                    <mat-list-item class="reaction-item">
                      <div class="reaction-content">
                        <app-user-profile
                          [pubkey]="quote.event.pubkey"
                          view="compact"
                        ></app-user-profile>
                        <span class="reaction-time">{{ quote.event.created_at | ago }}</span>
                      </div>
                    </mat-list-item>
                  }
                </mat-list>
              }
            </div>
          </mat-tab>
        </mat-tab-group>
      </mat-dialog-content>

      <mat-dialog-actions class="dialog-actions">
        <button mat-button [mat-dialog-close]="true">Close</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .reactions-dialog {
        width: 100%;
        max-width: 500px;
        max-height: 80vh;
      }

      .dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px 0;
      }

      .dialog-header h2 {
        margin: 0;
        flex: 1;
      }

      .dialog-content {
        padding: 16px 0;
        min-height: 300px;
        max-height: 60vh;
        overflow: hidden;
      }

      .tab-content {
        height: 100%;
        overflow-y: auto;
        padding: 16px 0;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: #666;
      }

      .empty-state mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      .reaction-item {
        border-bottom: 1px solid #f0f0f0;
        padding: 12px 24px;
      }

      .reaction-item:last-child {
        border-bottom: none;
      }

      .reaction-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
      }

      .reaction-time {
        color: #666;
        font-size: 12px;
        white-space: nowrap;
      }

      .zap-item .reaction-content {
        align-items: flex-start;
      }

      .zap-details {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
      }

      .zap-amount {
        color: #ff6b1a;
        font-weight: 500;
        font-size: 14px;
      }

      .zap-comment {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 8px;
        padding: 8px;
        background: rgba(255, 107, 26, 0.05);
        border-left: 3px solid #ff6b1a;
        border-radius: 4px;
      }

      .comment-icon {
        color: #ff6b1a;
        font-size: 16px;
        width: 16px;
        height: 16px;
        margin-top: 2px;
      }

      .comment-text {
        font-style: italic;
        color: #333;
        line-height: 1.4;
        flex: 1;
      }

      .dialog-actions {
        padding: 8px 24px 16px;
        justify-content: flex-end;
      }

      ::ng-deep .mat-mdc-tab-group {
        height: 100%;
      }

      ::ng-deep .mat-mdc-tab-body-wrapper {
        height: calc(100% - 48px);
      }

      ::ng-deep .mat-mdc-tab-body-content {
        height: 100%;
        overflow: hidden;
      }
    `,
  ],
})
export class ReactionsDialogComponent {
  private dialogRef = inject(MatDialogRef<ReactionsDialogComponent>);
  data = inject<ReactionsDialogData>(MAT_DIALOG_DATA);

  likes = signal<NostrRecord[]>(this.data.likes || []);
  zaps = signal<ReactionsDialogData['zaps']>(this.data.zaps || []);
  reposts = signal<NostrRecord[]>(this.data.reposts || []);
  quotes = signal<NostrRecord[]>(this.data.quotes || []);
  selectedTabIndex = signal<number>(
    this.data.selectedTab === 'zaps'
      ? 1
      : this.data.selectedTab === 'reposts'
        ? 2
        : this.data.selectedTab === 'quotes'
          ? 3
          : 0,
  );

  totalZapAmount = computed(() => {
    return this.zaps().reduce((total, zap) => total + (zap.amount || 0), 0);
  });

  sortedZaps = computed(() => {
    return [...this.zaps()].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  });

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  formatAmount(amount: number | null): string {
    if (!amount) return '0';
    return amount.toLocaleString();
  }

  close(): void {
    this.dialogRef.close();
  }
}
