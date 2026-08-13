import { Clipboard } from '@angular/cdk/clipboard';
import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, finalizeEvent, kinds, type UnsignedEvent } from 'nostr-tools';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { DateToggleComponent } from '../../../components/date-toggle/date-toggle.component';
import { ImageInputComponent } from '../../../components/image-input/image-input.component';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { CorsProxyService } from '../../../services/cors-proxy.service';
import { DatabaseService } from '../../../services/database.service';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { LoggerService } from '../../../services/logger.service';
import { NostrService } from '../../../services/nostr.service';
import { DataService } from '../../../services/data.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { parsePodcastRssFeed, type ParsedPodcastEpisode, type ParsedPodcastShow } from '../../../utils/podcast-rss';
import {
  buildPodcastLoginCredentials,
  buildPodcastProfileContent,
  deriveShortProfileName,
  emptyPodcastProfile,
  generatePodcastKeypair,
  parsePodcastIdentityJson,
  parsePodcastIdentitySecret,
  profileToShowDraft,
  type GeneratedPodcastKeypair,
  type PodcastProfileDraft,
} from '../../../utils/podcast-identity';
import {
  importEventSigner,
  publishedPodcastAudioUrls,
  readProfileLightningAddress,
  selectUnpublishedEpisodes,
  uniqueRelayUrls,
} from '../../../utils/podcast-import-plan';
import {
  AUTHORED_PODCASTS_KIND,
  buildPodcastEpisodeTags,
  buildPodcastShowTags,
  isValidHttpUrl,
  PODCAST_EPISODE_KIND,
  PODCAST_METADATA_KIND,
} from '../../../utils/podcast';
import { DEFAULT_PODCAST_RELAYS } from '../../../utils/podcast-default-relays';

interface ImportEpisode extends ParsedPodcastEpisode {
  selected: boolean;
  expanded: boolean;
}

interface PodcastEventPreview {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

type PodcastIdentityMode = 'current' | 'new' | 'import' | 'nsec';

interface ResolvedIdentity {
  useIdentity: boolean;
  pubkey: string;
  npub: string;
  secretKey: Uint8Array | null;
}

function isPodcastIdentityMode(value: string): value is PodcastIdentityMode {
  return value === 'current' || value === 'new' || value === 'import' || value === 'nsec';
}

@Component({
  selector: 'app-import-podcast-rss-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CustomDialogComponent,
    DateToggleComponent,
    ImageInputComponent,
    FormsModule,
    JsonPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './import-podcast-rss-dialog.component.html',
  styleUrl: './import-podcast-rss-dialog.component.scss',
})
export class ImportPodcastRssDialogComponent {
  closed = output<{ published: boolean } | null>();

  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private pool = inject(RelayPoolService);
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private podcastData = inject(PodcastDataService);
  private data = inject(DataService);
  private corsProxy = inject(CorsProxyService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private clipboard = inject(Clipboard);
  private router = inject(Router);

  readonly dialogTitle = $localize`:@@podcasts.import.title:Import from RSS`;
  readonly showCoverLabel = $localize`:@@podcasts.show.cover:Cover image`;
  readonly episodeCoverLabel = $localize`:@@podcasts.publish.cover:Cover image`;
  readonly profilePictureLabel = $localize`:@@podcasts.import.profilePicture:Profile picture`;
  readonly selectEpisodeLabel = $localize`:@@podcasts.import.selectEpisode:Select episode`;
  readonly copyNpubLabel = $localize`:@@podcasts.import.copyNpub:Copy npub`;
  readonly rssUrl = signal('');
  readonly isFetching = signal(false);
  readonly isPublishing = signal(false);
  readonly hasFetched = signal(false);
  readonly showPreview = signal(false);
  readonly publishShow = signal(true);
  readonly publishProfile = signal(true);
  readonly identityMode = signal<PodcastIdentityMode>('current');
  readonly nsecInput = signal('');
  readonly podcastNpub = signal('');
  readonly podcastPubkey = signal('');
  private readonly identityFileInput = viewChild<ElementRef<HTMLInputElement>>('identityFileInput');
  readonly profile = signal<PodcastProfileDraft>(emptyPodcastProfile());
  readonly showInfo = signal<ParsedPodcastShow>({
    title: '',
    description: '',
    imageUrl: '',
    website: '',
  });
  readonly episodes = signal<ImportEpisode[]>([]);
  readonly previewEvents = signal<PodcastEventPreview[]>([]);

  readonly isPremium = computed(() => !!this.accountState.hasActiveSubscription());
  readonly accountNpub = computed(() => this.accountState.npub());
  readonly identityImported = computed(() => {
    const mode = this.identityMode();
    return mode === 'import' || mode === 'nsec';
  });
  readonly episodeCount = computed(() => this.episodes().length);
  readonly selectedCount = computed(() => this.episodes().filter(episode => episode.selected).length);
  readonly canPublish = computed(() => {
    if (this.isPublishing()) {
      return false;
    }
    if (this.identityMode() !== 'current') {
      const profile = this.profile();
      if (!this.podcastPubkey()) {
        return false;
      }
      if (this.publishProfile() && !(profile.displayName.trim() || profile.name.trim())) {
        return false;
      }
      return this.selectedCount() > 0 || this.publishShow() || this.publishProfile();
    }
    if (this.publishShow() && !this.showInfo().title.trim()) {
      return false;
    }
    return this.selectedCount() > 0 || this.publishShow();
  });
  readonly publishLabel = computed(() => {
    const selected = this.selectedCount();
    if (this.identityMode() === 'new') {
      return selected > 0
        ? $localize`:@@podcasts.import.publishNewIdentity:Publish new podcast + ${selected}:count: episodes`
        : $localize`:@@podcasts.import.publishNewIdentityOnly:Publish new podcast identity`;
    }
    if (this.publishShow() && selected > 0) {
      return $localize`:@@podcasts.import.publishShowAndEpisodes:Publish show + ${selected}:count: episodes`;
    }
    if (this.publishShow()) {
      return $localize`:@@podcasts.import.publishShowOnly:Publish show details`;
    }
    return $localize`:@@podcasts.import.publishEpisodes:Publish ${selected}:count: episodes`;
  });
  readonly publishSummaryLines = computed(() => this.buildPublishSummaryLines());
  readonly publishSummarySigner = computed(() => {
    const identity = this.resolveIdentity();
    if (!identity.useIdentity) {
      return $localize`:@@podcasts.import.summarySignedByYou:Signed by your account`;
    }
    return this.identityImported()
      ? $localize`:@@podcasts.import.summarySignedByImported:Signed by the imported podcast identity`
      : $localize`:@@podcasts.import.summarySignedByIdentity:Signed by the new podcast identity`;
  });
  readonly publishSummaryRelays = computed(() => {
    if (this.resolveIdentity().useIdentity) {
      return $localize`:@@podcasts.import.summaryRelaysIdentity:Published to your relays, podcast relays, and discovery relays (NIP-65)`;
    }
    return $localize`:@@podcasts.import.summaryRelaysAccount:Published to your relays and podcast relays`;
  });

  private secretKey: Uint8Array | null = null;
  private nameManuallyEdited = false;
  private identityLoadToken = 0;

  constructor() {
    void this.podcastData.ensureInitialized();
  }

  async fetchRss(): Promise<void> {
    const url = this.rssUrl().trim();
    if (!url) {
      this.snackBar.open($localize`:@@podcasts.import.needUrl:Enter an RSS feed URL`, '', { duration: 3000 });
      return;
    }

    this.isFetching.set(true);
    try {
      const text = await this.corsProxy.fetchText(url);
      const feed = parsePodcastRssFeed(text);
      if (feed.episodes.length === 0) {
        this.snackBar.open($localize`:@@podcasts.import.noEpisodes:No audio episodes found in this feed`, '', {
          duration: 3000,
        });
        return;
      }

      this.showInfo.set(feed.show);
      this.episodes.set(
        [...feed.episodes]
          .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
          .map(episode => ({
            ...episode,
            selected: true,
            expanded: false,
          }))
      );
      this.publishShow.set(!!feed.show.title);
      this.clearGeneratedIdentity();
      this.hasFetched.set(true);
      this.showPreview.set(false);
      this.snackBar.open(
        $localize`:@@podcasts.import.found:Found ${feed.episodes.length}:count: episodes`,
        '',
        { duration: 2000 }
      );
    } catch (error) {
      this.logger.error('Error fetching podcast RSS:', error);
      this.snackBar.open(
        error instanceof Error ? error.message : $localize`:@@podcasts.import.fetchFailed:Failed to fetch RSS`,
        '',
        { duration: 4000 }
      );
    } finally {
      this.isFetching.set(false);
    }
  }

  selectIdentityMode(mode: string): void {
    if (!isPodcastIdentityMode(mode)) {
      return;
    }

    if (mode !== 'current' && !this.isPremium()) {
      this.clearGeneratedIdentity();
      this.snackBar.open($localize`:@@podcasts.import.premiumRequired:Premium is required to publish as a new podcast identity`, '', {
        duration: 4000,
      });
      return;
    }

    if (mode === 'current') {
      this.clearGeneratedIdentity();
      return;
    }

    if (mode === 'new') {
      this.applyIdentity(generatePodcastKeypair(), 'new');
      this.nsecInput.set('');
      return;
    }

    if (this.identityMode() !== mode) {
      this.clearDedicatedIdentity();
      this.identityMode.set(mode);
    }

    if (mode === 'import') {
      queueMicrotask(() => this.identityFileInput()?.nativeElement.click());
    }
  }

  importIdentityFile(event: globalThis.Event): void {
    if (!this.isPremium()) {
      return;
    }

    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const content = typeof reader.result === 'string' ? reader.result : '';
        this.applyIdentity(parsePodcastIdentityJson(content), 'import');
        this.snackBar.open($localize`:@@podcasts.import.identityLoaded:Podcast identity loaded`, '', { duration: 2500 });
      } catch {
        this.snackBar.open($localize`:@@podcasts.import.invalidIdentityFile:Invalid identity JSON file`, '', { duration: 3000 });
      }
    };
    reader.readAsText(file);
  }

  applyNsecIdentity(): void {
    if (!this.isPremium()) {
      return;
    }

    try {
      this.applyIdentity(parsePodcastIdentitySecret(this.nsecInput()), 'nsec');
      this.nsecInput.set('');
      this.snackBar.open($localize`:@@podcasts.import.identityLoaded:Podcast identity loaded`, '', { duration: 2500 });
    } catch {
      this.snackBar.open($localize`:@@podcasts.import.invalidNsec:Enter a valid nsec or hex private key`, '', { duration: 3000 });
    }
  }

  updateDisplayName(value: string): void {
    const updates: Partial<PodcastProfileDraft> = { displayName: value };
    if (!this.nameManuallyEdited) {
      updates.name = deriveShortProfileName(value);
    }
    this.updateProfile(updates);
  }

  updateShortName(value: string): void {
    this.nameManuallyEdited = true;
    this.updateProfile({ name: value });
  }

  appendUnofficialDisclaimer(): void {
    const npub = this.accountNpub();
    if (!npub) {
      this.snackBar.open($localize`:@@podcasts.import.signIn:Sign in to import a podcast`, '', { duration: 3000 });
      return;
    }

    const disclaimer = $localize`:@@podcasts.import.unofficialDisclaimer:This podcast is republished on Nostr by an unofficial maintainer. Zaps paid here go to that maintainer, not the original podcast author. If you are the original author and want to self-publish, please contact the publisher: ${npub}:npub:.`;
    const about = this.profile().about.trim();
    if (about.includes(disclaimer)) {
      return;
    }

    this.updateProfile({ about: about ? `${about}\n\n${disclaimer}` : disclaimer });
    if (!this.publishProfile()) {
      this.publishProfile.set(true);
    }
  }

  updateProfile(updates: Partial<PodcastProfileDraft>): void {
    this.profile.update(profile => {
      const next = { ...profile, ...updates };
      this.showInfo.update(show => ({
        ...show,
        ...profileToShowDraft(next),
      }));
      return next;
    });
  }

  updateShow(updates: Partial<ParsedPodcastShow>): void {
    this.showInfo.update(show => ({ ...show, ...updates }));
  }

  updateEpisode(index: number, updates: Partial<ImportEpisode>): void {
    this.episodes.update(episodes => {
      const next = [...episodes];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }

  toggleExpanded(index: number): void {
    this.updateEpisode(index, { expanded: !this.episodes()[index].expanded });
  }

  toggleSelected(index: number, selected: boolean): void {
    this.updateEpisode(index, { selected });
  }

  selectAll(selected: boolean): void {
    this.episodes.update(episodes => episodes.map(episode => ({ ...episode, selected })));
  }

  expandAll(expanded: boolean): void {
    this.episodes.update(episodes => episodes.map(episode => ({ ...episode, expanded })));
  }

  copyNpub(): void {
    const npub = this.podcastNpub();
    if (!npub) {
      return;
    }
    this.clipboard.copy(npub);
    this.snackBar.open($localize`:@@podcasts.import.npubCopied:Podcast npub copied`, '', { duration: 2000 });
  }

  downloadCredentials(): void {
    if (!this.secretKey) {
      this.snackBar.open($localize`:@@podcasts.import.noKeys:Generate a podcast identity first`, '', { duration: 3000 });
      return;
    }

    const credentials = buildPodcastLoginCredentials(this.secretKey);
    const blob = new Blob([JSON.stringify(credentials, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `nostr-credentials-${credentials.pubkey.substring(0, 8)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    this.snackBar.open($localize`:@@podcasts.import.keysDownloaded:Credentials downloaded`, '', { duration: 2500 });
  }

  goBack(): void {
    this.hasFetched.set(false);
    this.showPreview.set(false);
    this.episodes.set([]);
    this.previewEvents.set([]);
    this.clearGeneratedIdentity();
  }

  togglePreview(): void {
    if (this.showPreview()) {
      this.showPreview.set(false);
      this.previewEvents.set([]);
      return;
    }

    this.previewEvents.set(this.generateEventTemplates());
    this.showPreview.set(true);
  }

  async publish(): Promise<void> {
    const accountPubkey = this.accountState.pubkey();
    if (!accountPubkey) {
      this.snackBar.open($localize`:@@podcasts.import.signIn:Sign in to import a podcast`, '', { duration: 3000 });
      return;
    }

    const identity = this.resolveIdentity();
    if (this.identityMode() !== 'current' && !identity.useIdentity) {
      this.snackBar.open($localize`:@@podcasts.import.premiumRequired:Premium is required to publish as a new podcast identity`, '', {
        duration: 4000,
      });
      return;
    }

    const templates = this.generateEventTemplates();
    if (templates.length === 0) {
      this.snackBar.open($localize`:@@podcasts.import.nothingSelected:Nothing selected to publish`, '', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);
    this.showPreview.set(false);

    try {
      const signedEvents: Event[] = [];
      for (const template of templates) {
        try {
          const signed = await this.signImportEvent(template, identity, accountPubkey);
          if (identity.useIdentity && importEventSigner(signed.kind, true) === 'identity' && signed.pubkey !== identity.pubkey) {
            throw new Error('Podcast identity event was not signed by the generated key');
          }
          signedEvents.push(signed);
        } catch (error) {
          this.logger.error('Failed to sign imported podcast event:', error);
          if (signedEvents.length === 0) {
            throw error;
          }
          break;
        }
      }

      let publishedCount = 0;
      for (const signed of signedEvents) {
        try {
          await this.publishImportEvent(signed, identity.useIdentity);
          await this.persistPublishedEvent(signed);
          publishedCount += 1;
        } catch (error) {
          this.logger.warn('Failed to publish imported podcast event:', error);
        }
      }

      if (identity.useIdentity && publishedCount > 0) {
        await this.addAuthoredPodcast(accountPubkey, identity.pubkey);
        if (!this.identityImported()) {
          this.downloadCredentials();
        }
      }

      if (publishedCount === 0) {
        throw new Error('No events published');
      }

      if (publishedCount < templates.length) {
        this.snackBar.open(
          $localize`:@@podcasts.import.partialPublish:Published ${publishedCount}:count: of ${templates.length}:total: events`,
          '',
          { duration: 4000 },
        );
      } else {
        this.snackBar.open(
          $localize`:@@podcasts.import.published:Published ${publishedCount}:count: events`,
          '',
          { duration: 3000 },
        );
      }
      this.closed.emit({ published: true });
    } catch (error) {
      this.logger.error('Failed to publish imported podcast:', error);
      const message = error instanceof Error ? error.message : '';
      this.snackBar.open(
        message.toLowerCase().includes('insufficient permissions')
          ? $localize`:@@podcasts.import.extensionPermission:The extension denied signing. Approve "sign event" for Nostria, then publish again.`
          : $localize`:@@podcasts.import.publishFailed:Failed to publish imported podcast`,
        '',
        { duration: 5000 },
      );
    } finally {
      this.isPublishing.set(false);
    }
  }

  cancel(): void {
    this.clearGeneratedIdentity();
    this.closed.emit(null);
  }

  upgradeToPremium(): void {
    this.cancel();
    void this.router.navigate(['/premium/upgrade']);
  }

  private async persistPublishedEvent(signed: Event): Promise<void> {
    if (signed.kind === PODCAST_METADATA_KIND) {
      await this.database.saveReplaceableEvent(signed);
      this.podcastData.addShow(signed);
      return;
    }
    if (signed.kind === PODCAST_EPISODE_KIND) {
      await this.database.saveEvent(signed);
      this.podcastData.addEpisode(signed);
      return;
    }
    if (signed.kind === kinds.Metadata || signed.kind === kinds.RelayList || signed.kind === AUTHORED_PODCASTS_KIND) {
      await this.database.saveReplaceableEvent(signed);
    }
  }

  private async addAuthoredPodcast(authorPubkey: string, podcastPubkey: string): Promise<void> {
    try {
      const existing = await this.database.getEventByPubkeyAndKind(authorPubkey, AUTHORED_PODCASTS_KIND);
      const tags = (existing?.tags ?? []).filter(tag => !(tag[0] === 'p' && tag[1] === podcastPubkey));
      tags.push(['p', podcastPubkey]);

      const signed = await this.nostr.signEvent({
        kind: AUTHORED_PODCASTS_KIND,
        pubkey: authorPubkey,
        created_at: Math.floor(Date.now() / 1000),
        content: existing?.content ?? '',
        tags,
      });
      await this.publishToRelays(this.contentRelayUrls(), signed);
      await this.database.saveReplaceableEvent(signed);
      this.podcastData.addPublisher(signed);
    } catch (error) {
      this.logger.warn('Failed to update authored podcasts list:', error);
    }
  }

  private generateEventTemplates(): PodcastEventPreview[] {
    const now = Math.floor(Date.now() / 1000);
    const events: PodcastEventPreview[] = [];
    const identity = this.resolveIdentity();
    const accountPubkey = this.accountState.pubkey() || '';
    const publishPubkey = identity.useIdentity ? identity.pubkey : accountPubkey;
    const show = identity.useIdentity
      ? { ...this.showInfo(), ...profileToShowDraft(this.profile()) }
      : this.showInfo();

    if (!publishPubkey) {
      return events;
    }

    if (identity.useIdentity) {
      const contentRelays = this.contentRelayUrls();
      if (this.publishProfile()) {
        events.push({
          kind: kinds.Metadata,
          pubkey: identity.pubkey,
          created_at: now,
          tags: [],
          content: buildPodcastProfileContent(this.profile()),
        });
      }
      if (contentRelays.length > 0) {
        events.push({
          kind: kinds.RelayList,
          pubkey: identity.pubkey,
          created_at: now,
          tags: contentRelays.map(url => ['r', url]),
          content: '',
        });
      }
    }

    if (this.publishShow() && show.title.trim()) {
      const tags = buildPodcastShowTags(show);
      if (identity.useIdentity && accountPubkey) {
        tags.push(['p', accountPubkey, 'host']);
      }
      events.push({
        kind: PODCAST_METADATA_KIND,
        pubkey: publishPubkey,
        created_at: now,
        tags,
        content: '',
      });
    }

    for (const episode of this.episodes().filter(item => item.selected)) {
      if (!episode.title.trim() || !isValidHttpUrl(episode.audioUrl)) {
        continue;
      }

      events.push({
        kind: PODCAST_EPISODE_KIND,
        pubkey: publishPubkey,
        created_at: episode.publishedAt && episode.publishedAt > 0 ? episode.publishedAt : now,
        tags: buildPodcastEpisodeTags({
          title: episode.title,
          audioUrl: episode.audioUrl,
          audioType: episode.audioType,
          imageUrl: episode.imageUrl || show.imageUrl,
          description: episode.description,
          episode: episode.episode,
          duration: episode.durationSeconds ?? undefined,
        }),
        content: episode.notes.trim(),
      });
    }

    return events;
  }

  private resolveIdentity(): ResolvedIdentity {
    const useIdentity = this.identityMode() !== 'current'
      && this.isPremium() === true
      && this.secretKey !== null
      && this.podcastPubkey().length > 0;

    return {
      useIdentity,
      pubkey: useIdentity ? this.podcastPubkey() : '',
      npub: useIdentity ? this.podcastNpub() : '',
      secretKey: useIdentity ? this.secretKey : null,
    };
  }

  private async signImportEvent(
    template: PodcastEventPreview,
    identity: ResolvedIdentity,
    accountPubkey: string,
  ): Promise<Event> {
    const signer = importEventSigner(template.kind, identity.useIdentity);
    const unsigned: UnsignedEvent = {
      kind: template.kind,
      created_at: template.created_at,
      tags: template.tags,
      content: template.content,
      pubkey: signer === 'identity' ? identity.pubkey : accountPubkey,
    };

    if (signer === 'identity') {
      if (!identity.secretKey || unsigned.pubkey !== identity.pubkey) {
        throw new Error('Generated podcast identity is not available for signing');
      }
      return finalizeEvent(unsigned, identity.secretKey);
    }

    return this.nostr.signEvent(unsigned);
  }

  private async publishImportEvent(event: Event, useIdentity: boolean): Promise<void> {
    const contentRelays = this.contentRelayUrls();
    const discoveryRelays = this.discoveryRelayUrls();

    if (event.kind === kinds.RelayList && useIdentity) {
      await this.publishToRelays(uniqueRelayUrls([...contentRelays, ...discoveryRelays]), event);
      if (discoveryRelays.length === 0) {
        await this.discoveryRelay.publish(event);
      }
      return;
    }

    await this.publishToRelays(contentRelays, event);
  }

  private async publishToRelays(relayUrls: string[], event: Event): Promise<void> {
    if (relayUrls.length === 0) {
      throw new Error('No relays available for publish');
    }

    await this.pool.publish(relayUrls, event);
  }

  private contentRelayUrls(): string[] {
    const podcastRelays = this.podcastData.podcastRelays();
    return uniqueRelayUrls([
      ...this.accountRelay.getRelayUrls(),
      ...(podcastRelays.length > 0 ? podcastRelays : DEFAULT_PODCAST_RELAYS),
    ]);
  }

  private discoveryRelayUrls(): string[] {
    return uniqueRelayUrls(this.discoveryRelay.getRelayUrls());
  }

  private buildPublishSummaryLines(): string[] {
    const identity = this.resolveIdentity();
    const templates = this.generateEventTemplates();
    const lines: string[] = [];
    const episodeCount = templates.filter(event => event.kind === PODCAST_EPISODE_KIND).length;

    if (templates.some(event => event.kind === kinds.Metadata)) {
      lines.push($localize`:@@podcasts.import.summaryProfile:Profile (kind 0)`);
    }
    if (templates.some(event => event.kind === kinds.RelayList)) {
      lines.push($localize`:@@podcasts.import.summaryRelayList:Relay list (kind 10002, NIP-65)`);
    }
    if (templates.some(event => event.kind === PODCAST_METADATA_KIND)) {
      lines.push($localize`:@@podcasts.import.summaryShow:Show metadata (kind 10154)`);
    }
    if (episodeCount === 1) {
      lines.push($localize`:@@podcasts.import.summaryEpisodeOne:1 episode (kind 54)`);
    } else if (episodeCount > 1) {
      lines.push($localize`:@@podcasts.import.summaryEpisodes:${episodeCount}:count: episodes (kind 54)`);
    }
    if (identity.useIdentity) {
      lines.push($localize`:@@podcasts.import.summaryAuthored:Authored podcasts list (kind 10064)`);
    }

    return lines;
  }

  private applyIdentity(keypair: GeneratedPodcastKeypair, mode: Exclude<PodcastIdentityMode, 'current'>): void {
    this.secretKey = keypair.secretKey;
    this.podcastPubkey.set(keypair.pubkey);
    this.podcastNpub.set(keypair.npub);
    this.identityMode.set(mode);
    this.publishShow.set(true);
    this.publishProfile.set(mode === 'new');
    this.prefillProfileFromRss();
    if (mode === 'import' || mode === 'nsec') {
      const token = ++this.identityLoadToken;
      void this.loadImportedIdentity(keypair.pubkey, token);
    }
  }

  private async loadImportedIdentity(pubkey: string, token: number): Promise<void> {
    await Promise.all([
      this.loadExistingIdentityProfile(pubkey, token),
      this.deselectPublishedEpisodes(pubkey, token),
    ]);
  }

  private prefillProfileFromRss(): void {
    const show = this.showInfo();
    this.nameManuallyEdited = false;
    this.profile.set({
      name: deriveShortProfileName(show.title),
      displayName: show.title,
      about: show.description,
      picture: show.imageUrl,
      website: show.website,
      lud16: readProfileLightningAddress(this.accountState.profile()),
    });
  }

  private async deselectPublishedEpisodes(pubkey: string, token: number): Promise<void> {
    const events = [...this.podcastData.getEpisodesForShow(pubkey)];

    try {
      const cached = await this.database.getEventsByPubkeyAndKind(pubkey, PODCAST_EPISODE_KIND);
      events.push(...cached);
    } catch (error) {
      this.logger.warn('Could not load cached podcast episodes for imported identity:', error);
    }

    try {
      const fromRelays = await this.pool.query(this.contentRelayUrls(), {
        kinds: [PODCAST_EPISODE_KIND],
        authors: [pubkey],
        limit: 400,
      }, 5000);
      for (const event of fromRelays) {
        this.podcastData.addEpisode(event);
        events.push(event);
      }
    } catch (error) {
      this.logger.warn('Could not query published podcast episodes for imported identity:', error);
    }

    const publishedUrls = publishedPodcastAudioUrls(events);
    if (publishedUrls.size === 0 || token !== this.identityLoadToken) {
      return;
    }

    const before = this.selectedCount();
    this.episodes.update(episodes => selectUnpublishedEpisodes(episodes, publishedUrls));
    const skipped = before - this.selectedCount();
    if (skipped > 0) {
      this.snackBar.open(
        $localize`:@@podcasts.import.skippedPublished:Deselected ${skipped}:count: already published episodes`,
        '',
        { duration: 3500 },
      );
    }
  }

  private async loadExistingIdentityProfile(pubkey: string, token: number): Promise<void> {
    try {
      const existing = await this.data.getProfile(pubkey);
      const data = existing?.data;
      if (!data || typeof data !== 'object' || token !== this.identityLoadToken) {
        return;
      }

      const record = data as Record<string, unknown>;
      const name = typeof record['name'] === 'string' ? record['name'] : '';
      const displayName = typeof record['display_name'] === 'string' ? record['display_name'] : '';
      const about = typeof record['about'] === 'string' ? record['about'] : '';
      const picture = typeof record['picture'] === 'string' ? record['picture'] : '';
      const website = typeof record['website'] === 'string' ? record['website'] : '';
      const lud16 = typeof record['lud16'] === 'string' ? record['lud16'] : '';

      this.profile.update(profile => ({
        name: name || profile.name,
        displayName: displayName || name || profile.displayName,
        about: about || profile.about,
        picture: picture || profile.picture,
        website: website || profile.website,
        lud16: lud16 || profile.lud16,
      }));
      if (name) {
        this.nameManuallyEdited = true;
      }
    } catch (error) {
      this.logger.warn('Could not load existing podcast profile:', error);
    }
  }

  private clearDedicatedIdentity(): void {
    this.identityLoadToken += 1;
    this.secretKey = null;
    this.nsecInput.set('');
    this.publishProfile.set(true);
    this.nameManuallyEdited = false;
    this.podcastNpub.set('');
    this.podcastPubkey.set('');
    this.profile.set(emptyPodcastProfile());
  }

  private clearGeneratedIdentity(): void {
    this.clearDedicatedIdentity();
    this.identityMode.set('current');
  }
}
