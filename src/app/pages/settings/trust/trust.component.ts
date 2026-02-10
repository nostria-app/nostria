import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { TrustProviderService, KNOWN_PROVIDERS, KnownProvider } from '../../../services/trust-provider.service';
import { AccountStateService } from '../../../services/account-state.service';

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

  /** Available presets for known trust providers */
  knownProviders = KNOWN_PROVIDERS;

  /** Publishing state */
  publishStatus = signal<'idle' | 'publishing' | 'success' | 'error'>('idle');
  publishError = signal<string>('');

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
  getProviderName(pubkey: string): string {
    const known = KNOWN_PROVIDERS.find(p => p.pubkey === pubkey);
    return known?.name ?? pubkey.substring(0, 12) + '…';
  }

  // Available fallback trust relays (used when no kind 10040 is configured)
  trustRelays: TrustRelay[] = [
    {
      url: 'wss://nip85.brainstorm.world',
      name: 'Brainstorm',
      description: 'Default NIP-85 trusted assertions relay',
    },
    {
      url: 'wss://nip85.nostr.band',
      name: 'Nostr Band',
      description: 'Alternative NIP-85 trusted assertions relay',
    },
  ];

  ngOnInit(): void {
    if (!this.rightPanel.hasContent()) {
      this.panelActions.setPageTitle($localize`:@@settings.trust.title:Trust`);
    }

    // Load provider list if not already loaded
    if (!this.trustProviderService.loaded()) {
      this.trustProviderService.loadProviders();
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
}
