import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AccountStateService } from '../../../services/account-state.service';
import { SettingsService } from '../../../services/settings.service';
import { XDualPostService } from '../../../services/x-dual-post.service';

@Component({
  selector: 'app-setting-post-to-x',
  imports: [
    DatePipe,
    NgOptimizedImage,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatSlideToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (accountState.account()) {
    <div class="setting-section">
      <h2 class="x-section-title">
        <img ngSrc="/logos/clients/x.png" width="22" height="22" alt="X" class="x-section-logo" />
        <span>Post to X</span>
      </h2>
      <p class="setting-description">Connect your X account to publish the text of your Nostria posts to X.</p>
      <p class="setting-description">Post to X is available for Premium+ accounts only.</p>

      @if (xDualPost.loading()) {
      <p class="setting-description">Checking X connection status...</p>
      } @else if (!xPremiumEligible()) {
      @if (xDualPost.status().connected) {
      <mat-card class="x-connection-card x-connection-card-premium-locked">
        <div class="x-connection-card-header">
          <div>
            <div class="x-connection-eyebrow">X Connected</div>
            <div class="x-connection-title">{{ xDualPost.status().username || 'X user' }}</div>
          </div>
          <button mat-button type="button" (click)="disconnectX()">Disconnect</button>
        </div>
      </mat-card>
      }
      <div class="x-upgrade-prompt">
        <p class="setting-description">Upgrade to Premium+ to connect or publish to X from Nostria.</p>
        <button mat-flat-button type="button" (click)="openPremiumTab()">
          Open Premium
        </button>
      </div>
      } @else if (xDualPost.status().connected) {
      <mat-card class="x-connection-card">
        <div class="x-connection-card-header">
          <div>
            <div class="x-connection-eyebrow">X Connected</div>
            <div class="x-connection-title">{{ xDualPost.status().username || 'X user' }}</div>
            <div class="x-connection-subtitle">Your Nostria posts can now also publish to this X account.</div>
          </div>

          <div class="x-connection-actions">
            <button mat-stroked-button type="button" (click)="reconnectX()"
              [disabled]="xDualPost.loading() || xDualPost.connecting()">Reconnect</button>
            <button mat-button type="button" (click)="disconnectX()"
              [disabled]="xDualPost.loading() || xDualPost.connecting()">Disconnect</button>
          </div>
        </div>

        <div class="x-connection-meta">
          <div class="x-connection-meta-item">
            <span class="x-connection-meta-label">Account</span>
            @if (xProfileUrl(); as profileUrl) {
            <a class="x-connection-handle x-connection-link" [href]="profileUrl" target="_blank"
              rel="noopener noreferrer">&#64;{{ xDualPost.status().username || 'x-user' }}</a>
            } @else {
            <span class="x-connection-handle">&#64;{{ xDualPost.status().username || 'x-user' }}</span>
            }
          </div>
          <div class="x-connection-meta-item">
            <span class="x-connection-meta-label">Mode</span>
            <span>Single X account per Nostria account</span>
          </div>
          <div class="x-connection-meta-item">
            <span class="x-connection-meta-label">X Posts</span>
            <span class="x-connection-metric">{{ xDualPost.status().totalPosts }} total</span>
          </div>
          <div class="x-connection-meta-item">
            <span class="x-connection-meta-label">Last 24h</span>
            <span class="x-connection-metric">{{ xDualPost.status().postsLast24h }}</span>
          </div>
          <div class="x-connection-meta-item">
            <span class="x-connection-meta-label">24h Limit</span>
            <span class="x-connection-metric">{{ getXUsageRemaining() }}</span>
          </div>
          @if (xDualPost.status().lastPosted) {
          <div class="x-connection-meta-item">
            <span class="x-connection-meta-label">Last X Post</span>
            <span class="x-connection-metric">{{ xDualPost.status().lastPosted | date: 'medium' }}</span>
          </div>
          }
        </div>

        <p class="x-connection-note">Reconnect if you want to switch to another X account. Media support includes up to 4
          images or 1 video/GIF per post. Quote/reply threading and post edits are not mirrored to X yet.</p>

        <div class="setting-item x-default-toggle-row">
          <span class="x-inline-label">
            <img ngSrc="/logos/clients/x.png" width="18" height="18" alt="X" class="x-inline-logo" />
            <span>Post to X by default</span>
          </span>
          <mat-slide-toggle [checked]="settings.settings().postToXByDefault ?? false" (change)="togglePostToXByDefault()">
          </mat-slide-toggle>
        </div>
        <p class="setting-description x-default-toggle-description">When enabled, new posts will start with the X
          Post to X option turned on in Advanced Options.</p>
      </mat-card>
      } @else {
      <div class="setting-item">
        <span>No X account connected</span>
        <button mat-flat-button type="button" (click)="connectX()" [disabled]="xDualPost.connecting()">Connect X</button>
      </div>
      <p class="setting-description">Only one X account is supported per Nostria account. If you connected the wrong one
        previously, disconnect it and then connect again with the correct X account.</p>
      <p class="setting-description">You will be redirected to X to authorize Nostria. The backend stores your X access
        tokens and uses them only when you choose to post to X.</p>
      }
    </div>
    }
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }

    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding: 12px 0;
    }

    .setting-description {
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 16px 0;
    }

    .x-section-title,
    .x-inline-label {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }

    .x-section-logo,
    .x-inline-logo {
      border-radius: var(--mat-sys-corner-full);
      object-fit: contain;
      flex: 0 0 auto;
    }

    .x-connection-card {
      margin: 0 0 16px 0;
      padding: 20px;
      background: linear-gradient(135deg, var(--mat-sys-surface-container-highest), var(--mat-sys-surface-container));
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 20px;
      box-shadow: var(--mat-sys-level1);
    }

    .x-connection-card-premium-locked {
      margin-bottom: 12px;
    }

    .x-connection-card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .x-connection-eyebrow {
      font-size: 0.75rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mat-sys-primary);
      margin-bottom: 8px;
    }

    .x-connection-title {
      font-size: 1.75rem;
      line-height: 1.1;
      color: var(--mat-sys-on-surface);
      margin: 0;
      word-break: break-word;
    }

    .x-connection-subtitle {
      font-size: 0.95rem;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 8px;
      max-width: 44ch;
    }

    .x-connection-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .x-connection-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 20px 0 16px 0;
    }

    .x-connection-meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--mat-sys-surface-container-high);
      border: 1px solid var(--mat-sys-outline-variant);
    }

    .x-connection-meta-label {
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant);
    }

    .x-connection-handle {
      font-size: 1.2rem;
      line-height: 1.1;
      color: var(--mat-sys-on-surface);
    }

    .x-connection-link {
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    .x-connection-metric {
      color: var(--mat-sys-on-surface);
    }

    .x-connection-note {
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 16px 0;
    }

    .x-default-toggle-row {
      margin-bottom: 8px;
      padding: 12px 0 0 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .x-default-toggle-description {
      margin-bottom: 0;
    }

    .x-upgrade-prompt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      padding: 16px 18px;
      border-radius: 16px;
      background: var(--mat-sys-surface-container);
      border: 1px solid var(--mat-sys-outline-variant);

      .setting-description {
        margin: 0;
      }
    }

    @media (max-width: 768px) {
      .x-connection-card {
        padding: 16px;
      }

      .x-connection-card-header {
        flex-direction: column;
      }

      .x-connection-actions {
        width: 100%;
        justify-content: flex-start;
      }

      .x-upgrade-prompt {
        flex-direction: column;
        align-items: flex-start;
      }

      .x-connection-title {
        font-size: 1.4rem;
      }
    }
  `],
})
export class SettingPostToXComponent implements OnInit {
  readonly accountState = inject(AccountStateService);
  readonly settings = inject(SettingsService);
  readonly xDualPost = inject(XDualPostService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);

  xPremiumEligible = computed(() => {
    const subscription = this.accountState.subscription();
    const hasXPostingEntitlement = subscription?.entitlements?.features?.some(feature => feature.key === 'DUAL_POST_X_10') ?? false;
    const isNotExpired = !subscription?.expires || Date.now() < subscription.expires;
    return !!subscription && hasXPostingEntitlement && isNotExpired;
  });

  xProfileUrl = computed(() => {
    const username = this.xDualPost.status().username;
    return username ? `https://x.com/${username}` : null;
  });

  ngOnInit(): void {
    void this.xDualPost.refreshStatus();
    this.handleXAuthReturn();
  }

  openPremiumTab(): void {
    void this.router.navigate(['/accounts'], { queryParams: { tab: 'premium' } });
  }

  togglePostToXByDefault(): void {
    const currentValue = this.settings.settings()?.postToXByDefault ?? false;
    this.settings.updateSettings({ postToXByDefault: !currentValue });
  }

  async connectX(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open('Post to X is available for Premium+ accounts only.', 'Close', {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.connect();
    } catch (error) {
      this.snackBar.open(`Failed to connect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  async disconnectX(): Promise<void> {
    try {
      await this.xDualPost.disconnect();
      this.snackBar.open('Disconnected X account', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open(`Failed to disconnect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  async reconnectX(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open('Post to X is available for Premium+ accounts only.', 'Close', {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.reconnect();
    } catch (error) {
      this.snackBar.open(`Failed to reconnect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  getXUsageRemaining(): string {
    const status = this.xDualPost.status();

    if (status.limit24h === undefined || status.remaining24h === undefined) {
      return 'No daily cap configured';
    }

    return `${status.remaining24h} remaining of ${status.limit24h}`;
  }

  private handleXAuthReturn(): void {
    const status = this.route.snapshot.queryParamMap.get('xAuth');
    const message = this.route.snapshot.queryParamMap.get('xMessage');

    if (!status) {
      return;
    }

    if (status === 'success') {
      this.snackBar.open('X account connected', 'Close', {
        duration: 3000,
      });
    } else if (status === 'cancelled') {
      this.snackBar.open('X authorization was cancelled', 'Close', {
        duration: 3000,
      });
    } else {
      this.snackBar.open(message || 'X authorization failed', 'Close', {
        duration: 5000,
      });
    }

    void this.xDualPost.refreshStatus();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        xAuth: null,
        xMessage: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
