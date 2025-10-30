import { Component, input, inject, effect, signal, ViewContainerRef } from '@angular/core';
import { Router } from '@angular/router';
import { UtilitiesService } from '../../../services/utilities.service';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ImageDialogComponent } from '../../image-dialog/image-dialog.component';
import { ContentToken } from '../../../services/parsing.service';
import { FormatService } from '../../../services/format/format.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ProfileHoverCardComponent } from '../../user-profile/hover-card/profile-hover-card.component';
import { CashuTokenComponent } from '../../cashu-token/cashu-token.component';

@Component({
  selector: 'app-note-content',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule, CashuTokenComponent],
  templateUrl: './note-content.component.html',
  styleUrl: './note-content.component.scss',
})
export class NoteContentComponent {
  contentTokens = input<ContentToken[]>([]);
  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private dialog = inject(MatDialog);
  private formatService = inject(FormatService);
  private sanitizer = inject(DomSanitizer);
  private overlay = inject(Overlay);
  private viewContainerRef = inject(ViewContainerRef);

  // Store rendered HTML for nevent/note previews
  private eventPreviewsMap = signal<Map<number, SafeHtml>>(new Map());

  // Track loading state for each event preview
  private eventLoadingMap = signal<Map<number, 'loading' | 'loaded' | 'failed'>>(new Map());

  // Track last processed tokens to prevent redundant re-execution
  private lastProcessedTokens: ContentToken[] = [];

  // Hover card overlay
  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private hoverTimeout?: number;
  private closeTimeout?: number;
  private isMouseOverTrigger = signal(false);
  private isMouseOverCard = signal(false);

  constructor() {
    // When tokens change, fetch event previews for nevent/note types
    effect(() => {
      const tokens = this.contentTokens();

      // Only process if tokens actually changed (not just reference change)
      if (this.tokensHaveChanged(tokens)) {
        this.lastProcessedTokens = [...tokens];
        this.loadEventPreviews(tokens);
      }
    });
  }

  /**
   * Check if tokens have actually changed by comparing their content
   */
  private tokensHaveChanged(newTokens: ContentToken[]): boolean {
    // If length changed, definitely changed
    if (newTokens.length !== this.lastProcessedTokens.length) {
      return true;
    }

    // Compare each token by id and type (shallow comparison is enough)
    for (let i = 0; i < newTokens.length; i++) {
      const newToken = newTokens[i];
      const oldToken = this.lastProcessedTokens[i];

      if (newToken.id !== oldToken.id || newToken.type !== oldToken.type) {
        return true;
      }
    }

    return false;
  }

  private async loadEventPreviews(tokens: ContentToken[]): Promise<void> {
    const previewsMap = new Map<number, SafeHtml>();
    const loadingMap = new Map<number, 'loading' | 'loaded' | 'failed'>();

    // Mark all event previews as loading
    for (const token of tokens) {
      if (token.type === 'nostr-mention' && token.nostrData) {
        const { type } = token.nostrData;
        if (type === 'nevent' || type === 'note') {
          loadingMap.set(token.id, 'loading');
        }
      }
    }

    // Update loading state immediately
    this.eventLoadingMap.set(loadingMap);

    // Fetch previews
    for (const token of tokens) {
      if (token.type === 'nostr-mention' && token.nostrData) {
        const { type, data } = token.nostrData;

        if (type === 'nevent' || type === 'note') {
          try {
            const eventId = type === 'nevent' ? data.id : data;
            const authorPubkey = type === 'nevent' ? (data.author || data.pubkey) : undefined;
            const relayHints = type === 'nevent' ? data.relays : undefined;

            const previewHtml = await this.formatService.fetchEventPreview(
              eventId,
              authorPubkey,
              relayHints
            );

            if (previewHtml) {
              previewsMap.set(token.id, this.sanitizer.bypassSecurityTrustHtml(previewHtml));
              loadingMap.set(token.id, 'loaded');
            } else {
              loadingMap.set(token.id, 'failed');
            }
          } catch (error) {
            console.error(`[NoteContent] Error loading preview for token ${token.id}:`, error);
            loadingMap.set(token.id, 'failed');
          }

          // Update state after each preview attempt
          this.eventPreviewsMap.set(new Map(previewsMap));
          this.eventLoadingMap.set(new Map(loadingMap));
        }
      }
    }
  }

  getEventPreview(tokenId: number): SafeHtml | undefined {
    return this.eventPreviewsMap().get(tokenId);
  }

  getEventLoadingState(tokenId: number): 'loading' | 'loaded' | 'failed' | undefined {
    return this.eventLoadingMap().get(tokenId);
  }

  onNostrMentionClick(token: ContentToken) {
    if (!token.nostrData) return;

    const { type, data } = token.nostrData;

    switch (type) {
      case 'npub':
      case 'nprofile': {
        // Navigate to profile page
        const record = data as Record<string, unknown>;
        const pubkey = type === 'npub' ? String(data) : String(record['pubkey'] || '');
        this.router.navigate(['/p', this.utilities.getNpubFromPubkey(pubkey)]);
        break;
      }
      case 'note':
      default:
        console.warn('Unsupported nostr URI type:', type);
    }
  }

  getVideoType(url: string): string {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    switch (extension) {
      case 'mp4':
      case 'm4v':
        return 'mp4';
      case 'webm':
        return 'webm';
      case 'mov':
        // Modern .mov files are typically MPEG-4 encoded and can be played as mp4
        return 'mp4';
      case 'avi':
        return 'x-msvideo';
      case 'wmv':
        return 'x-ms-wmv';
      case 'flv':
        return 'x-flv';
      case 'mkv':
        return 'x-matroska';
      case 'ogg':
      case 'ogv':
        return 'ogg';
      default:
        return 'mp4';
    }
  }

  /**
   * Check if a video format is likely to be supported by modern browsers
   * Modern .mov files are typically MPEG-4 encoded and can be played by browsers
   */
  isVideoFormatSupported(url: string): boolean {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    // MP4, WebM, and modern MOV files have good cross-browser support
    // Modern .mov files are typically MPEG-4 which browsers can play
    return extension === 'mp4' || extension === 'webm' || extension === 'mov' || extension === 'm4v';
  }

  /**
   * Handle video load errors by showing a download link
   */
  onVideoError(event: Event, videoUrl: string): void {
    const target = event.target as HTMLVideoElement;
    if (target) {
      console.warn('Video failed to load:', videoUrl);
      // The template will handle showing the fallback
    }
  }

  /**
   * Opens an image dialog to view the image with zoom capabilities
   */
  openImageDialog(imageUrl: string): void {
    console.log('Opening image dialog for URL:', imageUrl);
    this.dialog.open(ImageDialogComponent, {
      data: { imageUrl },
      maxWidth: '95vw',
      maxHeight: '95vh',
      width: '100%',
      height: '100%',
      panelClass: ['image-dialog', 'responsive-dialog'],
    });
  }

  /**
   * Handle mouse enter on mention link
   */
  onMentionMouseEnter(event: MouseEvent, token: ContentToken): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }
    this.isMouseOverTrigger.set(true);

    // Only show hover card for npub/nprofile mentions
    if (!token.nostrData) {
      console.log('[NoteContent] No nostrData on token');
      return;
    }

    const { type, data } = token.nostrData;
    const record = data as Record<string, unknown>;
    const pubkey = type === 'npub' ? String(data) : String(record['pubkey'] || '');

    console.log('[NoteContent] Mention hover - type:', type, 'pubkey:', pubkey);

    if (!pubkey) {
      console.log('[NoteContent] No pubkey found');
      return;
    }

    this.hoverTimeout = setTimeout(() => {
      if (this.isMouseOverTrigger()) {
        console.log('[NoteContent] Showing hover card for pubkey:', pubkey);
        this.showMentionHoverCard(event.target as HTMLElement, pubkey);
      }
    }, 500) as unknown as number;
  }

  /**
   * Handle mouse leave on mention link
   */
  onMentionMouseLeave(): void {
    this.isMouseOverTrigger.set(false);
    this.scheduleClose();
  }

  /**
   * Show hover card for a mention
   */
  private showMentionHoverCard(element: HTMLElement, pubkey: string): void {
    console.log('[NoteContent] showMentionHoverCard called with pubkey:', pubkey);

    if (this.overlayRef) {
      console.log('[NoteContent] Overlay already exists, skipping');
      return;
    }

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(element)
      .withPositions([
        {
          originX: 'center',
          originY: 'bottom',
          overlayX: 'center',
          overlayY: 'top',
          offsetY: 8,
        },
        {
          originX: 'center',
          originY: 'top',
          overlayX: 'center',
          overlayY: 'bottom',
          offsetY: -8,
        },
        {
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center',
          offsetX: 8,
        },
        {
          originX: 'start',
          originY: 'center',
          overlayX: 'end',
          overlayY: 'center',
          offsetX: -8,
        },
      ])
      .withViewportMargin(16)
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.close(),
    });

    const portal = new ComponentPortal(ProfileHoverCardComponent, this.viewContainerRef);
    const componentRef = this.overlayRef.attach(portal);

    console.log('[NoteContent] Setting pubkey on hover card instance:', pubkey);
    componentRef.setInput('pubkey', pubkey);
    this.hoverCardComponentRef = componentRef;

    // Track mouse over card
    const cardElement = this.overlayRef.overlayElement;
    cardElement.addEventListener('mouseenter', () => {
      this.isMouseOverCard.set(true);
      if (this.closeTimeout) {
        clearTimeout(this.closeTimeout);
        this.closeTimeout = undefined;
      }
    });
    cardElement.addEventListener('mouseleave', () => {
      this.isMouseOverCard.set(false);
      this.scheduleClose();
    });
  }

  /**
   * Schedule closing of the hover card
   */
  private scheduleClose(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }

    this.closeTimeout = setTimeout(() => {
      // Check if menu is open
      if (this.hoverCardComponentRef?.instance?.isMenuOpen?.()) {
        this.scheduleClose(); // Reschedule
        return;
      }

      if (!this.isMouseOverTrigger() && !this.isMouseOverCard()) {
        this.closeHoverCard();
      } else {
        this.scheduleClose(); // Reschedule
      }
    }, 300) as unknown as number;
  }

  /**
   * Close the hover card
   */
  private closeHoverCard(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
    }
  }
}
