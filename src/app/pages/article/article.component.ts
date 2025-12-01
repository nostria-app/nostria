
import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, type ParamMap } from '@angular/router';
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
import { ImageDialogComponent } from '../../components/image-dialog/image-dialog.component';
import { NostrRecord } from '../../interfaces';

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
  link = '';

  private routeSubscription?: Subscription;

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
  private speechSynthesis: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private audioPlayer: HTMLAudioElement | null = null;

  constructor() {
    if (!this.layout.isBrowser()) {
      return;
    }

    // Initialize speech synthesis
    this.speechSynthesis = window.speechSynthesis;

    // Subscribe to route parameter changes
    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const addrParam = params.get('id');
      if (addrParam) {
        // Stop speech when navigating to a new article
        this.stopSpeech();
        this.loadArticle(addrParam, params);
        // Scroll to top when navigating to a new article
        setTimeout(() => this.layout.scrollMainContentToTop(), 100);
      }
    });

    // Set up image click listeners after content is rendered
    afterNextRender(() => {
      this.setupImageClickListeners();
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

  async loadArticle(naddr: string, params?: ParamMap): Promise<void> {
    const receivedData = history.state.event as Event | undefined;

    let pubkey = '';
    let slug = '';

    if (receivedData) {
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
      };
      this.logger.debug('Decoded naddr:', addrData);

      pubkey = addrData.pubkey;
      slug = decoded.data.identifier;
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

    const shareData: ShareData = {
      title: title || 'Nostr Article',
      text: summary || `Check out this article: ${title || 'Nostr Article'}`,
      url: window.location.href,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback to clipboard
        const textToShare = `${title || 'Nostr Article'}\n\n${summary || ''}\n\n${window.location.href}`;
        await navigator.clipboard.writeText(textToShare);

        // You might want to show a toast/snackbar here indicating the content was copied
        console.log('Article details copied to clipboard');
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sharing article:', error);
        // Fallback to clipboard if sharing fails
        try {
          const textToShare = `${title || 'Nostr Article'}\n\n${summary || ''}\n\n${window.location.href}`;
          await navigator.clipboard.writeText(textToShare);
          console.log('Article details copied to clipboard');
        } catch (clipboardError) {
          console.error('Failed to copy to clipboard:', clipboardError);
        }
      }
    }
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

  private openImageDialog(imageUrl: string): void {
    this.dialog.open(ImageDialogComponent, {
      data: { imageUrl },
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: ['image-dialog', 'responsive-dialog'],
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
    utterance.onend = () => {
      this.isSpeaking.set(false);
      this.isPaused.set(false);
    };

    this.currentUtterance = utterance;
    this.speechSynthesis.speak(utterance);
    this.isSpeaking.set(true);
    this.isPaused.set(false);
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
