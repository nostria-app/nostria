import { Clipboard } from '@angular/cdk/clipboard';
import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, finalizeEvent, kinds, type UnsignedEvent } from 'nostr-tools';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { ImageInputComponent } from '../../../components/image-input/image-input.component';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { CorsProxyService } from '../../../services/cors-proxy.service';
import { DatabaseService } from '../../../services/database.service';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';
import { LoggerService } from '../../../services/logger.service';
import { NostrService } from '../../../services/nostr.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { parsePodcastRssFeed, type ParsedPodcastEpisode, type ParsedPodcastShow } from '../../../utils/podcast-rss';
import {
  buildPodcastLoginCredentials,
  buildPodcastProfileContent,
  emptyPodcastProfile,
  generatePodcastKeypair,
  profileToShowDraft,
  type PodcastProfileDraft,
} from '../../../utils/podcast-identity';
import {
  AUTHORED_PODCASTS_KIND,
  buildPodcastEpisodeTags,
  buildPodcastShowTags,
  isValidHttpUrl,
  PODCAST_EPISODE_KIND,
  PODCAST_METADATA_KIND,
} from '../../../utils/podcast';

interface ImportEpisode extends ParsedPodcastEpisode {
  selected: boolean;
  expanded: boolean;
}

interface PodcastEventPreview {
  kind: number;
  pubkey?: string;
  created_at: number;
  tags: string[][];
  content: string;
}

@Component({
  selector: 'app-import-podcast-rss-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CustomDialogComponent,
    ImageInputComponent,
    FormsModule,
    JsonPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
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
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private podcastData = inject(PodcastDataService);
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
  readonly useUniqueIdentity = signal(false);
  readonly podcastNpub = signal('');
  readonly podcastPubkey = signal('');
  readonly profile = signal<PodcastProfileDraft>(emptyPodcastProfile());
  readonly showInfo = signal<ParsedPodcastShow>({
    title: '',
    description: '',
    imageUrl: '',
    website: '',
  });
  readonly episodes = signal<ImportEpisode[]>([]);
  readonly previewEvents = signal<PodcastEventPreview[]>([]);

  readonly isPremium = computed(() => this.accountState.hasActiveSubscription());
  readonly episodeCount = computed(() => this.episodes().length);
  readonly selectedCount = computed(() => this.episodes().filter(episode => episode.selected).length);
  readonly canPublish = computed(() => {
    if (this.isPublishing()) {
      return false;
    }
    if (this.useUniqueIdentity()) {
      if (!this.podcastPubkey() || !this.profile().name.trim()) {
        return false;
      }
      return this.selectedCount() > 0 || this.publishShow();
    }
    if (this.publishShow() && !this.showInfo().title.trim()) {
      return false;
    }
    return this.selectedCount() > 0 || this.publishShow();
  });
  readonly publishLabel = computed(() => {
    const selected = this.selectedCount();
    if (this.useUniqueIdentity()) {
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

  private secretKey: Uint8Array | null = null;

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
      this.episodes.set(feed.episodes.map(episode => ({
        ...episode,
        selected: true,
        expanded: false,
      })));
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

  toggleUniqueIdentity(enabled: boolean): void {
    if (!this.isPremium()) {
      this.useUniqueIdentity.set(false);
      return;
    }

    if (!enabled) {
      this.clearGeneratedIdentity();
      return;
    }

    const keypair = generatePodcastKeypair();
    this.secretKey = keypair.secretKey;
    this.podcastPubkey.set(keypair.pubkey);
    this.podcastNpub.set(keypair.npub);
    this.useUniqueIdentity.set(true);
    this.publishShow.set(true);

    const show = this.showInfo();
    this.profile.set({
      name: show.title,
      displayName: show.title,
      about: show.description,
      picture: show.imageUrl,
      website: show.website,
    });
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

    if (this.useUniqueIdentity() && (!this.isPremium() || !this.secretKey || !this.podcastPubkey())) {
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
    let publishedCount = 0;
    const identityKey = this.secretKey;
    const identityPubkey = this.podcastPubkey();

    try {
      for (const template of templates) {
        const unsigned: UnsignedEvent = {
          kind: template.kind,
          created_at: template.created_at,
          tags: template.tags,
          content: template.content,
          pubkey: template.pubkey || accountPubkey,
        };

        const signed = identityKey && unsigned.pubkey === identityPubkey
          ? finalizeEvent(unsigned, identityKey)
          : await this.nostr.signEvent(unsigned);

        await this.persistPublishedEvent(signed);
        await this.accountRelay.publish(signed);
        if (signed.kind === kinds.RelayList) {
          await this.discoveryRelay.publish(signed);
        }
        publishedCount += 1;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (identityPubkey) {
        await this.addAuthoredPodcast(accountPubkey, identityPubkey);
      }

      if (identityKey) {
        this.downloadCredentials();
      }
      this.snackBar.open(
        $localize`:@@podcasts.import.published:Published ${publishedCount}:count: events`,
        '',
        { duration: 3000 }
      );
      this.closed.emit({ published: true });
    } catch {
      this.snackBar.open($localize`:@@podcasts.import.publishFailed:Failed to publish imported podcast`, '', {
        duration: 3000,
      });
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
      await this.database.saveReplaceableEvent(signed);
      await this.accountRelay.publish(signed);
    } catch (error) {
      this.logger.warn('Failed to update authored podcasts list:', error);
    }
  }

  private generateEventTemplates(): PodcastEventPreview[] {
    const now = Math.floor(Date.now() / 1000);
    const events: PodcastEventPreview[] = [];
    const identityPubkey = this.useUniqueIdentity() ? this.podcastPubkey() : '';
    const authorPubkey = this.accountState.pubkey();
    const show = this.useUniqueIdentity()
      ? { ...this.showInfo(), ...profileToShowDraft(this.profile()) }
      : this.showInfo();

    if (identityPubkey) {
      const relayUrls = this.accountRelay.getRelayUrls();
      events.push({
        kind: kinds.Metadata,
        pubkey: identityPubkey,
        created_at: now,
        tags: [],
        content: buildPodcastProfileContent(this.profile()),
      });
      if (relayUrls.length > 0) {
        events.push({
          kind: kinds.RelayList,
          pubkey: identityPubkey,
          created_at: now,
          tags: relayUrls.map(url => ['r', url]),
          content: '',
        });
      }
    }

    if (this.publishShow() && show.title.trim()) {
      const tags = buildPodcastShowTags(show);
      if (identityPubkey && authorPubkey) {
        tags.push(['p', authorPubkey, 'host']);
      }
      events.push({
        kind: PODCAST_METADATA_KIND,
        pubkey: identityPubkey || undefined,
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
        pubkey: identityPubkey || undefined,
        created_at: episode.publishedAt && episode.publishedAt > 0 ? episode.publishedAt : now,
        tags: buildPodcastEpisodeTags({
          title: episode.title,
          audioUrl: episode.audioUrl,
          audioType: episode.audioType,
          imageUrl: episode.imageUrl || show.imageUrl,
          description: episode.description,
        }),
        content: episode.notes.trim(),
      });
    }

    return events;
  }

  private clearGeneratedIdentity(): void {
    this.secretKey = null;
    this.useUniqueIdentity.set(false);
    this.podcastNpub.set('');
    this.podcastPubkey.set('');
    this.profile.set(emptyPodcastProfile());
  }
}
