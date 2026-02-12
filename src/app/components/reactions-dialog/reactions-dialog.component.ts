import { ChangeDetectionStrategy, Component, inject, signal, computed, effect, untracked } from '@angular/core';
import { Router, NavigationStart } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { nip19 } from 'nostr-tools';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { Event } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { LayoutService } from '../../services/layout.service';
import { EmojiSetService } from '../../services/emoji-set.service';
import { AccountStateService } from '../../services/account-state.service';
import { UserRelaysService } from '../../services/relays/user-relays';

export interface ReactionsDialogData {
  event: Event;
  reactions: NostrRecord[]; // All reactions (likes, emojis, etc.)
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
          <!-- Reactions Tab -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>favorite</mat-icon>
              <span><span class="hide-small">Reactions</span> ({{ reactions().length }})</span>
            </ng-template>

            <div class="tab-content">
              @if (reactions().length === 0) {
                <div class="empty-state">
                  <mat-icon>favorite_border</mat-icon>
                  <p>No reactions yet</p>
                </div>
              } @else {
                <mat-list>
                  @for (reaction of sortedReactions(); track reaction.event.id) {
                    <mat-list-item class="reaction-item">
                      <div class="reaction-content">
                        <div class="reaction-user-info">
                          <app-user-profile
                            [pubkey]="reaction.event.pubkey"
                            view="compact"
                          ></app-user-profile>
                        </div>
                        <div class="reaction-meta">
                          @if (getCustomEmojiUrl(reaction.event)) {
                            <img 
                              [src]="getCustomEmojiUrl(reaction.event)!" 
                              [alt]="reaction.event.content"
                              class="reaction-emoji-img"
                              [title]="reaction.event.content">
                          } @else {
                            <span class="reaction-emoji">{{ getReactionDisplay(reaction.event.content) }}</span>
                          }
                          <span class="reaction-time">{{ reaction.event.created_at | ago }}</span>
                        </div>
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
              <span><span class="hide-small">Zaps</span> ({{ totalZapAmount() }} sats)</span>
            </ng-template>

            <div class="tab-content">
              @if (zaps().length === 0) {
                <div class="empty-state">
                  <mat-icon>bolt</mat-icon>
                  <p>No zaps yet</p>
                </div>
              } @else {
                <div class="zaps-container">
                  @for (zap of sortedZaps(); track zap.receipt.id) {
                    <div class="zap-item-custom">
                      <div class="zap-header">
                        <app-user-profile
                          [pubkey]="zap.senderPubkey"
                          view="compact"
                        ></app-user-profile>
                        <div class="zap-meta">
                          <span class="zap-amount">{{ formatAmount(zap.amount) }} sats</span>
                          <span class="reaction-time">{{ zap.timestamp | ago }}</span>
                        </div>
                      </div>
                      @if (zap.comment) {
                        <div class="zap-comment">
                          <mat-icon class="comment-icon">format_quote</mat-icon>
                          <div class="comment-text">{{ zap.comment }}</div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </mat-tab>

          <!-- Reposts Tab -->
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon>repeat</mat-icon>
              <span><span class="hide-small">Reposts</span> ({{ reposts().length }})</span>
            </ng-template>

            <div class="tab-content">
              @if (reposts().length === 0) {
                <div class="empty-state">
                  <mat-icon>repeat</mat-icon>
                  <p>No reposts yet</p>
                </div>
              } @else {
                <mat-list>
                  @for (repost of sortedReposts(); track repost.event.id) {
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
              <span><span class="hide-small">Quotes</span> ({{ quotes().length }})</span>
            </ng-template>

            <div class="tab-content">
              @if (quotes().length === 0) {
                <div class="empty-state">
                  <mat-icon>format_quote</mat-icon>
                  <p>No quotes yet</p>
                </div>
              } @else {
                <mat-list>
                  @for (quote of sortedQuotes(); track quote.event.id) {
                    <mat-list-item class="reaction-item">
                      <div class="reaction-content">
                        <app-user-profile
                          [pubkey]="quote.event.pubkey"
                          view="compact"
                        ></app-user-profile>
                        <a class="reaction-time quote-link" (click)="openQuote(quote.event)" tabindex="0">
                          {{ quote.event.created_at | ago }}
                        </a>
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
        max-width: 650px;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
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
        min-height: 400px;
        max-height: 70vh;
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1;
        min-height: 0;
        /* Ensure proper scrolling behavior for the entire dialog body */
        -webkit-overflow-scrolling: touch;
      }

      .tab-content {
        height: auto;
        overflow: visible;
        padding: 16px 0;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--mat-sys-on-surface-variant);
      }

      .empty-state mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
        color: var(--mat-sys-on-surface-variant);
      }

      .reaction-item {
        border-bottom: 1px solid var(--mat-sys-outline-variant);
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
        gap: 12px;
      }

      .reaction-user-info {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .reaction-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .reaction-emoji {
        font-size: 20px;
        line-height: 1;
      }

      .reaction-emoji-img {
        width: 24px;
        height: 24px;
        object-fit: contain;
      }

      .reaction-time {
        color: var(--mat-sys-on-surface-variant);
        font-size: 12px;
        white-space: nowrap;
      }

      .quote-link {
        text-decoration: none;
        cursor: pointer;
        transition: color 0.2s ease;
      }

      .quote-link:hover {
        color: var(--mat-sys-secondary);
        text-decoration: underline;
      }

      .zaps-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 8px 16px;
        /* Allow natural content flow without additional scrolling */
        min-height: min-content;
      }

      .zap-item-custom {
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 8px;
        padding: 16px;
        background: var(--mat-sys-surface-container-low);
        transition: box-shadow 0.2s ease;
      }

      .zap-item-custom:hover {
        box-shadow: var(--mat-sys-level2);
        background: var(--mat-sys-surface-container);
      }

      .zap-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 8px;
      }

      .zap-header app-user-profile {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        max-width: calc(100% - 100px); // Reserve space for zap meta
      }

      .zap-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        flex-shrink: 0;
        min-width: 80px; // Ensure minimum space for amount and time
      }

      .zap-amount {
        color: #ff6b1a;
        font-weight: 600;
        font-size: 16px;
        text-align: right;
      }

      .zap-comment {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-top: 12px;
        padding: 12px;
        background: var(--mat-sys-primary-container);
        border-left: 4px solid var(--mat-sys-primary);
        border-radius: 6px;
      }

      .comment-icon {
        color: var(--mat-sys-primary);
        font-size: 18px;
        width: 18px;
        height: 18px;
        margin-top: 2px;
        flex-shrink: 0;
      }

      .comment-text {
        color: var(--mat-sys-on-primary-container);
        line-height: 1.5;
        flex: 1;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: pre-wrap;
        font-size: 14px;
      }

      .dialog-actions {
        padding: 8px 24px 16px;
        justify-content: flex-end;
        flex-shrink: 0;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }

      ::ng-deep .mat-mdc-tab-group {
        height: auto;
        display: flex;
        flex-direction: column;
      }

      ::ng-deep .mat-mdc-tab-header {
        flex-shrink: 0;
      }

      ::ng-deep .mat-mdc-tab-body-wrapper {
        flex: none;
        overflow: visible;
      }

      ::ng-deep .mat-mdc-tab-body-content {
        height: auto;
        overflow: visible;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReactionsDialogComponent {
  private dialogRef = inject(MatDialogRef<ReactionsDialogComponent>);
  private router = inject(Router);
  private layout = inject(LayoutService);
  private emojiSetService = inject(EmojiSetService);
  private accountState = inject(AccountStateService);
  private userRelaysService = inject(UserRelaysService);
  data = inject<ReactionsDialogData>(MAT_DIALOG_DATA);

  // Custom emojis for fallback lookup
  customEmojis = signal<{ shortcode: string; url: string }[]>([]);

  constructor() {
    this.router.events.pipe(
      filter(event => event instanceof NavigationStart),
      takeUntilDestroyed()
    ).subscribe(() => {
      this.dialogRef.close();
    });

    // Load user's custom emojis for fallback
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.customEmojis.set([]);
        return;
      }

      untracked(async () => {
        try {
          const userEmojis = await this.emojiSetService.getUserEmojiSets(pubkey);
          const emojiArray = Array.from(userEmojis.entries()).map(([shortcode, url]) => ({ shortcode, url }));
          this.customEmojis.set(emojiArray);
        } catch {
          this.customEmojis.set([]);
        }
      });
    });
  }

  reactions = signal<NostrRecord[]>(this.data.reactions || []);
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
          : 0
  );

  totalZapAmount = computed(() => {
    return this.zaps().reduce((total, zap) => total + (zap.amount || 0), 0);
  });

  sortedZaps = computed(() => {
    return [...this.zaps()].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  });

  sortedReposts = computed(() => {
    return [...this.reposts()].sort((a, b) => b.event.created_at - a.event.created_at);
  });

  sortedQuotes = computed(() => {
    return [...this.quotes()].sort((a, b) => b.event.created_at - a.event.created_at);
  });

  sortedReactions = computed(() => {
    return [...this.reactions()].sort((a, b) => b.event.created_at - a.event.created_at);
  });

  /**
   * Get the display text for a reaction
   * Converts '+' to heart emoji, otherwise displays the actual reaction content
   */
  getReactionDisplay(content: string): string {
    if (!content || content === '+') {
      return '❤️';
    }
    return content;
  }

  /**
   * Get custom emoji URL from reaction event tags (NIP-30)
   * Returns the image URL if the reaction has an emoji tag matching the content.
   * Falls back to user's custom emojis if no tag found in the event.
   */
  getCustomEmojiUrl(event: Event): string | null {
    if (!event.content || !event.content.startsWith(':') || !event.content.endsWith(':')) {
      return null;
    }

    const shortcode = event.content.slice(1, -1); // Remove colons
    
    // First, try to get URL from the event's emoji tag (NIP-30)
    const emojiTag = event.tags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
    if (emojiTag?.[2]) {
      return emojiTag[2];
    }

    // Fallback: check user's loaded custom emojis
    const customEmoji = this.customEmojis().find(e => e.shortcode === shortcode);
    return customEmoji?.url || null;
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  formatAmount(amount: number | null): string {
    if (!amount) return '0';
    return amount.toLocaleString();
  }

  getNevent(event: { id: string; pubkey: string; kind: number }): string {
    const relays = this.userRelaysService.getRelaysForPubkey(event.pubkey);
    return nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
      relays: relays.length > 0 ? relays : undefined,
    });
  }

  openQuote(event: { id: string; pubkey: string; kind: number }): void {
    const nevent = this.getNevent(event);
    this.layout.openGenericEvent(nevent);
  }

  close(): void {
    this.dialogRef.close();
  }
}
