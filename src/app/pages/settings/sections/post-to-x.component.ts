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
          <span i18n="@@settings.post-to-x.title">Post to X</span>
        </h2>
        <p class="setting-description" i18n="@@settings.post-to-x.description">
          Connect your X account to publish the text of your Nostria posts to X.
        </p>
        <p class="setting-description" i18n="@@settings.post-to-x.premium-only">
          Post to X is available for Premium+ accounts only.
        </p>

        @if (xDualPost.loading()) {
          <p class="setting-description" i18n="@@settings.post-to-x.checking">
            Checking X connection status...
          </p>
        } @else if (!xPremiumEligible()) {
          @if (xDualPost.status().connected) {
            <mat-card class="x-connection-card x-connection-card-premium-locked">
              <div class="x-connection-card-header">
                <div>
                  <div class="x-connection-eyebrow" i18n="@@settings.post-to-x.connected">
                    X Connected
                  </div>
                  <div class="x-connection-title">
                    {{ xDualPost.status().username || xUserFallback }}
                  </div>
                </div>
                <button
                  mat-button
                  type="button"
                  (click)="disconnectX()"
                  i18n="@@settings.post-to-x.disconnect"
                >
                  Disconnect
                </button>
              </div>
            </mat-card>
          }
          <div class="x-upgrade-prompt">
            <p class="setting-description" i18n="@@settings.post-to-x.upgrade">
              Upgrade to Premium+ to connect or publish to X from Nostria.
            </p>
            <button
              mat-flat-button
              type="button"
              (click)="openPremiumTab()"
              i18n="@@settings.post-to-x.open-premium"
            >
              Open Premium
            </button>
          </div>
        } @else if (xDualPost.status().connected) {
          <mat-card class="x-connection-card">
            <div class="x-connection-card-header">
              <div>
                <div class="x-connection-eyebrow" i18n="@@settings.post-to-x.connected">
                  X Connected
                </div>
                <div class="x-connection-title">
                  {{ xDualPost.status().username || xUserFallback }}
                </div>
                <div
                  class="x-connection-subtitle"
                  i18n="@@settings.post-to-x.connected.description"
                >
                  Your Nostria posts can now also publish to this X account.
                </div>
              </div>

              <div class="x-connection-actions">
                <button
                  mat-stroked-button
                  type="button"
                  (click)="reconnectX()"
                  [disabled]="xDualPost.loading() || xDualPost.connecting()"
                  i18n="@@settings.post-to-x.reconnect"
                >
                  Reconnect
                </button>
                <button
                  mat-button
                  type="button"
                  (click)="disconnectX()"
                  [disabled]="xDualPost.loading() || xDualPost.connecting()"
                  i18n="@@settings.post-to-x.disconnect"
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div class="x-connection-meta">
              <div class="x-connection-meta-item">
                <span class="x-connection-meta-label" i18n="@@settings.post-to-x.account"
                  >Account</span
                >
                @if (xProfileUrl(); as profileUrl) {
                  <a
                    class="x-connection-handle x-connection-link"
                    [href]="profileUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >&#64;{{ xDualPost.status().username || xHandleFallback }}</a
                  >
                } @else {
                  <span class="x-connection-handle"
                    >&#64;{{ xDualPost.status().username || xHandleFallback }}</span
                  >
                }
              </div>
              <div class="x-connection-meta-item">
                <span class="x-connection-meta-label" i18n="@@settings.post-to-x.mode">Mode</span>
                <span i18n="@@settings.post-to-x.mode.single-account"
                  >Single X account per Nostria account</span
                >
              </div>
              <div class="x-connection-meta-item">
                <span class="x-connection-meta-label" i18n="@@settings.post-to-x.posts"
                  >X Posts</span
                >
                <span class="x-connection-metric" i18n="@@settings.post-to-x.posts.total"
                  >{{ xDualPost.status().totalPosts }} total</span
                >
              </div>
              <div class="x-connection-meta-item">
                <span class="x-connection-meta-label" i18n="@@settings.post-to-x.last24h"
                  >Last 24h</span
                >
                <span class="x-connection-metric">{{ xDualPost.status().postsLast24h }}</span>
              </div>
              <div class="x-connection-meta-item">
                <span class="x-connection-meta-label" i18n="@@settings.post-to-x.limit24h"
                  >24h Limit</span
                >
                <span class="x-connection-metric">{{ getXUsageRemaining() }}</span>
              </div>
              @if (xDualPost.status().lastPosted) {
                <div class="x-connection-meta-item">
                  <span class="x-connection-meta-label" i18n="@@settings.post-to-x.last-post"
                    >Last X Post</span
                  >
                  <span class="x-connection-metric">{{
                    xDualPost.status().lastPosted | date: 'medium'
                  }}</span>
                </div>
              }
            </div>

            <p class="x-connection-note" i18n="@@settings.post-to-x.note">
              Reconnect if you want to switch to another X account. Media support includes up to 4
              images or 1 video/GIF per post. Quote/reply threading and post edits are not mirrored
              to X yet.
            </p>

            <div class="setting-item x-default-toggle-row">
              <span class="x-inline-label">
                <img
                  ngSrc="/logos/clients/x.png"
                  width="18"
                  height="18"
                  alt="X"
                  class="x-inline-logo"
                />
                <span i18n="@@settings.post-to-x.default-toggle">Post to X by default</span>
              </span>
              <mat-slide-toggle
                [checked]="settings.settings().postToXByDefault ?? false"
                (change)="togglePostToXByDefault()"
              >
              </mat-slide-toggle>
            </div>
            <p
              class="setting-description x-default-toggle-description"
              i18n="@@settings.post-to-x.default-description"
            >
              When enabled, new posts will start with the X Post to X option turned on in Advanced
              Options.
            </p>
          </mat-card>
        } @else {
          <div class="setting-item">
            <span i18n="@@settings.post-to-x.not-connected">No X account connected</span>
            <button
              mat-flat-button
              type="button"
              (click)="connectX()"
              [disabled]="xDualPost.connecting()"
              i18n="@@settings.post-to-x.connect"
            >
              Connect X
            </button>
          </div>
          <p class="setting-description" i18n="@@settings.post-to-x.connect.description">
            Only one X account is supported per Nostria account. If you connected the wrong one
            previously, disconnect it and then connect again with the correct X account.
          </p>
          <p class="setting-description" i18n="@@settings.post-to-x.connect.authorization">
            You will be redirected to X to authorize Nostria. The backend stores your X access
            tokens and uses them only when you choose to post to X.
          </p>
        }
      </div>
    }
  `,
  styles: [
    `
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
        background: linear-gradient(
          135deg,
          var(--mat-sys-surface-container-highest),
          var(--mat-sys-surface-container)
        );
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
    `,
  ],
})
export class SettingPostToXComponent implements OnInit {
  readonly accountState = inject(AccountStateService);
  readonly settings = inject(SettingsService);
  readonly xDualPost = inject(XDualPostService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  private readonly closeLabel = $localize`:@@common.close:Close`;
  private readonly unknownErrorLabel = $localize`:@@common.unknown-error:Unknown error`;
  readonly xUserFallback = $localize`:@@settings.post-to-x.default-user:X user`;
  readonly xHandleFallback = 'x-user';
  private readonly premiumOnlyMessage = $localize`:@@settings.post-to-x.premium-only:Post to X is available for Premium+ accounts only.`;

  xPremiumEligible = computed(() => {
    const subscription = this.accountState.subscription();
    const hasXPostingEntitlement =
      subscription?.entitlements?.features?.some((feature) => feature.key === 'DUAL_POST_X_10') ??
      false;
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
      this.snackBar.open(this.premiumOnlyMessage, this.closeLabel, {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.connect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : this.unknownErrorLabel;
      this.snackBar.open(
        $localize`:@@settings.post-to-x.connect.error:Failed to connect X: ${errorMessage}:message:`,
        this.closeLabel,
        {
          duration: 5000,
        },
      );
    }
  }

  async disconnectX(): Promise<void> {
    try {
      await this.xDualPost.disconnect();
      this.snackBar.open(
        $localize`:@@settings.post-to-x.disconnect.success:Disconnected X account`,
        this.closeLabel,
        {
          duration: 3000,
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : this.unknownErrorLabel;
      this.snackBar.open(
        $localize`:@@settings.post-to-x.disconnect.error:Failed to disconnect X: ${errorMessage}:message:`,
        this.closeLabel,
        {
          duration: 5000,
        },
      );
    }
  }

  async reconnectX(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open(this.premiumOnlyMessage, this.closeLabel, {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.reconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : this.unknownErrorLabel;
      this.snackBar.open(
        $localize`:@@settings.post-to-x.reconnect.error:Failed to reconnect X: ${errorMessage}:message:`,
        this.closeLabel,
        {
          duration: 5000,
        },
      );
    }
  }

  getXUsageRemaining(): string {
    const status = this.xDualPost.status();

    if (status.limit24h === undefined || status.remaining24h === undefined) {
      return $localize`:@@settings.post-to-x.limit.none:No daily cap configured`;
    }

    return $localize`:@@settings.post-to-x.limit.remaining:${status.remaining24h}:remaining: remaining of ${status.limit24h}:limit:`;
  }

  private handleXAuthReturn(): void {
    const status = this.route.snapshot.queryParamMap.get('xAuth');
    const message = this.route.snapshot.queryParamMap.get('xMessage');

    if (!status) {
      return;
    }

    if (status === 'success') {
      this.snackBar.open(
        $localize`:@@settings.post-to-x.auth.success:X account connected`,
        this.closeLabel,
        {
          duration: 3000,
        },
      );
    } else if (status === 'cancelled') {
      this.snackBar.open(
        $localize`:@@settings.post-to-x.auth.cancelled:X authorization was cancelled`,
        this.closeLabel,
        {
          duration: 3000,
        },
      );
    } else {
      this.snackBar.open(
        message || $localize`:@@settings.post-to-x.auth.failed:X authorization failed`,
        this.closeLabel,
        {
          duration: 5000,
        },
      );
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
