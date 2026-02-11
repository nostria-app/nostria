import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy, DestroyRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { TrustProviderService, KNOWN_PROVIDERS, KnownProvider } from '../../../services/trust-provider.service';
import { AccountStateService } from '../../../services/account-state.service';
import { TrustService } from '../../../services/trust.service';

@Component({
  selector: 'app-trust-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './trust.component.html',
  styleUrl: './trust.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
})
export class TrustSettingsComponent implements OnInit, OnDestroy {
  localSettings = inject(LocalSettingsService);
  trustProviderService = inject(TrustProviderService);
  accountState = inject(AccountStateService);
  private panelActions = inject(PanelActionsService);
  private rightPanel = inject(RightPanelService);
  private trustService = inject(TrustService);
  private destroyRef = inject(DestroyRef);

  /** Available scoring services */
  knownProviders = KNOWN_PROVIDERS;

  /** Publishing state */
  publishStatus = signal<'idle' | 'publishing' | 'success' | 'error'>('idle');
  publishError = signal<string>('');

  /** Trust rank refresh state */
  refreshStatus = signal<'idle' | 'refreshing' | 'done'>('idle');
  refreshTotal = signal(0);
  refreshCompleted = signal(0);
  refreshProgress = computed(() => {
    const total = this.refreshTotal();
    if (total === 0) return 0;
    return Math.round((this.refreshCompleted() / total) * 100);
  });
  private refreshAborted = false;

  /** Whether user is authenticated */
  readonly isAuthenticated = computed(() => {
    const account = this.accountState.account();
    return !!account && account.source !== 'preview';
  });

  /** Check if a known provider is enabled */
  isProviderConfigured(provider: KnownProvider): boolean {
    return this.trustProviderService.isKnownProviderConfigured(provider);
  }

  ngOnInit(): void {
    if (!this.rightPanel.hasContent()) {
      this.panelActions.setPageTitle($localize`:@@settings.trust.title:Trust`);
    }
  }

  ngOnDestroy(): void {
    if (!this.rightPanel.hasContent()) {
      this.panelActions.clearPageTitle();
    }
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  toggleTrustEnabled(): void {
    this.localSettings.setTrustEnabled(!this.localSettings.trustEnabled());
  }

  /** Enable a scoring service and publish the configuration */
  async enableProvider(provider: KnownProvider): Promise<void> {
    this.trustProviderService.addKnownProvider(provider, false);
    if (this.isAuthenticated()) {
      await this.publishProviders();
    }
  }

  /** Disable a scoring service and publish the updated configuration */
  async disableProvider(provider: KnownProvider): Promise<void> {
    this.trustProviderService.removeKnownProvider(provider);
    if (this.isAuthenticated()) {
      await this.publishProviders();
    }
  }

  /** Publish the provider configuration */
  private async publishProviders(): Promise<void> {
    this.publishStatus.set('publishing');
    this.publishError.set('');

    const result = await this.trustProviderService.publishProviders();

    if (result.success) {
      this.publishStatus.set('success');
      setTimeout(() => this.publishStatus.set('idle'), 3000);
    } else {
      this.publishStatus.set('error');
      this.publishError.set(result.error ?? 'Unknown error');
    }
  }

  /** Open Brainstorm activation page */
  openBrainstorm(): void {
    window.open('https://straycat.brainstorm.social/', '_blank', 'noopener,noreferrer');
  }

  /** Refresh trust ranks for all followed accounts */
  async refreshTrustRanks(): Promise<void> {
    const pubkeys = this.accountState.followingList();
    if (pubkeys.length === 0) return;

    this.refreshAborted = false;
    this.refreshStatus.set('refreshing');
    this.refreshTotal.set(pubkeys.length);
    this.refreshCompleted.set(0);

    this.destroyRef.onDestroy(() => {
      this.refreshAborted = true;
    });

    const CHUNK_SIZE = 50;
    for (let i = 0; i < pubkeys.length; i += CHUNK_SIZE) {
      if (this.refreshAborted) break;
      const chunk = pubkeys.slice(i, i + CHUNK_SIZE);
      await this.trustService.fetchMetricsBatch(chunk, true);
      this.refreshCompleted.update(n => n + chunk.length);
    }

    this.refreshStatus.set('done');
    setTimeout(() => this.refreshStatus.set('idle'), 3000);
  }
}
