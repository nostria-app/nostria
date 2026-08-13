import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { ImageInputComponent } from '../../../components/image-input/image-input.component';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { CorsProxyService } from '../../../services/cors-proxy.service';
import { DatabaseService } from '../../../services/database.service';
import { LoggerService } from '../../../services/logger.service';
import { NostrService } from '../../../services/nostr.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { parsePodcastRssFeed, type ParsedPodcastEpisode, type ParsedPodcastShow } from '../../../utils/podcast-rss';
import {
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
  ],
  templateUrl: './import-podcast-rss-dialog.component.html',
  styleUrl: './import-podcast-rss-dialog.component.scss',
})
export class ImportPodcastRssDialogComponent {
  closed = output<{ published: boolean } | null>();

  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private podcastData = inject(PodcastDataService);
  private corsProxy = inject(CorsProxyService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);

  readonly dialogTitle = $localize`:@@podcasts.import.title:Import from RSS`;
  readonly showCoverLabel = $localize`:@@podcasts.show.cover:Cover image`;
  readonly episodeCoverLabel = $localize`:@@podcasts.publish.cover:Cover image`;
  readonly selectEpisodeLabel = $localize`:@@podcasts.import.selectEpisode:Select episode`;
  readonly rssUrl = signal('');
  readonly isFetching = signal(false);
  readonly isPublishing = signal(false);
  readonly hasFetched = signal(false);
  readonly showPreview = signal(false);
  readonly publishShow = signal(true);
  readonly showInfo = signal<ParsedPodcastShow>({
    title: '',
    description: '',
    imageUrl: '',
    website: '',
  });
  readonly episodes = signal<ImportEpisode[]>([]);
  readonly previewEvents = signal<PodcastEventPreview[]>([]);

  readonly episodeCount = computed(() => this.episodes().length);
  readonly selectedCount = computed(() => this.episodes().filter(episode => episode.selected).length);
  readonly canPublish = computed(() => {
    if (this.isPublishing()) {
      return false;
    }
    if (this.publishShow() && !this.showInfo().title.trim()) {
      return false;
    }
    return this.selectedCount() > 0 || this.publishShow();
  });
  readonly publishLabel = computed(() => {
    const selected = this.selectedCount();
    if (this.publishShow() && selected > 0) {
      return $localize`:@@podcasts.import.publishShowAndEpisodes:Publish show + ${selected}:count: episodes`;
    }
    if (this.publishShow()) {
      return $localize`:@@podcasts.import.publishShowOnly:Publish show details`;
    }
    return $localize`:@@podcasts.import.publishEpisodes:Publish ${selected}:count: episodes`;
  });

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

  goBack(): void {
    this.hasFetched.set(false);
    this.showPreview.set(false);
    this.episodes.set([]);
    this.previewEvents.set([]);
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
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open($localize`:@@podcasts.import.signIn:Sign in to import a podcast`, '', { duration: 3000 });
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

    try {
      for (const template of templates) {
        const signed = await this.nostr.signEvent({
          ...template,
          pubkey,
        });

        if (signed.kind === PODCAST_METADATA_KIND) {
          await this.database.saveReplaceableEvent(signed);
          this.podcastData.addShow(signed);
        } else {
          await this.database.saveEvent(signed);
          this.podcastData.addEpisode(signed);
        }

        await this.accountRelay.publish(signed);
        publishedCount += 1;
        await new Promise(resolve => setTimeout(resolve, 100));
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
    this.closed.emit(null);
  }

  private generateEventTemplates(): PodcastEventPreview[] {
    const now = Math.floor(Date.now() / 1000);
    const events: PodcastEventPreview[] = [];
    const show = this.showInfo();

    if (this.publishShow() && show.title.trim()) {
      events.push({
        kind: PODCAST_METADATA_KIND,
        created_at: now,
        tags: buildPodcastShowTags(show),
        content: '',
      });
    }

    for (const episode of this.episodes().filter(item => item.selected)) {
      if (!episode.title.trim() || !isValidHttpUrl(episode.audioUrl)) {
        continue;
      }

      events.push({
        kind: PODCAST_EPISODE_KIND,
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
}
