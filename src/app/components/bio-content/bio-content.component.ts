import {
  Component,
  input,
  inject,
  signal,
  effect,
  computed,
  OnDestroy,
  ViewContainerRef,
  ChangeDetectionStrategy,
  ComponentRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { nip19 } from 'nostr-tools';
import type { ProfilePointer } from 'nostr-tools/nip19';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ProfileHoverCardComponent } from '../user-profile/hover-card/profile-hover-card.component';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';
import { ExternalLinkHandlerService } from '../../services/external-link-handler.service';

interface BioToken {
  type: 'text' | 'nostr-mention' | 'url' | 'linebreak';
  content: string;
  pubkey?: string;
  displayName?: string;
}

@Component({
  selector: 'app-bio-content',
  standalone: true,
  imports: [],
  template: `
    @for (token of tokens(); track $index) {
      @switch (token.type) {
        @case ('text') {
          <span>{{ token.content }}</span>
        }
        @case ('linebreak') {
          <br />
        }
        @case ('url') {
          <a class="bio-link" [href]="token.content" target="_blank" rel="noopener noreferrer"
             (click)="onUrlClick(token.content, $event)">{{ token.content }}</a>
        }
        @case ('nostr-mention') {
          <a class="nostr-mention" tabindex="0" role="link"
             (click)="onMentionClick(token)"
             (keydown.enter)="onMentionClick(token)"
             (mouseenter)="onMentionMouseEnter($event, token)"
             (mouseleave)="onMentionMouseLeave()">&#64;{{ token.displayName }}</a>
        }
      }
    }
  `,
  styles: [`
    :host {
      display: inline;
    }

    .bio-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      word-break: break-all;

      &:hover {
        text-decoration: underline;
      }
    }

    .nostr-mention {
      color: var(--mat-sys-primary);
      cursor: pointer;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }

      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
        border-radius: 2px;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BioContentComponent implements OnDestroy {
  content = input<string>('');

  private router = inject(Router);
  private utilities = inject(UtilitiesService);
  private data = inject(DataService);
  private overlay = inject(Overlay);
  private viewContainerRef = inject(ViewContainerRef);
  private externalLinkHandler = inject(ExternalLinkHandlerService);

  private _tokens = signal<BioToken[]>([]);
  tokens = computed(() => this._tokens());

  // Hover card state
  private overlayRef: OverlayRef | null = null;
  private hoverCardComponentRef: ComponentRef<ProfileHoverCardComponent> | null = null;
  private hoverTimeout?: number;
  private closeTimeout?: number;
  private isMouseOverTrigger = signal(false);
  private isMouseOverCard = signal(false);

  constructor() {
    effect(async () => {
      const content = this.content();
      if (content) {
        const tokens = await this.parseContent(content);
        this._tokens.set(tokens);
      } else {
        this._tokens.set([]);
      }
    });
  }

  ngOnDestroy(): void {
    this.cleanupHoverCard();
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }
  }

  private async parseContent(content: string): Promise<BioToken[]> {
    const tokens: BioToken[] = [];

    // Replace line breaks with placeholders
    const processedContent = content.replace(/\n/g, '##LINEBREAK##');

    // Regex patterns
    const nostrRegex = /(nostr:(?:npub|nprofile)1[a-zA-Z0-9]+)/g;
    const urlRegex = /(https?:\/\/[^\s)}\]>]+?)(?=\s|##LINEBREAK##|$|[),;!?]\s|[),;!?]$)/g;

    // Find all matches
    interface Match {
      start: number;
      end: number;
      content: string;
      type: 'nostr-mention' | 'url';
      pubkey?: string;
      displayName?: string;
    }

    const matches: Match[] = [];

    // Find nostr URIs
    let match: RegExpExecArray | null;
    while ((match = nostrRegex.exec(processedContent)) !== null) {
      const uri = match[0];
      const parsed = await this.parseNostrUri(uri);
      if (parsed) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: uri,
          type: 'nostr-mention',
          pubkey: parsed.pubkey,
          displayName: parsed.displayName,
        });
      }
    }

    // Find URLs (skip if already matched as nostr URI)
    while ((match = urlRegex.exec(processedContent)) !== null) {
      const isOverlapping = matches.some(
        m => match!.index >= m.start && match!.index < m.end
      );
      if (!isOverlapping) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[0],
          type: 'url',
        });
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);

    // Build tokens array
    let lastIndex = 0;
    for (const m of matches) {
      // Add text before this match
      if (m.start > lastIndex) {
        const textBefore = processedContent.substring(lastIndex, m.start);
        this.addTextTokens(tokens, textBefore);
      }

      // Add the match token
      tokens.push({
        type: m.type,
        content: m.content,
        pubkey: m.pubkey,
        displayName: m.displayName,
      });

      lastIndex = m.end;
    }

    // Add remaining text
    if (lastIndex < processedContent.length) {
      const remaining = processedContent.substring(lastIndex);
      this.addTextTokens(tokens, remaining);
    }

    return tokens;
  }

  private addTextTokens(tokens: BioToken[], text: string): void {
    const parts = text.split('##LINEBREAK##');
    parts.forEach((part, index) => {
      if (part) {
        tokens.push({ type: 'text', content: part });
      }
      if (index < parts.length - 1) {
        tokens.push({ type: 'linebreak', content: '' });
      }
    });
  }

  private async parseNostrUri(uri: string): Promise<{ pubkey: string; displayName: string } | null> {
    try {
      const decoded = nip19.decodeNostrURI(uri);
      if (!decoded) return null;

      let pubkey = '';
      if (decoded.type === 'npub') {
        pubkey = decoded.data;
      } else if (decoded.type === 'nprofile') {
        pubkey = (decoded.data as ProfilePointer).pubkey;
      } else {
        return null;
      }

      // Try to get display name from profile
      let displayName = this.utilities.getTruncatedNpub(pubkey);
      try {
        const profile = await this.data.getProfile(pubkey);
        if (profile) {
          displayName = profile.data.display_name || profile.data.name || displayName;
        }
      } catch {
        // Use truncated npub as fallback
      }

      return { pubkey, displayName };
    } catch {
      return null;
    }
  }

  onMentionClick(token: BioToken): void {
    if (token.pubkey) {
      const npub = this.utilities.getNpubFromPubkey(token.pubkey);
      this.router.navigate(['/p', npub]);
    }
  }

  onUrlClick(url: string, event: MouseEvent): void {
    const handled = this.externalLinkHandler.handleLinkClick(url, event);
    if (handled) {
      event.preventDefault();
    }
  }

  onMentionMouseEnter(event: MouseEvent, token: BioToken): void {
    if (!token.pubkey) return;

    this.isMouseOverTrigger.set(true);

    // Clear any pending close timeout
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = undefined;
    }

    // Clear any pending hover timeout
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }

    // Close existing hover card immediately when moving to a different user
    if (this.overlayRef) {
      this.cleanupHoverCard();
    }

    // Set a delay before showing the hover card
    this.hoverTimeout = window.setTimeout(() => {
      if (this.isMouseOverTrigger()) {
        this.showHoverCard(event.target as HTMLElement, token.pubkey!);
      }
    }, 500);
  }

  onMentionMouseLeave(): void {
    this.isMouseOverTrigger.set(false);

    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }

    this.scheduleClose();
  }

  private showHoverCard(element: HTMLElement, pubkey: string): void {
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

  private scheduleClose(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
    }

    this.closeTimeout = window.setTimeout(() => {
      // Check if menu is open
      if (this.hoverCardComponentRef?.instance?.isMenuOpen?.()) {
        this.scheduleClose(); // Reschedule
        return;
      }

      if (!this.isMouseOverTrigger() && !this.isMouseOverCard()) {
        this.cleanupHoverCard();
      } else {
        this.scheduleClose(); // Reschedule
      }
    }, 300);
  }

  private cleanupHoverCard(): void {
    if (this.overlayRef) {
      this.overlayRef.detach();
      this.overlayRef.dispose();
      this.overlayRef = null;
      this.hoverCardComponentRef = null;
    }
  }
}

