import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  input,
  OnDestroy,
  PLATFORM_ID,
  SecurityContext,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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

interface ArticleSpeechBlock {
  text: string;
  paragraphs: string[];
}

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
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

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
  private pendingTtsHighlightUpdate: ReturnType<typeof setTimeout> | null = null;
  private lastHighlightedSpeechText = '';
  private lastArticleTtsHighlightKey = '';

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

    effect(() => {
      const state = this.ttsSequence.state();
      const item = this.ttsSequence.currentItem();
      const ev = this.event();

      untracked(() => {
        if (!this.isBrowser) {
          return;
        }

        if (!state || state.source !== 'article' || !item || !ev || item.eventId !== ev.id) {
          this.scheduleArticleTtsHighlight('');
          return;
        }

        if (state.status === 'loading' || state.status === 'generating') {
          return;
        }

        const speechText = item.text;
        this.scheduleArticleTtsHighlight(
          speechText,
          item.articleTarget,
          this.getArticleHighlightKey(state.requestId, state.currentIndex, item),
          item.articleBlockIndex,
          item.articleParagraphIndex,
        );
      });
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
    if (this.pendingTtsHighlightUpdate) {
      clearTimeout(this.pendingTtsHighlightUpdate);
      this.pendingTtsHighlightUpdate = null;
    }
    this.clearArticleTtsHighlight();
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

    const items = this.buildArticleTtsItems(event);
    if (items.length === 0) {
      return;
    }

    this.ttsSequence.startArticle(this.title() || 'Article', items, modelId);
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

  private buildArticleTtsItems(event: Event): TtsSequenceItem[] {
    const items: TtsSequenceItem[] = [];

    items.push(...this.buildArticleTtsItemsForSection(event.id, this.title(), 'title'));
    items.push(...this.buildArticleTtsItemsForSection(event.id, this.summary(), 'summary'));

    const bodyBlocks = this.extractRenderedArticleBlocks();
    const effectiveBodyBlocks = bodyBlocks.length > 0
      ? bodyBlocks
      : this.chunkArticleSpeechText(extractTextForTts(event.content)).map(text => ({ text, paragraphs: [text] }));

    effectiveBodyBlocks.forEach((block, blockIndex) => {
      block.paragraphs.forEach((paragraph, paragraphIndex) => {
        items.push(...this.buildArticleTtsItemsForSection(event.id, paragraph, 'body', blockIndex, paragraphIndex));
      });
    });

    return items.map((item, index) => ({
      ...item,
      label: items.length > 1 ? `Section ${index + 1} of ${items.length}` : item.label,
    }));
  }

  private buildArticleTtsItemsForSection(
    eventId: string,
    text: string,
    target: TtsSequenceItem['articleTarget'],
    articleBlockIndex?: number,
    articleParagraphIndex?: number,
  ): TtsSequenceItem[] {
    const chunks = this.chunkArticleSpeechText(text.trim());
    return chunks.map(chunk => ({
      eventId,
      text: chunk,
      paragraphs: splitTtsParagraphs(chunk),
      label: chunk.length > 80 ? `${chunk.slice(0, 77)}...` : chunk,
      articleTarget: target,
      articleBlockIndex,
      articleParagraphIndex,
    }));
  }

  private chunkArticleSpeechText(text: string): string[] {
    const maxChunkLength = 520;
    const paragraphs = splitTtsParagraphs(text);
    const chunks: string[] = [];

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.length <= maxChunkLength) {
        chunks.push(trimmed);
        continue;
      }

      chunks.push(...this.splitLongArticleParagraph(trimmed, maxChunkLength));
    }

    return chunks.filter(Boolean);
  }

  private splitLongArticleParagraph(paragraph: string, maxChunkLength: number): string[] {
    const sentences = paragraph.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
      ?.map(sentence => sentence.trim())
      .filter(Boolean) ?? [paragraph];
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (sentence.length > maxChunkLength) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(...this.splitTextByWords(sentence, maxChunkLength));
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > maxChunkLength && current) {
        chunks.push(current);
        current = sentence;
      } else {
        current = candidate;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  private splitTextByWords(text: string, maxChunkLength: number): string[] {
    const chunks: string[] = [];
    let current = '';

    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChunkLength && current) {
        chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
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

  private extractRenderedArticleBlocks(): ArticleSpeechBlock[] {
    const sanitizedHtml = this.sanitizer.sanitize(SecurityContext.HTML, this.parsedContent()) ?? '';
    if (!sanitizedHtml.trim() || typeof document === 'undefined') {
      return [];
    }

    const container = document.createElement('div');
    container.innerHTML = sanitizedHtml;
    container.querySelectorAll('script, style, img, video, audio, iframe, pre, code').forEach(node => node.remove());

    const blockElements = Array.from(container.querySelectorAll<HTMLElement>([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'li',
      'blockquote',
    ].join(', '))).filter(element => this.isArticleSpeechBlockElement(element));

    return blockElements
      .map(element => {
        const paragraphs = this.cleanArticleSpeechParagraphs(element.innerText || element.textContent || '');
        return {
          text: paragraphs.join(' '),
          paragraphs,
        };
      })
      .filter(block => block.text.length > 0);
  }

  private cleanArticleSpeechText(text: string): string {
    return text
      .replace(/\b(?:https?|wss?):\/\/\S+/gi, ' ')
      .replace(/\b(?:web\+)?nostr:\S+/gi, ' ')
      .replace(/\b(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanArticleSpeechParagraphs(text: string): string[] {
    const cleaned = text
      .replace(/\b(?:https?|wss?):\/\/\S+/gi, ' ')
      .replace(/\b(?:web\+)?nostr:\S+/gi, ' ')
      .replace(/\b(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+\b/gi, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!cleaned) {
      return [];
    }

    const lineSeparatedParagraphs = cleaned
      .split(/\n{2,}/)
      .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    return lineSeparatedParagraphs.length > 0 ? lineSeparatedParagraphs : [this.cleanArticleSpeechText(text)].filter(Boolean);
  }

  private getArticleHighlightKey(requestId: number, currentIndex: number, item: TtsSequenceItem): string {
    if (item.articleTarget === 'body' && item.articleBlockIndex !== undefined) {
      if (item.articleParagraphIndex !== undefined) {
        return `${requestId}:body:${item.articleBlockIndex}:${item.articleParagraphIndex}`;
      }

      return `${requestId}:body:${item.articleBlockIndex}`;
    }

    if (item.articleTarget === 'title' || item.articleTarget === 'summary') {
      return `${requestId}:${item.articleTarget}`;
    }

    return `${requestId}:${currentIndex}:${item.articleTarget ?? 'match'}`;
  }

  private scheduleArticleTtsHighlight(
    speechText: string,
    articleTarget?: TtsSequenceItem['articleTarget'],
    highlightKey = '',
    articleBlockIndex?: number,
    articleParagraphIndex?: number,
  ): void {
    if (highlightKey && highlightKey === this.lastArticleTtsHighlightKey && this.hasArticleTtsHighlight()) {
      return;
    }

    if (this.pendingTtsHighlightUpdate) {
      clearTimeout(this.pendingTtsHighlightUpdate);
    }

    this.pendingTtsHighlightUpdate = setTimeout(() => {
      this.pendingTtsHighlightUpdate = null;
      this.applyArticleTtsHighlight(speechText, articleTarget, highlightKey, articleBlockIndex, articleParagraphIndex);
    }, 20);
  }

  private applyArticleTtsHighlight(
    speechText: string,
    articleTarget?: TtsSequenceItem['articleTarget'],
    highlightKey = '',
    articleBlockIndex?: number,
    articleParagraphIndex?: number,
  ): void {
    if (highlightKey && highlightKey === this.lastArticleTtsHighlightKey && this.hasArticleTtsHighlight()) {
      return;
    }

    const normalizedSpeechText = this.normalizeSpeechMatchText(speechText);
    this.clearArticleTtsHighlight();

    if (!normalizedSpeechText) {
      this.lastHighlightedSpeechText = '';
      this.lastArticleTtsHighlightKey = '';
      return;
    }

    const target = this.findArticleSpeechElement(normalizedSpeechText, articleTarget, articleBlockIndex, articleParagraphIndex);
    if (!target) {
      this.lastHighlightedSpeechText = normalizedSpeechText;
      this.lastArticleTtsHighlightKey = '';
      return;
    }

    target.classList.add('article-tts-active-section');

    if (this.lastHighlightedSpeechText !== normalizedSpeechText) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    this.lastHighlightedSpeechText = normalizedSpeechText;
    this.lastArticleTtsHighlightKey = highlightKey;
  }

  private clearArticleTtsHighlight(): void {
    const root = this.host.nativeElement as HTMLElement;
    root.querySelectorAll('.article-tts-active-section')
      .forEach((element: Element) => element.classList.remove('article-tts-active-section'));
    this.lastArticleTtsHighlightKey = '';
  }

  private hasArticleTtsHighlight(): boolean {
    const root = this.host.nativeElement as HTMLElement;
    return !!root.querySelector('.article-tts-active-section');
  }

  private findArticleSpeechElement(
    normalizedSpeechText: string,
    articleTarget?: TtsSequenceItem['articleTarget'],
    articleBlockIndex?: number,
    articleParagraphIndex?: number,
  ): HTMLElement | null {
    const root = this.host.nativeElement as HTMLElement;
    const explicitTarget = this.findExplicitArticleSpeechElement(root, articleTarget, articleBlockIndex, articleParagraphIndex);
    if (explicitTarget) {
      return explicitTarget;
    }

    const candidates = [
      ...this.getArticleHeaderCandidates(root),
      ...this.getArticleBodyCandidates(root),
    ];

    const directMatch = candidates.find(candidate => {
      const candidateText = this.normalizeSpeechMatchText(candidate.innerText || candidate.textContent || '');
      return candidateText.length > 0
        && (candidateText.includes(normalizedSpeechText) || normalizedSpeechText.includes(candidateText));
    });

    if (directMatch) {
      return directMatch;
    }

    const speechTokens = this.getSpeechMatchTokens(normalizedSpeechText);
    if (speechTokens.length === 0) {
      return null;
    }

    let bestCandidate: HTMLElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const candidateTokens = new Set(this.getSpeechMatchTokens(candidate.innerText || candidate.textContent || ''));
      if (candidateTokens.size === 0) {
        continue;
      }

      const score = speechTokens.filter(token => candidateTokens.has(token)).length / speechTokens.length;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    return bestScore >= 0.58 ? bestCandidate : null;
  }

  private findExplicitArticleSpeechElement(
    root: HTMLElement,
    articleTarget?: TtsSequenceItem['articleTarget'],
    articleBlockIndex?: number,
    articleParagraphIndex?: number,
  ): HTMLElement | null {
    if (articleTarget === 'title') {
      return root.querySelector<HTMLElement>('.article-title');
    }

    if (articleTarget === 'summary') {
      return root.querySelector<HTMLElement>('.article-summary');
    }

    if (articleTarget === 'body' && articleBlockIndex !== undefined) {
      const block = this.getArticleBodyCandidates(root)[articleBlockIndex] ?? null;
      if (!block || articleParagraphIndex === undefined) {
        return block;
      }

      return this.findArticleParagraphElement(block, articleParagraphIndex) ?? block;
    }

    return null;
  }

  private getArticleHeaderCandidates(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll([
      '.article-title',
      '.article-summary',
    ].join(', '))) as HTMLElement[];
  }

  private getArticleBodyCandidates(root: HTMLElement): HTMLElement[] {
    const candidates = Array.from(root.querySelectorAll([
      '.markdown-content h1',
      '.markdown-content h2',
      '.markdown-content h3',
      '.markdown-content h4',
      '.markdown-content h5',
      '.markdown-content h6',
      '.markdown-content p',
      '.markdown-content li',
      '.markdown-content blockquote',
    ].join(', '))) as HTMLElement[];

    return candidates.filter(element => this.isArticleSpeechBlockElement(element));
  }

  private isArticleSpeechBlockElement(element: HTMLElement): boolean {
    const tagName = element.tagName;

    if (tagName !== 'LI' && element.closest('li')) {
      return false;
    }

    if (tagName === 'BLOCKQUOTE') {
      return !element.querySelector('h1, h2, h3, h4, h5, h6, p, li');
    }

    return true;
  }

  private findArticleParagraphElement(block: HTMLElement, paragraphIndex: number): HTMLElement | null {
    if (paragraphIndex <= 0) {
      return block;
    }

    const paragraphCandidates = Array.from(block.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, p, li'))
      .filter(element => this.isArticleSpeechBlockElement(element));

    return paragraphCandidates[paragraphIndex] ?? null;
  }

  private normalizeSpeechMatchText(text: string): string {
    return text
      .replace(/\b(?:https?|wss?):\/\/\S+/gi, ' ')
      .replace(/\b(?:web\+)?nostr:\S+/gi, ' ')
      .replace(/\b(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private getSpeechMatchTokens(text: string): string[] {
    return this.normalizeSpeechMatchText(text)
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2);
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
