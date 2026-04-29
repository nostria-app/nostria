import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  SecurityContext,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, type ParamMap, Router } from '@angular/router';
import { type Event, kinds, nip19 } from 'nostr-tools';
import { firstValueFrom } from 'rxjs';
import type { Subscription } from 'rxjs';
import { ArticleDisplayComponent, type ArticleData } from '../../components/article-display/article-display.component';
import { UtilitiesService } from '../../services/utilities.service';
import { UserDataService } from '../../services/user-data.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { UrlUpdateService } from '../../services/url-update.service';
import { FormatService } from '../../services/format/format.service';
import { AccountStateService } from '../../services/account-state.service';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../components/share-article-dialog/share-article-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { NostrRecord } from '../../interfaces';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RightPanelService } from '../../services/right-panel.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { EventMenuComponent } from '../../components/event/event-menu/event-menu.component';
import { UserRelaysService } from '../../services/relays/user-relays';
import { EventComponent as NostrEventComponent } from '../../components/event/event.component';
import { normalizeMarkdownLinkDestinations } from '../../services/format/utils';
import { SettingsService } from '../../services/settings.service';
import { TtsSequencePlayerService, type TtsSequenceItem } from '../../services/tts-sequence-player.service';
import { extractTextForTts, splitTtsParagraphs } from '../../utils/tts-text';

@Component({
  selector: 'app-article-page',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ArticleDisplayComponent,
    EventMenuComponent,
    NostrEventComponent,
  ],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly utilities = inject(UtilitiesService);
  private readonly userDataService = inject(UserDataService);
  private readonly logger = inject(LoggerService);
  private readonly data = inject(DataService);
  layout = inject(LayoutService);
  private readonly formatService = inject(FormatService);
  private readonly url = inject(UrlUpdateService);
  private readonly customDialog = inject(CustomDialogService);
  accountState = inject(AccountStateService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly panelNav = inject(PanelNavigationService);
  private readonly userRelaysService = inject(UserRelaysService);
  protected readonly settings = inject(SettingsService);
  protected readonly ttsSequence = inject(TtsSequencePlayerService);
  private readonly sanitizer = inject(DomSanitizer);

  private routeSubscription?: Subscription;

  naddr = input<string | undefined>(undefined);
  articleEvent = input<Event | undefined>(undefined);

  link = '';
  event = signal<Event | undefined>(undefined);
  isLongFormArticle = computed(() => this.event()?.kind === kinds.LongFormArticle);
  isLoading = signal(false);
  error = signal<string | null>(null);
  parsedContent = signal<SafeHtml>('');
  contentLoading = signal(false);
  private contentRenderVersion = 0;
  private pendingContentUpdate: ReturnType<typeof setTimeout> | null = null;

  id = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return `${ev.kind}:${ev.pubkey}:${this.slug()}`;
  });

  slug = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('d', ev.tags)[0] || '';
  });

  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('title', ev.tags)[0] || '';
  });

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || '';
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('summary', ev.tags)[0] || '';
  });

  image = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('image', ev.tags)[0] || '';
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return this.utilities.getTagValues('t', ev.tags);
  });

  publishedAt = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return new Date(parseInt(publishedAtTag, 10) * 1000);
    }
    return new Date(ev.created_at * 1000);
  });

  publishedAtTimestamp = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return parseInt(publishedAtTag, 10);
    }
    return ev.created_at;
  });

  articleData = computed<ArticleData>(() => ({
    event: this.event(),
    title: this.title(),
    summary: this.summary(),
    image: this.image(),
    parsedContent: this.parsedContent(),
    contentLoading: this.contentLoading(),
    hashtags: this.hashtags(),
    authorPubkey: this.authorPubkey(),
    publishedAt: this.publishedAt(),
    publishedAtTimestamp: this.publishedAtTimestamp(),
    link: this.link,
    id: this.id(),
    isJsonContent: false,
    jsonData: null,
  }));

  constructor() {
    effect(() => {
      const naddrValue = this.naddr();
      const eventValue = this.articleEvent();
      if (!naddrValue) return;

      if (eventValue) {
        const shouldUseInputEvent = naddrValue.startsWith('naddr1')
          ? this.matchesRequestedAddress(eventValue, naddrValue)
          : !!this.getDTag(eventValue);

        if (!shouldUseInputEvent) {
          void this.loadAddressableEvent(naddrValue);
          return;
        }

        this.event.set(eventValue);
        this.link = naddrValue;
        return;
      }

      void this.loadAddressableEvent(naddrValue);
    });

    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const addrParam = params.get('id');
      if (!addrParam || this.naddr()) return;

      void this.loadAddressableEvent(addrParam, params);
      const panel = this.isInRightPanel() ? 'right' : 'left';
      setTimeout(() => this.layout.scrollLayoutToTop(true, panel), 100);
    });

    effect(() => {
      const ev = this.event();
      if (!ev || ev.kind !== kinds.LongFormArticle) {
        this.parsedContent.set('');
        this.contentLoading.set(false);
        return;
      }

      void this.parseArticleContent(ev.content || '');
    });
  }

  private parseArticleContent(content: string): void {
    this.contentLoading.set(true);
    try {
      const normalizedContent = normalizeMarkdownLinkDestinations(content);
      const renderVersion = ++this.contentRenderVersion;

      if (this.pendingContentUpdate) {
        clearTimeout(this.pendingContentUpdate);
        this.pendingContentUpdate = null;
      }

      const initialHtml = this.formatService.markdownToHtmlNonBlocking(
        normalizedContent,
        updatedHtml => {
          if (renderVersion !== this.contentRenderVersion) {
            return;
          }

          if (this.pendingContentUpdate) {
            clearTimeout(this.pendingContentUpdate);
          }

          this.pendingContentUpdate = setTimeout(() => {
            if (renderVersion !== this.contentRenderVersion) {
              return;
            }

            this.parsedContent.set(updatedHtml);
            this.pendingContentUpdate = null;
          }, 150);
        }
      );

      this.parsedContent.set(initialHtml);
    } catch (error) {
      this.logger.error('Error parsing article content:', error);
      this.parsedContent.set('');
    } finally {
      this.contentLoading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    if (this.pendingContentUpdate) {
      clearTimeout(this.pendingContentUpdate);
      this.pendingContentUpdate = null;
    }
  }

  isInRightPanel(): boolean {
    return this.route.outlet === 'right';
  }

  goBack(): void {
    if (this.rightPanel.canGoBack()) {
      this.rightPanel.goBack();
      return;
    }

    if (this.isInRightPanel()) {
      this.panelNav.goBackRight();
      return;
    }

    if (this.panelNav.canGoBackLeft()) {
      this.panelNav.goBackLeft();
    } else {
      this.router.navigate(['/f']);
    }
  }

  retryLoad(): void {
    const addrParam = this.route.snapshot.paramMap.get('id');
    if (!addrParam) return;
    void this.loadAddressableEvent(addrParam);
  }

  async shareArticle(): Promise<void> {
    const event = this.event();
    if (!event) return;

    const title = this.title();
    const summary = this.utilities.getTagValues('summary', event.tags)[0] || undefined;
    const identifier = this.slug();
    const image = this.utilities.getTagValues('image', event.tags)[0] || undefined;

    const authorRelays = await this.userRelaysService.getUserRelaysForPublishing(event.pubkey);
    const relayHints = this.utilities.getShareRelayHints(authorRelays);
    const encodedId = this.utilities.encodeEventForUrl(event, relayHints.length > 0 ? relayHints : undefined);

    const dialogData: ShareArticleDialogData = {
      title: title || 'Nostr Event',
      summary,
      image,
      url: window.location.href,
      eventId: event.id,
      pubkey: event.pubkey,
      identifier,
      kind: event.kind,
      encodedId,
      event,
      naddr: this.naddr() || this.link || nip19.naddrEncode({
        identifier,
        pubkey: event.pubkey,
        kind: event.kind,
        relays: relayHints,
      }),
    };

    this.customDialog.open(ShareArticleDialogComponent, {
      title: 'Share',
      showCloseButton: true,
      data: dialogData,
      width: '560px',
      maxWidth: 'min(560px, calc(100vw - 24px))',
    });
  }

  scrollToComments(): void {
    const commentsSection = document.getElementById('article-comments');
    if (commentsSection) {
      commentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async editArticle(event?: MouseEvent): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    const articleEvent = this.event();
    if (!articleEvent) {
      return;
    }

    const dialogRef = await this.layout.createArticle(this.link, articleEvent);
    const result = await firstValueFrom(dialogRef.afterClosed$);
    if (result.result) {
      this.applyUpdatedArticle(result.result as Event);
    }
  }

  startArticleReadAloud(modelId: string): void {
    const event = this.event();
    if (!event || event.kind !== kinds.LongFormArticle) {
      return;
    }

    const item = this.buildArticleTtsItem(event);
    if (!item.text) {
      return;
    }

    this.ttsSequence.startArticle(this.title() || 'Article', item, modelId);
  }

  onArticleUpdated(event: Event): void {
    this.applyUpdatedArticle(event);
  }

  private applyUpdatedArticle(event: Event): void {
    this.event.set(event);
    this.error.set(null);
    this.link = nip19.naddrEncode({
      identifier: this.getDTag(event),
      kind: event.kind,
      pubkey: event.pubkey,
    });
  }

  private buildArticleTtsItem(event: Event): TtsSequenceItem {
    const sections = [
      this.title(),
      this.summary(),
      this.extractRenderedArticleText() || extractTextForTts(event.content),
    ]
      .map(section => section.trim())
      .filter(Boolean);
    const text = sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

    return {
      eventId: event.id,
      text,
      paragraphs: splitTtsParagraphs(text),
      label: text.length > 80 ? `${text.slice(0, 77)}...` : text,
    };
  }

  private extractRenderedArticleText(): string {
    const sanitizedHtml = this.sanitizer.sanitize(SecurityContext.HTML, this.parsedContent()) ?? '';
    if (!sanitizedHtml.trim()) {
      return '';
    }

    if (typeof document === 'undefined') {
      return sanitizedHtml
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const container = document.createElement('div');
    container.innerHTML = sanitizedHtml;
    container.querySelectorAll('script, style, img, video, audio, iframe, pre, code').forEach(node => node.remove());
    const text = container.innerText || container.textContent || '';
    return text
      .replace(/\b(?:https?|wss?):\/\/\S+/gi, ' ')
      .replace(/\b(?:web\+)?nostr:\S+/gi, ' ')
      .replace(/\b(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+\b/gi, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private isAddressableFormat(value: string): boolean {
    const parts = value.split(':');
    if (parts.length < 3) return false;

    const kind = parseInt(parts[0], 10);
    if (isNaN(kind) || kind <= 0) return false;

    const pubkey = parts[1];
    return /^[0-9a-fA-F]{64}$/.test(pubkey);
  }

  private getDTag(event: Event): string {
    return event.tags.find(tag => tag[0] === 'd')?.[1] || '';
  }

  private matchesRequestedAddress(event: Event, encodedAddress: string): boolean {
    try {
      const decoded = this.utilities.decode(encodedAddress);
      if (decoded.type !== 'naddr') return false;

      const requested = decoded.data as { kind: number; pubkey: string; identifier: string };
      return (
        event.kind === requested.kind &&
        event.pubkey === requested.pubkey &&
        this.getDTag(event) === requested.identifier
      );
    } catch {
      return false;
    }
  }

  async loadAddressableEvent(naddr: string, params?: ParamMap): Promise<void> {
    const receivedData = (history.state?.articleEvent || history.state?.event) as Event | undefined;

    let pubkey = '';
    let slug = '';
    let addressKind = kinds.LongFormArticle;

    if (receivedData) {
      const hasAddressData = !!this.getDTag(receivedData);
      const shouldUseReceivedData = naddr.startsWith('naddr1')
        ? hasAddressData && this.matchesRequestedAddress(receivedData, naddr)
        : hasAddressData;

      if (shouldUseReceivedData) {
        addressKind = receivedData.kind;
        this.link = naddr.startsWith('naddr1')
          ? naddr
          : nip19.naddrEncode({
            identifier: this.getDTag(receivedData),
            kind: receivedData.kind,
            pubkey: receivedData.pubkey,
          });
        this.event.set(receivedData);
        this.isLoading.set(false);
        const panel = this.isInRightPanel() ? 'right' : 'left';
        setTimeout(() => this.layout.scrollLayoutToTop(true, panel), 50);
        return;
      }
    }

    if (naddr.startsWith('naddr1')) {
      this.link = naddr;

      const decoded = this.utilities.decode(naddr);
      if (decoded.type !== 'naddr') {
        this.error.set('Invalid address format');
        return;
      }

      const addrData = decoded.data as {
        pubkey: string;
        identifier: string;
        kind: number;
        relays?: string[];
      };

      addressKind = addrData.kind;
      pubkey = addrData.pubkey;
      slug = addrData.identifier;

      if (addrData.relays && addrData.relays.length > 0) {
        try {
          this.isLoading.set(true);
          const relayEvent = await this.relayPool.get(
            addrData.relays,
            {
              authors: [addrData.pubkey],
              kinds: [addrData.kind],
              '#d': [addrData.identifier],
            },
            2000,
          );

          if (relayEvent) {
            this.event.set(relayEvent);
            this.isLoading.set(false);
            return;
          }
        } catch {
          // Continue with normal loading flow
        }
      }
    } else if (this.isAddressableFormat(naddr)) {
      const parts = naddr.split(':');
      addressKind = parseInt(parts[0], 10);
      pubkey = parts[1];
      slug = parts.slice(2).join(':');

      this.link = nip19.naddrEncode({
        identifier: slug,
        kind: addressKind,
        pubkey,
      });

      const npub = this.utilities.getNpubFromPubkey(pubkey);
      this.url.updatePathSilently(['/a', npub, slug]);
    } else {
      const slugParam = params?.get('slug') || this.route.snapshot.paramMap.get('slug');
      if (!slugParam) {
        this.error.set('Missing address identifier');
        return;
      }

      slug = slugParam;
      const articleData = this.route.snapshot.data['article'];
      if (articleData?.pubkey) {
        pubkey = articleData.pubkey;
      } else {
        pubkey = this.utilities.getPubkeyFromNpub(naddr);
        const npub = this.utilities.getNpubFromPubkey(pubkey);
        this.url.updatePathSilently(['/a', npub, slug]);
      }

      this.link = nip19.naddrEncode({
        identifier: slug,
        kind: addressKind,
        pubkey,
      });
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);

      const isNotCurrentUser = !this.accountState.isCurrentUser(pubkey);
      let loadedRecord: NostrRecord | null;

      if (isNotCurrentUser) {
        loadedRecord = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          addressKind,
          slug,
          { save: true, cache: true },
        );
      } else {
        loadedRecord = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          addressKind,
          slug,
          { save: true, cache: true },
        );
      }

      if (loadedRecord) {
        this.event.set(loadedRecord.event);
      } else {
        this.error.set('Event not found');
      }
    } catch (error) {
      this.logger.error('Error loading addressable event:', error);
      this.error.set('Failed to load event');
    } finally {
      this.isLoading.set(false);
      const panel = this.isInRightPanel() ? 'right' : 'left';
      setTimeout(() => this.layout.scrollLayoutToTop(true, panel), 100);
    }
  }
}
