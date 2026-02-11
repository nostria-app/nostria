import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy, DestroyRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { TrustProviderService, KNOWN_PROVIDERS, KnownProvider } from '../../../services/trust-provider.service';
import { AccountStateService } from '../../../services/account-state.service';
import { TrustService } from '../../../services/trust.service';

interface TrustRelay {
  url: string;
  name: string;
  description: string;
}

@Component({
  selector: 'app-trust-settings',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
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

  /** Available presets for known trust providers */
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

  /** Whether user is authenticated (can publish kind 10040) */
  readonly isAuthenticated = computed(() => {
    const account = this.accountState.account();
    return !!account && account.source !== 'preview';
  });

  /** Check if a known provider is configured */
  isProviderConfigured(provider: KnownProvider): boolean {
    return this.trustProviderService.isKnownProviderConfigured(provider);
  }

  /** Check if a known provider is configured as private */
  isProviderPrivate(provider: KnownProvider): boolean {
    return this.trustProviderService.isKnownProviderPrivate(provider);
  }

  /** Unique public providers grouped by name */
  readonly uniquePublicProviders = computed(() => {
    const providers = this.trustProviderService.publicProviders();
    const seen = new Map<string, { pubkey: string; relayUrl: string; metrics: string[] }>();
    for (const p of providers) {
      const key = p.pubkey;
      if (seen.has(key)) {
        seen.get(key)!.metrics.push(p.kindTag);
      } else {
        seen.set(key, { pubkey: p.pubkey, relayUrl: p.relayUrl, metrics: [p.kindTag] });
      }
    }
    return [...seen.values()];
  });

  /** Unique private providers grouped by name */
  readonly uniquePrivateProviders = computed(() => {
    const providers = this.trustProviderService.privateProviders();
    const seen = new Map<string, { pubkey: string; relayUrl: string; metrics: string[] }>();
    for (const p of providers) {
      const key = p.pubkey;
      if (seen.has(key)) {
        seen.get(key)!.metrics.push(p.kindTag);
      } else {
        seen.set(key, { pubkey: p.pubkey, relayUrl: p.relayUrl, metrics: [p.kindTag] });
      }
    }
    return [...seen.values()];
  });

  /** Resolve a provider pubkey to a known provider name, if applicable */
  getProviderName(pubkey: string, relayUrl?: string): string {
    // Match by relay URL first (more reliable since pubkeys vary per algorithm)
    if (relayUrl) {
      const knownByRelay = KNOWN_PROVIDERS.find(p => p.relayUrl === relayUrl);
      if (knownByRelay) return knownByRelay.name;
    }
    const known = KNOWN_PROVIDERS.find(p => p.pubkey === pubkey);
    return known?.name ?? pubkey.substring(0, 12) + '…';
  }

  /** Whether Brainstorm is already configured with rank scoring */
  readonly hasBrainstormRank = computed(() => this.trustProviderService.hasBrainstormRank());

  // Available fallback trust relays (used when no kind 10040 is configured)
  trustRelays: TrustRelay[] = [
    {
      url: 'wss://nip85.brainstorm.world',
      name: 'Brainstorm',
      description: 'Default NIP-85 trusted assertions relay',
    },
  ];

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

  setTrustRelay(url: string): void {
    this.localSettings.setTrustRelay(url);
  }

  /** Add a known provider to the configuration */
  addKnownProvider(provider: KnownProvider, isPrivate: boolean): void {
    this.trustProviderService.addKnownProvider(provider, isPrivate);
  }

  /** Remove a known provider from the configuration */
  removeKnownProvider(provider: KnownProvider): void {
    this.trustProviderService.removeKnownProvider(provider);
  }

  /** Remove by pubkey (for custom providers shown in the list) */
  removeProviderByPubkey(pubkey: string): void {
    this.trustProviderService.publicProviders.update(list =>
      list.filter(p => p.pubkey !== pubkey)
    );
    this.trustProviderService.privateProviders.update(list =>
      list.filter(p => p.pubkey !== pubkey)
    );
  }

  /** Publish the provider configuration as a kind 10040 event */
  async publishProviders(): Promise<void> {
    this.publishStatus.set('publishing');
    this.publishError.set('');

    const result = await this.trustProviderService.publishProviders();

    if (result.success) {
      this.publishStatus.set('success');
      // Reset after a few seconds
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

  /** Refresh trust ranks for all followed accounts with progress tracking */
  async refreshTrustRanks(): Promise<void> {
    const pubkeys = this.accountState.followingList();
    if (pubkeys.length === 0) return;

    this.refreshAborted = false;
    this.refreshStatus.set('refreshing');
    this.refreshTotal.set(pubkeys.length);
    this.refreshCompleted.set(0);

    // Abort on destroy
    this.destroyRef.onDestroy(() => {
      this.refreshAborted = true;
    });

    // Process in small concurrent batches for efficiency
    const BATCH_SIZE = 10;
    for (let i = 0; i < pubkeys.length; i += BATCH_SIZE) {
      if (this.refreshAborted) break;
      const batch = pubkeys.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (pubkey) => {
          try {
            await this.trustService.fetchMetrics(pubkey, true);
          } catch {
            // Continue on individual failures
          } finally {
            this.refreshCompleted.update(n => n + 1);
          }
        })
      );
    }

    this.refreshStatus.set('done');
    setTimeout(() => this.refreshStatus.set('idle'), 3000);
  }
}
