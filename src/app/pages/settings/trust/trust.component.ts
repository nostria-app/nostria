import { Component, inject, signal, computed, effect, ChangeDetectionStrategy, OnInit, OnDestroy, DestroyRef } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { BRAINSTORM_TRUST_RELAY, TrustProviderService, KNOWN_PROVIDERS, KnownProvider } from '../../../services/trust-provider.service';
import { AccountStateService } from '../../../services/account-state.service';
import { TrustService } from '../../../services/trust.service';
import { BrainstormRequestInstance, BrainstormSetup, BrainstormWotApiService } from '../../../services/brainstorm-wot-api.service';
import type { Event as NostrEvent } from 'nostr-tools';

interface TrustProviderTagViewModel {
  kind: number;
  metric: string;
  pubkey: string;
  relay: string;
}

type CountValuesMap = Record<string, Record<string, number>>;

interface CountValueLevelViewModel {
  level: string;
  count: number;
}

interface CountValueGroupViewModel {
  name: string;
  levels: CountValueLevelViewModel[];
}

@Component({
  selector: 'app-trust-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './trust.component.html',
  styleUrl: './trust.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
})
export class TrustSettingsComponent implements OnInit, OnDestroy {
  private readonly legacyBrainstormRelays = new Set([
    'wss://nip85.brainstorm.world',
  ]);

  trustProviderService = inject(TrustProviderService);
  private accountState = inject(AccountStateService);
  private panelActions = inject(PanelActionsService);
  private rightPanel = inject(RightPanelService);
  private trustService = inject(TrustService);
  private brainstormApi = inject(BrainstormWotApiService);
  private destroyRef = inject(DestroyRef);

  /** Available scoring services */
  knownProviders = KNOWN_PROVIDERS;

  followingListLoaded = computed(() => this.accountState.followingListLoaded());
  followingCount = computed(() => this.accountState.followingList().length);
  canRefreshTrustRanks = computed(() => {
    return this.trustService.isEnabled()
      && this.followingListLoaded()
      && this.followingCount() > 0
      && this.refreshStatus() !== 'refreshing';
  });

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

  /** Brainstorm API setup and calculation state */
  brainstormStatusLoading = signal(false);
  brainstormActivateLoading = signal(false);
  brainstormRecalculateLoading = signal(false);
  brainstormConfigLoading = signal(false);
  brainstormStatusChecked = signal(false);
  brainstormStatus = signal<BrainstormRequestInstance | null>(null);
  brainstormCountValueGroups = signal<CountValueGroupViewModel[]>([]);
  brainstormError = signal<string | null>(null);
  brainstormMessage = signal<string | null>(null);
  copyPasswordStatus = signal<'idle' | 'done' | 'error'>('idle');
  show10040Event = signal(false);
  event10040 = signal<NostrEvent | null>(null);
  event10040Tags = signal<TrustProviderTagViewModel[]>([]);
  copy10040Status = signal<'idle' | 'done' | 'error'>('idle');
  private hasAutoLoadedStatus = false;

  canRetryBrainstormActivation = computed(() => {
    return !this.brainstormActivateLoading()
      && !this.brainstormStatusLoading()
      && !this.brainstormRecalculateLoading()
      && !this.brainstormConfigLoading();
  });

  shouldShowPersonalizedScoring = computed(() => {
    return this.isBrainstormActivated()
      || this.brainstormActivateLoading()
      || this.brainstormStatusLoading()
      || this.brainstormRecalculateLoading()
      || this.brainstormConfigLoading()
      || this.brainstormStatusChecked()
      || !!this.brainstormError()
      || !!this.brainstormMessage();
  });

  /** Check if a known provider is enabled */
  isProviderConfigured(provider: KnownProvider): boolean {
    return this.trustProviderService.isKnownProviderConfigured(provider);
  }

  canRecalculate = computed(() => {
    const status = (this.brainstormStatus()?.status || '').toLowerCase();
    return this.isBrainstormActivated() && ['success', 'failed', 'failure', 'error'].includes(status);
  });

  hasFailedBrainstormCalculation = computed(() => {
    const status = (this.brainstormStatus()?.status || '').toLowerCase();
    return status === 'failed' || status === 'failure' || status === 'error';
  });

  hasCompletedBrainstormCalculation = computed(() => {
    const status = (this.brainstormStatus()?.status || '').toLowerCase();
    return ['success', 'failed', 'failure', 'error'].includes(status);
  });

  constructor() {
    effect(() => {
      const loaded = this.trustProviderService.loaded();
      const activated = this.isBrainstormActivated();

      if (!loaded || !activated || this.hasAutoLoadedStatus) {
        return;
      }

      this.hasAutoLoadedStatus = true;
      void this.checkBrainstormStatus();
    });
  }

  needsBrainstormMigration = computed(() => {
    if (!this.trustProviderService.hasEvent()) {
      return false;
    }

    return this.trustProviderService
      .allProviders()
      .some(provider => this.legacyBrainstormRelays.has(provider.relayUrl));
  });

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

  /** Open Brainstorm activation page */
  openBrainstorm(): void {
    window.open('https://brainstorm.nosfabrica.com/', '_blank', 'noopener,noreferrer');
  }

  isBrainstormActivated(): boolean {
    const requiredTags = new Set(['30382:rank', '30382:followers']);
    const configuredTags = new Set(
      this.trustProviderService
        .allProviders()
        .filter(provider => provider.relayUrl === BRAINSTORM_TRUST_RELAY)
        .map(provider => provider.kindTag),
    );

    return [...requiredTags].every(tag => configuredTags.has(tag));
  }

  async activateProvider(_provider: KnownProvider): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.brainstormError.set($localize`:@@settings.trust.brainstorm.noAccount:No active account`);
      return;
    }

    this.brainstormActivateLoading.set(true);
    this.brainstormError.set(null);
    this.brainstormMessage.set(null);

    try {
      const setup = await this.loadBrainstormSetup(pubkey);
      this.trustProviderService.clearConfiguredProviders();
      this.addBrainstormProviders(setup.configTags);

      const publishResult = await this.trustProviderService.publishProviders();
      if (!publishResult.success) {
        throw new Error(publishResult.error || 'Failed to publish provider config');
      }

      let processingResult: BrainstormRequestInstance | null = null;

      try {
        processingResult = await this.brainstormApi.startGraperank(pubkey);
      } catch {
        processingResult = await this.brainstormApi.getLatestGraperank(pubkey);
      }

      this.brainstormStatus.set(processingResult);
      this.updateCountValuesFromStatus(processingResult);
      this.brainstormStatusChecked.set(true);
    } catch (error) {
      this.brainstormError.set(this.errorToMessage(error));
    } finally {
      this.brainstormActivateLoading.set(false);
    }
  }

  async retryBrainstormActivation(): Promise<void> {
    const brainstormProvider = this.getBrainstormProvider();
    if (!brainstormProvider) {
      this.brainstormError.set($localize`:@@settings.trust.brainstorm.providerMissing:Brainstorm provider is not available.`);
      return;
    }

    await this.activateProvider(brainstormProvider);
  }

  async checkBrainstormStatus(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.brainstormError.set($localize`:@@settings.trust.brainstorm.noAccount:No active account`);
      return;
    }

    this.brainstormStatusLoading.set(true);
    this.brainstormError.set(null);
    this.brainstormMessage.set(null);

    try {
      const latest = await this.brainstormApi.getLatestGraperank(pubkey);
      this.brainstormStatus.set(latest);
      this.updateCountValuesFromStatus(latest);
      this.brainstormStatusChecked.set(true);

      try {
        await this.brainstormApi.getSetup(pubkey);
      } catch {
      }

      if (!latest) {
        this.brainstormMessage.set($localize`:@@settings.trust.brainstorm.noRun:No calculation found yet.`);
      }
    } catch (error) {
      this.brainstormError.set(this.errorToMessage(error));
    } finally {
      this.brainstormStatusLoading.set(false);
    }
  }

  async startBrainstormCalculation(): Promise<void> {
    if (!this.canRecalculate()) {
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.brainstormError.set($localize`:@@settings.trust.brainstorm.noAccount:No active account`);
      return;
    }

    this.brainstormRecalculateLoading.set(true);
    this.brainstormError.set(null);
    this.brainstormMessage.set(null);

    try {
      const result = await this.brainstormApi.startGraperank(pubkey);
      this.brainstormStatus.set(result);
      this.updateCountValuesFromStatus(result);
      this.brainstormStatusChecked.set(true);
      this.brainstormMessage.set($localize`:@@settings.trust.brainstorm.recalculateStarted:Recalculation started.`);
    } catch (error) {
      this.brainstormError.set(this.errorToMessage(error));
    } finally {
      this.brainstormRecalculateLoading.set(false);
    }
  }

  async copyBrainstormPassword(): Promise<void> {
    const password = this.brainstormStatus()?.password;
    if (!password) {
      this.copyPasswordStatus.set('error');
      setTimeout(() => this.copyPasswordStatus.set('idle'), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(password);
      this.copyPasswordStatus.set('done');
      setTimeout(() => this.copyPasswordStatus.set('idle'), 2000);
    } catch {
      this.copyPasswordStatus.set('error');
      setTimeout(() => this.copyPasswordStatus.set('idle'), 2000);
    }
  }

  async autoConfigureBrainstorm(): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.brainstormError.set($localize`:@@settings.trust.brainstorm.noAccount:No active account`);
      return;
    }

    this.brainstormConfigLoading.set(true);
    this.brainstormError.set(null);
    this.brainstormMessage.set(null);

    try {
      const setup = await this.loadBrainstormSetup(pubkey);
      const configTags = setup.configTags;
      const brainstormProvider = KNOWN_PROVIDERS.find(provider => provider.name === 'Brainstorm');
      if (brainstormProvider) {
        this.trustProviderService.removeKnownProvider(brainstormProvider);
      }

      if (configTags.length === 0) {
        throw new Error('Brainstorm setup did not return any trust provider tags');
      }

      const relaysFromConfig = new Set(configTags.map(tag => tag[2]));
      const existingProviders = [...this.trustProviderService.allProviders()];
      for (const provider of existingProviders) {
        if (relaysFromConfig.has(provider.relayUrl)) {
          this.trustProviderService.removeProvider(provider.kindTag, provider.pubkey);
        }
      }

      this.addBrainstormProviders(configTags);

      const publishResult = await this.trustProviderService.publishProviders();
      if (!publishResult.success) {
        throw new Error(publishResult.error || 'Failed to publish provider config');
      }

      this.brainstormMessage.set($localize`:@@settings.trust.brainstorm.configFromApi:Brainstorm provider tags configured from API.`);
    } catch (error) {
      this.brainstormError.set(this.errorToMessage(error));
    } finally {
      this.brainstormConfigLoading.set(false);
    }
  }

  private async loadBrainstormSetup(pubkey: string): Promise<BrainstormSetup> {
    await this.brainstormApi.authenticate(pubkey);

    const setup = await this.brainstormApi.getSetup(pubkey);
    if (setup.configTags.length === 0 || !setup.publisherPubkey) {
      throw new Error('Brainstorm setup is not available for this account yet');
    }

    return setup;
  }

  private getBrainstormProvider(): KnownProvider | undefined {
    return KNOWN_PROVIDERS.find(provider => provider.name === 'Brainstorm');
  }

  private addBrainstormProviders(configTags: BrainstormSetup['configTags']): void {
    for (const tag of configTags) {
      this.trustProviderService.addProvider(
        {
          kindTag: tag[0],
          pubkey: tag[1],
          relayUrl: tag[2],
        },
        false,
      );
    }
  }

  formatIsoDate(dateValue: string | null): string {
    if (!dateValue) {
      return '-';
    }

    const parsedDate = new Date(dateValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return dateValue;
    }

    return parsedDate.toLocaleString();
  }

  private errorToMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return $localize`:@@settings.trust.brainstorm.errorGeneric:Something went wrong while talking to Brainstorm.`;
  }

  toggleShow10040Event(): void {
    const shouldShow = !this.show10040Event();
    this.show10040Event.set(shouldShow);

    if (!shouldShow) {
      return;
    }

    const event = this.trustProviderService.getCurrentEvent();
    this.event10040.set(event);
    if (!event) {
      this.event10040Tags.set([]);
      return;
    }

    this.event10040Tags.set(
      event.tags
        .filter(tag => tag.length >= 3 && tag[0].includes(':'))
        .map(tag => {
          const [kindText, ...metricParts] = tag[0].split(':');
          const kind = Number.parseInt(kindText, 10);
          const metric = metricParts.join(':');

          return {
            kind: Number.isNaN(kind) ? 0 : kind,
            metric,
            pubkey: tag[1],
            relay: tag[2],
          };
        }),
    );
  }

  async copy10040Json(): Promise<void> {
    const event = this.event10040() || this.trustProviderService.getCurrentEvent();
    if (!event) {
      this.copy10040Status.set('error');
      setTimeout(() => this.copy10040Status.set('idle'), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      this.copy10040Status.set('done');
      setTimeout(() => this.copy10040Status.set('idle'), 2000);
    } catch {
      this.copy10040Status.set('error');
      setTimeout(() => this.copy10040Status.set('idle'), 2000);
    }
  }

  formatNostrTimestamp(timestampSeconds: number): string {
    const parsedDate = new Date(timestampSeconds * 1000);
    if (Number.isNaN(parsedDate.getTime())) {
      return String(timestampSeconds);
    }

    return parsedDate.toLocaleString();
  }

  formatNullableValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    return String(value);
  }

  formatStatusLabel(value: string | null | undefined): string {
    const status = (value || '').trim();
    if (!status) {
      return 'unknown';
    }

    return status;
  }

  formatCalculationStatus(value: string | null | undefined): string {
    const status = (value || '').trim().toLowerCase();
    if (!status) {
      return 'UNKNOWN';
    }

    if (status === 'success') {
      return 'COMPLETE';
    }

    if (status === 'failed' || status === 'failure' || status === 'error') {
      return 'FAILED';
    }

    return status.toUpperCase();
  }

  getStatusPillClass(value: string | null | undefined): string {
    const status = (value || '').toLowerCase();
    if (status === 'success') {
      return 'success';
    }

    if (status === 'failed' || status === 'failure' || status === 'error') {
      return 'error';
    }

    return 'neutral';
  }

  private updateCountValuesFromStatus(status: BrainstormRequestInstance | null): void {
    if (!status?.count_values) {
      this.brainstormCountValueGroups.set([]);
      return;
    }

    this.brainstormCountValueGroups.set(this.parseCountValues(status.count_values));
  }

  private parseCountValues(raw: string): CountValueGroupViewModel[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!this.isCountValuesMap(parsed)) {
        return [];
      }

      return Object.entries(parsed).map(([groupName, levelsMap]) => {
        const levels = Object.entries(levelsMap)
          .map(([level, count]) => ({ level, count }))
          .sort((a, b) => Number.parseFloat(a.level) - Number.parseFloat(b.level));

        return {
          name: groupName.replaceAll('_', ' '),
          levels,
        };
      });
    } catch {
      return [];
    }
  }

  private isCountValuesMap(value: unknown): value is CountValuesMap {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    for (const group of Object.values(value)) {
      if (typeof group !== 'object' || group === null) {
        return false;
      }

      for (const count of Object.values(group)) {
        if (typeof count !== 'number') {
          return false;
        }
      }
    }

    return true;
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

    await this.trustService.preloadTrustRanks(pubkeys, {
      forceRefresh: true,
      chunkSize: 50,
      shouldAbort: () => this.refreshAborted,
      onProgress: (completed, total) => {
        this.refreshTotal.set(total);
        this.refreshCompleted.set(completed);
      },
    });

    this.refreshStatus.set('done');
    setTimeout(() => this.refreshStatus.set('idle'), 3000);
  }
}
