
import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, type ParamMap, Router } from '@angular/router';
import { type Event, kinds, nip19 } from 'nostr-tools';
import type { Subscription } from 'rxjs';
import type { ArticleData } from '../../components/article-display/article-display.component';
import { ArticleDisplayComponent } from '../../components/article-display/article-display.component';
import { MatMenuModule } from '@angular/material/menu';
import { AiService } from '../../services/ai.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UserDataService } from '../../services/user-data.service';
import { LoggerService } from '../../services/logger.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { FormatService } from '../../services/format/format.service';
import { UrlUpdateService } from '../../services/url-update.service';
import { Cache } from '../../services/cache';
import { BookmarkService } from '../../services/bookmark.service';
import { AccountStateService } from '../../services/account-state.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../components/share-article-dialog/share-article-dialog.component';
import { NostrRecord } from '../../interfaces';
import { ExternalLinkHandlerService } from '../../services/external-link-handler.service';
import { RelayPoolService } from '../../services/relays/relay-pool';

@Component({
  selector: 'app-article',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ArticleDisplayComponent,
    MatMenuModule
  ],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss',
})
export class ArticleComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private readonly userDataService = inject(UserDataService);
  private logger = inject(LoggerService);
  private data = inject(DataService);
  private layout = inject(LayoutService);
  private formatService = inject(FormatService);
  private url = inject(UrlUpdateService);
  private readonly cache = inject(Cache);
  private dialog = inject(MatDialog);
  private aiService = inject(AiService);
  bookmark = inject(BookmarkService);
  accountState = inject(AccountStateService);
  private externalLinkHandler = inject(ExternalLinkHandlerService);
  private relayPool = inject(RelayPoolService);
  link = '';

  private routeSubscription?: Subscription;

  // Input for when component is opened via RightPanelService
  naddr = input<string | undefined>(undefined);
  articleEvent = input<Event | undefined>(undefined);

  event = signal<Event | undefined>(undefined);
  isLoading = signal(false);
  error = signal<string | null>(null);

  // Text-to-Speech state
  isSynthesizing = signal<boolean>(false);
  isTranslating = signal<boolean>(false);
  translatedSummary = signal<string | null>(null);
  isSpeaking = signal(false);
  isPaused = signal(false);
  useAiVoice = signal(false);
  availableVoices = signal<SpeechSynthesisVoice[]>([]);
  selectedVoice = signal<SpeechSynthesisVoice | null>(null);
  playbackRate = signal<number>(1);
  private speechSynthesis: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private audioPlayer: HTMLAudioElement | null = null;

  constructor() {
    if (!this.layout.isBrowser()) {
      return;
    }

    // Initialize speech synthesis
    this.speechSynthesis = window.speechSynthesis;

    // Load available voices
    this.loadVoices();
    // Voices may load asynchronously
    if (this.speechSynthesis) {
      this.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }

    // Effect to handle naddr input (when opened via RightPanelService)
    effect(() => {
      const naddrValue = this.naddr();
      const eventValue = this.articleEvent();
      if (naddrValue) {
        this.stopSpeech();
        // If event is provided, use it directly
        if (eventValue) {
          this.event.set(eventValue);
          this.link = naddrValue;
        } else {
          this.loadArticle(naddrValue);
        }
      }
    });

    // Subscribe to route parameter changes (when opened via router)
    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const addrParam = params.get('id');
      // Only use route params if naddr input is not provided
      if (addrParam && !this.naddr()) {
        // Stop speech when navigating to a new article
        this.stopSpeech();
        this.loadArticle(addrParam, params);
        // Scroll to top when navigating to a new article
        setTimeout(() => this.layout.scrollMainContentToTop(), 100);
      }
    });

    // Set up image and link click listeners after content is rendered
    afterNextRender(() => {
      this.setupImageClickListeners();
      this.setupLinkClickListeners();
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.stopSpeech();
  }

  bookmarkArticle() {
    this.bookmark.toggleBookmark(this.id(), 'a');
  }

  id = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return `${this.event()?.kind}:${this.authorPubkey()}:${this.slug()}`;
  });

  slug = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('d', ev.tags)[0] || '';
  });

  /**
   * Check if the string is in the addressable event format: kind:pubkey:d-tag
   * e.g., 30023:b7ed68b062de6b4a12e51fd5285c1e1e0ed0e5128cda93ab11b4150b55ed32fc:my-article
   */
  private isAddressableFormat(value: string): boolean {
    const parts = value.split(':');
    if (parts.length < 3) return false;

    // First part should be a valid kind number (e.g., 30023 for articles)
    const kind = parseInt(parts[0], 10);
    if (isNaN(kind) || kind <= 0) return false;

    // Second part should be a 64-character hex pubkey
    const pubkey = parts[1];
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) return false;

    return true;
  }

  async loadArticle(naddr: string, params?: ParamMap): Promise<void> {
    // Check for event passed via router state (supports both 'articleEvent' and legacy 'event' keys)
    const receivedData = (history.state?.articleEvent || history.state?.event) as Event | undefined;

    let pubkey = '';
    let slug = '';

    if (receivedData) {
      // Redirect non-article kinds to their proper routes
      if (receivedData.kind !== kinds.LongFormArticle) {
        const identifier = receivedData.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const npub = nip19.npubEncode(receivedData.pubkey);
        if (receivedData.kind === 34139) {
          // Music playlist
          this.router.navigate([{ outlets: { right: ['music', 'playlist', npub, identifier] } }], { replaceUrl: true });
          return;
        } else if (receivedData.kind === 36787) {
          // Music track
          this.router.navigate([{ outlets: { right: ['music', 'song', npub, identifier] } }], { replaceUrl: true });
          return;
        } else if (receivedData.kind === 32100) {
          // M3U Playlist - redirect to event page
          const nevent = nip19.neventEncode({
            id: receivedData.id,
            author: receivedData.pubkey,
            kind: receivedData.kind,
          });
          this.router.navigate([{ outlets: { right: ['e', nevent] } }], { replaceUrl: true, state: { event: receivedData } });
          return;
        }
        // For other unknown kinds, continue loading as-is (fallback)
      }

      const encoded = nip19.naddrEncode({
        identifier: receivedData.tags.find(tag => tag[0] === 'd')?.[1] || '',
        kind: receivedData.kind,
        pubkey: receivedData.pubkey,
      });
      this.link = encoded;

      this.logger.debug('Received event from navigation state:', receivedData);
      this.event.set(receivedData);
      this.isLoading.set(false);
      // Scroll to top when article is received from navigation state
      setTimeout(() => this.layout.scrollMainContentToTop(), 50);
      return;
    } else if (naddr.startsWith('naddr1')) {
      this.link = naddr;

      // Decode the naddr1 parameter using nip19.decode()
      const decoded = this.utilities.decode(naddr);

      if (decoded.type !== 'naddr') {
        throw new Error('Invalid article address format');
      }

      const addrData = decoded.data as {
        pubkey: string;
        identifier: string;
        kind: number;
        relays?: string[];
      };
      this.logger.debug('Decoded naddr:', addrData);

      // Redirect non-article kinds to their proper routes
      if (addrData.kind !== kinds.LongFormArticle) {
        const npub = nip19.npubEncode(addrData.pubkey);
        if (addrData.kind === 34139) {
          // Music playlist
          this.router.navigate([{ outlets: { right: ['music', 'playlist', npub, addrData.identifier] } }], { replaceUrl: true });
          return;
        } else if (addrData.kind === 36787) {
          // Music track
          this.router.navigate([{ outlets: { right: ['music', 'song', npub, addrData.identifier] } }], { replaceUrl: true });
          return;
        } else if (addrData.kind === 32100) {
          // M3U Playlist - redirect to event page using naddr
          const naddr = nip19.naddrEncode({
            kind: addrData.kind,
            pubkey: addrData.pubkey,
            identifier: addrData.identifier,
          });
          this.router.navigate([{ outlets: { right: ['e', naddr] } }], { replaceUrl: true });
          return;
        }
        // For other unknown kinds, continue loading as-is (fallback)
      }

      pubkey = addrData.pubkey;
      slug = decoded.data.identifier;

      // If we have relay hints in the naddr, try them first for faster loading
      if (addrData.relays && addrData.relays.length > 0) {
        this.logger.debug('Trying relay hints from naddr:', addrData.relays);
        try {
          this.isLoading.set(true);
          const event = await this.relayPool.get(
            addrData.relays,
            {
              authors: [addrData.pubkey],
              kinds: [addrData.kind],
              '#d': [addrData.identifier],
            },
            2000 // Short timeout since we have specific hints
          );
          if (event) {
            this.logger.debug('Article found via relay hints');
            this.event.set(event);
            this.isLoading.set(false);
            return;
          }
          this.logger.debug('Article not found via relay hints, falling back to normal flow');
        } catch (error) {
          this.logger.debug('Failed to fetch from relay hints:', error);
          // Continue with normal flow
        }
      }
    } else if (this.isAddressableFormat(naddr)) {
      // Handle raw addressable event format: kind:pubkey:d-tag (e.g., 30023:pubkey:slug)
      const parts = naddr.split(':');
      const kind = parseInt(parts[0], 10);
      pubkey = parts[1];
      slug = parts.slice(2).join(':'); // d-tag may contain colons

      this.logger.debug('Parsed addressable format:', { kind, pubkey, slug });

      // Redirect non-article kinds to their proper routes
      if (kind !== kinds.LongFormArticle) {
        const npub = nip19.npubEncode(pubkey);
        if (kind === 34139) {
          // Music playlist
          this.router.navigate([{ outlets: { right: ['music', 'playlist', npub, slug] } }], { replaceUrl: true });
          return;
        } else if (kind === 36787) {
          // Music track
          this.router.navigate([{ outlets: { right: ['music', 'song', npub, slug] } }], { replaceUrl: true });
          return;
        } else if (kind === 32100) {
          // M3U Playlist - redirect to event page using naddr
          const naddr = nip19.naddrEncode({
            kind: kind,
            pubkey: pubkey,
            identifier: slug,
          });
          this.router.navigate([{ outlets: { right: ['e', naddr] } }], { replaceUrl: true });
          return;
        }
        // For other unknown kinds, continue loading as-is (fallback)
      }

      // Generate naddr for sharing
      const encoded = nip19.naddrEncode({
        identifier: slug,
        kind: kind,
        pubkey: pubkey,
      });
      this.link = encoded;

      // Update URL to use the naddr format for cleaner sharing
      const npub = this.utilities.getNpubFromPubkey(pubkey);
      this.url.updatePathSilently(['/a', npub, slug]);
    } else {
      const slugParam = params?.get('slug') || this.route.snapshot.paramMap.get('slug');

      // If we have slug, check if we have resolved article data from ArticleResolver
      if (slugParam) {
        slug = slugParam;

        // Check if ArticleResolver resolved a NIP-05 address to pubkey
        const articleData = this.route.snapshot.data['article'];
        if (articleData?.pubkey) {
          // NIP-05 was resolved, use the pubkey from resolver
          pubkey = articleData.pubkey;
          this.logger.debug('Using resolved pubkey from NIP-05:', articleData.identifier, '->', pubkey);
          // Don't update URL - keep the NIP-05 alias as-is
        } else {
          // Regular npub/hex ID
          pubkey = this.utilities.getPubkeyFromNpub(naddr);

          // Let's make the URL nicer, TODO add support for replacing with username, for now replace with npub.
          const npub = this.utilities.getNpubFromPubkey(pubkey);
          this.url.updatePathSilently(['/a', npub, slug]);
        }

        const encoded = nip19.naddrEncode({
          identifier: slug,
          kind: kinds.LongFormArticle,
          pubkey: pubkey,
        });
        this.link = encoded;
      }
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);

      const isNotCurrentUser = !this.accountState.isCurrentUser(pubkey);
      let event: NostrRecord | null = null;

      if (isNotCurrentUser) {
        event = await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          kinds.LongFormArticle,
          slug,
          { save: false, cache: false }
        );
      } else {
        event = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
          pubkey,
          kinds.LongFormArticle,
          slug,
          { save: false, cache: false }
        );
      }

      if (event) {
        this.logger.debug('Loaded article event from storage or relays:', event);
        this.event.set(event.event);
        this.isLoading.set(false);
        return;
      }
    } catch (error) {
      this.logger.error('Error loading article:', error);
      this.error.set('Failed to load article');
    } finally {
      this.isLoading.set(false);
      // Scroll to top after article loads (whether successful or not)
      setTimeout(() => this.layout.scrollMainContentToTop(), 100);
    }
  }

  // Computed properties for parsed event data
  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('title', ev.tags)[0] || '';
  });

  image = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('image', ev.tags)[0] || '';
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('summary', ev.tags)[0] || '';
  });

  publishedAt = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return new Date(parseInt(publishedAtTag) * 1000);
    }
    return new Date(ev.created_at * 1000);
  });

  publishedAtTimestamp = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return parseInt(publishedAtTag);
    }
    return ev.created_at;
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return this.utilities.getTagValues('t', ev.tags);
  });

  content = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    try {
      // Try to parse as JSON first, fall back to raw content
      const parsed = JSON.parse(ev.content);
      return typeof parsed === 'string' ? parsed : ev.content;
    } catch {
      return ev.content;
    }
  });

  // Signal to hold the parsed markdown content
  private _parsedContent = signal<SafeHtml>('');

  // JSON content signals
  isJsonContent = signal<boolean>(false);
  jsonData = signal<Record<string, unknown> | unknown[] | null>(null);

  // Computed property that returns the parsed content signal value
  parsedContent = computed(() => this._parsedContent()); // Effect to handle async content parsing

  private parseContentEffect = effect(async () => {
    const content = this.content();
    if (!content) {
      this._parsedContent.set('');
      this.isJsonContent.set(false);
      this.jsonData.set(null);
      return;
    }

    // Check if content is JSON
    const jsonResult = this.tryParseJson(content);
    if (jsonResult.isJson) {
      this.isJsonContent.set(true);
      this.jsonData.set(jsonResult.data);
      this._parsedContent.set(''); // Clear markdown content
      return;
    }

    this.isJsonContent.set(false);
    this.jsonData.set(null);
    this._parsedContent.set(await this.formatService.markdownToHtml(content));

    // Set up image click listeners after content is rendered
    setTimeout(() => {
      this.setupImageClickListeners();
    }, 0);
  });

  // Computed property to create ArticleData for ArticleDisplayComponent
  articleData = computed<ArticleData>(() => ({
    event: this.event(),
    title: this.title(),
    summary: this.translatedSummary() || this.summary(),
    image: this.image(),
    publishedAt: this.publishedAt(),
    publishedAtTimestamp: this.publishedAtTimestamp(),
    hashtags: this.hashtags(),
    authorPubkey: this.authorPubkey(),
    isJsonContent: this.isJsonContent(),
    jsonData: this.jsonData(),
    parsedContent: this.parsedContent(),
    id: this.id(),
    link: this.link,
  }));

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || '';
  });

  formatLocalDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  retryLoad(): void {
    const addrParam = this.route.snapshot.paramMap.get('id');
    if (addrParam) {
      this.loadArticle(addrParam);
    }
  }

  async shareArticle() {
    const event = this.event();
    if (!event) return;

    // Parse title and summary from the Nostr event tags
    const title = this.title();
    const summary = this.summary();
    const identifier = event.tags.find(tag => tag[0] === 'd')?.[1] || '';

    const dialogData: ShareArticleDialogData = {
      title: title || 'Nostr Article',
      summary: summary || undefined,
      url: window.location.href,
      eventId: event.id,
      pubkey: event.pubkey,
      identifier: identifier,
      kind: event.kind,
    };

    this.dialog.open(ShareArticleDialogComponent, {
      data: dialogData,
      width: '360px',
    });
  }

  private setupImageClickListeners(): void {
    // Find all images in the article content
    const articleContent = document.querySelector('.markdown-content');
    if (!articleContent) return;

    const images = articleContent.querySelectorAll('img.article-image');
    images.forEach(img => {
      const imageElement = img as HTMLImageElement;

      // Remove the inline onclick attribute
      imageElement.removeAttribute('onclick');

      // Add click event listener to open image dialog
      imageElement.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.openImageDialog(imageElement.src);
      });

      // Ensure cursor pointer style is applied
      imageElement.style.cursor = 'pointer';
    });
  }

  private setupLinkClickListeners(): void {
    // Find all external links in the article content
    const articleContent = document.querySelector('.markdown-content');
    if (!articleContent) return;

    const links = articleContent.querySelectorAll('a.external-link');
    links.forEach(link => {
      const linkElement = link as HTMLAnchorElement;

      // Add click event listener to potentially handle internally
      linkElement.addEventListener('click', (event: MouseEvent) => {
        const handled = this.externalLinkHandler.handleLinkClick(linkElement.href, event);

        if (handled) {
          // Prevent default navigation if we handled it internally
          event.preventDefault();
          event.stopPropagation();
        }
        // Otherwise, let the browser handle it (open in new tab)
      });
    });
  }

  private openImageDialog(imageUrl: string): void {
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems: [{ url: imageUrl, type: 'image/jpeg', title: 'Article image' }],
        initialIndex: 0,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  /**
   * Try to parse content as JSON
   */
  private tryParseJson(content: string): { isJson: boolean; data: Record<string, unknown> | unknown[] | null } {
    try {
      const trimmed = content.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return { isJson: false, data: null };
      }

      const parsed = JSON.parse(trimmed);
      // Only consider objects and arrays as JSON content
      if (typeof parsed === 'object' && parsed !== null) {
        return { isJson: true, data: parsed };
      }
      return { isJson: false, data: null };
    } catch {
      return { isJson: false, data: null };
    }
  }

  /**
   * Get keys from an object for template iteration
   */
  getObjectKeys(obj: unknown): string[] {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
  }

  /**
   * Get value from object by key
   */
  getObjectValue(obj: unknown, key: string): unknown {
    if (!obj || typeof obj !== 'object') return null;
    return (obj as Record<string, unknown>)[key];
  }

  /**
   * Format JSON value for display
   */
  formatJsonValue(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (typeof value === 'object') return 'Object';
    return String(value);
  }

  /**
   * Check if value is a primitive (string, number, boolean, null)
   */
  isPrimitive(value: unknown): boolean {
    return value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean';
  }

  /**
   * Stringify complex values (objects/arrays) for display
   */
  stringifyValue(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  /**
   * Toggle between play and pause
   */
  toggleSpeech() {
    if (this.isSpeaking()) {
      if (this.isPaused()) {
        this.resumeSpeech();
      } else {
        this.pauseSpeech();
      }
    } else {
      this.startSpeech();
    }
  }

  async startSpeech() {
    const articleContent = this.event()?.content;
    if (!articleContent) return;

    // Strip markdown/html for speech
    const textToSpeak = this.stripMarkdown(articleContent);

    if (this.useAiVoice()) {
      await this.startAiSpeech(textToSpeak);
    } else {
      this.startNativeSpeech(textToSpeak);
    }
  }

  async startAiSpeech(text: string) {
    this.isSynthesizing.set(true);
    try {
      // Check if model is loaded
      const status = await this.aiService.checkModel('text-to-speech', 'Xenova/speecht5_tts');
      if (!status.loaded) {
        // Prompt user or auto-load? For now auto-load with notification
        // Ideally we should show a dialog or toast
        await this.aiService.loadModel('text-to-speech', 'Xenova/speecht5_tts');
      }

      // Split text into chunks if too long?
      // For now, just try the first 500 chars as a demo/limit
      const chunk = text.slice(0, 500);

      const result = await this.aiService.synthesizeSpeech(chunk, {
        speaker_embeddings: 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin'
      }) as { audio: Float32Array, sampling_rate: number };

      if (result && result.audio) {
        this.playAudio(result.audio, result.sampling_rate);
        this.isSpeaking.set(true);
        this.isPaused.set(false);
      }
    } catch (err) {
      console.error('AI Speech error:', err);
      // Fallback to native?
      this.startNativeSpeech(text);
    } finally {
      this.isSynthesizing.set(false);
    }
  }

  playAudio(audioData: Float32Array, sampleRate: number) {
    const audioContext = new AudioContext();
    const buffer = audioContext.createBuffer(1, audioData.length, sampleRate);
    buffer.copyToChannel(new Float32Array(audioData), 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();

    source.onended = () => {
      this.stopSpeech();
    };

    // Store context/source to stop later if needed
    // For simplicity in this demo, we just play it.
    // To implement pause/resume with Web Audio API is more complex.
  }

  startNativeSpeech(text: string) {
    if (!this.speechSynthesis) return;

    this.stopSpeech();

    const utterance = new SpeechSynthesisUtterance(text);

    // Apply selected voice
    const voice = this.selectedVoice();
    if (voice) {
      utterance.voice = voice;
    }

    // Apply playback rate
    utterance.rate = this.playbackRate();

    utterance.onend = () => {
      this.isSpeaking.set(false);
      this.isPaused.set(false);
    };

    this.currentUtterance = utterance;
    this.speechSynthesis.speak(utterance);
    this.isSpeaking.set(true);
    this.isPaused.set(false);
  }

  /**
   * Load available speech synthesis voices
   */
  private loadVoices() {
    if (!this.speechSynthesis) return;

    const voices = this.speechSynthesis.getVoices();

    // Sort voices: natural/online voices first, then by name
    const sortedVoices = voices.sort((a, b) => {
      const aIsNatural = a.name.includes('Natural') || a.name.includes('Online');
      const bIsNatural = b.name.includes('Natural') || b.name.includes('Online');

      if (aIsNatural && !bIsNatural) return -1;
      if (!aIsNatural && bIsNatural) return 1;

      return a.name.localeCompare(b.name);
    });

    this.availableVoices.set(sortedVoices);

    // Restore saved playback rate
    const savedRate = localStorage.getItem('tts-playback-rate');
    if (savedRate) {
      const rate = parseFloat(savedRate);
      if (!isNaN(rate) && rate >= 0.5 && rate <= 2) {
        this.playbackRate.set(rate);
      }
    }

    // Set default voice if not already selected
    if (!this.selectedVoice() && sortedVoices.length > 0) {
      // Try to restore previously selected voice from localStorage
      const savedVoiceName = localStorage.getItem('tts-selected-voice');
      if (savedVoiceName) {
        const savedVoice = sortedVoices.find(v => v.name === savedVoiceName);
        if (savedVoice) {
          this.selectedVoice.set(savedVoice);
          return;
        }
      }

      // Try to find a natural English voice as default
      const naturalEnglish = sortedVoices.find(
        v => (v.name.includes('Natural') || v.name.includes('Online')) && v.lang.startsWith('en')
      );
      if (naturalEnglish) {
        this.selectedVoice.set(naturalEnglish);
      } else {
        // Fall back to first English voice or first voice
        const englishVoice = sortedVoices.find(v => v.lang.startsWith('en'));
        this.selectedVoice.set(englishVoice || sortedVoices[0]);
      }
    }
  }

  /**
   * Handle voice selection change
   */
  onVoiceChange(voice: SpeechSynthesisVoice) {
    this.selectedVoice.set(voice);

    // Save to localStorage for persistence
    localStorage.setItem('tts-selected-voice', voice.name);

    // If currently speaking, restart with new voice
    if (this.isSpeaking() && !this.useAiVoice()) {
      const text = this.stripMarkdown(this.content() || '');
      this.startNativeSpeech(text);
    }
  }

  /**
   * Handle playback rate change
   */
  onPlaybackRateChange(rate: number) {
    this.playbackRate.set(rate);

    // Save to localStorage for persistence
    localStorage.setItem('tts-playback-rate', rate.toString());

    // If currently speaking with native voice, update rate
    if (this.currentUtterance && this.isSpeaking() && !this.useAiVoice()) {
      // Need to restart speech to apply new rate
      const text = this.stripMarkdown(this.content() || '');
      this.startNativeSpeech(text);
    }
  }

  pauseSpeech() {
    if (this.useAiVoice()) {
      // Web Audio API pause not implemented in this simple version
      this.stopSpeech();
    } else {
      if (this.speechSynthesis) {
        this.speechSynthesis.pause();
        this.isPaused.set(true);
      }
    }
  }

  resumeSpeech() {
    if (this.useAiVoice()) {
      // Not implemented
    } else {
      if (this.speechSynthesis) {
        this.speechSynthesis.resume();
        this.isPaused.set(false);
      }
    }
  }

  stopSpeech() {
    if (this.speechSynthesis) {
      this.speechSynthesis.cancel();
    }
    // Stop Web Audio if playing

    this.isSpeaking.set(false);
    this.isPaused.set(false);
    this.currentUtterance = null;
  }

  /**
   * Translate content to target language
   */
  async onTranslate(targetLang: string) {
    if (this.isTranslating()) return;
    this.isTranslating.set(true);

    try {
      const model = 'Xenova/nllb-200-distilled-600M';
      const status = await this.aiService.checkModel('translation', model);
      if (!status.loaded) {
        await this.aiService.loadModel('translation', model);
      }

      // Translate summary or first part of content
      const text = this.stripMarkdown(this.content() || '').slice(0, 500);

      // In a real app, we would detect language or let user choose
      const result = await this.aiService.translateText(text, model, {
        src_lang: 'eng_Latn', // Assuming English source for now
        tgt_lang: targetLang
      });

      if (Array.isArray(result) && result.length > 0) {
        const translated = (result[0] as { translation_text: string }).translation_text;
        this.translatedSummary.set(translated);
      }

    } catch (err) {
      console.error('Translation error', err);
    } finally {
      this.isTranslating.set(false);
    }
  }

  stripMarkdown(text: string): string {
    // Basic markdown stripping
    return text
      .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
      .replace(/\[.*?\]\(.*?\)/g, '$1') // Remove links but keep text
      .replace(/#{1,6}\s/g, '') // Remove headers
      .replace(/(\*\*|__)(.*?)\1/g, '$2') // Remove bold
      .replace(/(\*|_)(.*?)\1/g, '$2') // Remove italic
      .replace(/`{3}[\s\S]*?`{3}/g, '') // Remove code blocks
      .replace(/`(.+?)`/g, '$1') // Remove inline code
      .replace(/>\s/g, '') // Remove blockquotes
      .replace(/\n+/g, '. '); // Replace newlines with periods for better pausing
  }
}
