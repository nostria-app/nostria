import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID, Service } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { CustomDialogService } from './custom-dialog.service';
import { LoggerService } from './logger.service';
import { Nip29InviteDialogComponent, Nip29InviteDialogResult } from '../components/nip29-invite-dialog/nip29-invite-dialog.component';
import {
  nip29InviteToNostriaCommands,
  parseNip29InviteUrl,
  type Nip29InviteLink,
} from '../utils/nip29-invite-url';

/**
 * Intercepts rendered NIP-29 invite links from known clients and asks whether
 * to open the group in Nostria or in the original app.
 */
@Service()
export class Nip29InviteLinkService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly dialogs = inject(CustomDialogService);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private initialized = false;
  private prompting = false;

  initialize(): void {
    if (this.initialized || !this.isBrowser) return;

    this.initialized = true;
    this.document.addEventListener('click', this.handleDocumentClick, true);
  }

  /**
   * Handle a URL if it is a known-client NIP-29 invite.
   * Returns true when the click was consumed.
   */
  tryHandle(url: string, event?: MouseEvent, base = this.documentBase()): boolean {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
      return false;
    }

    const invite = parseNip29InviteUrl(url, base);
    if (!invite) return false;

    event?.preventDefault();
    event?.stopImmediatePropagation();

    this.logger.info('[NIP-29 invite] Captured group link', {
      client: invite.clientId,
      relay: invite.relaySlug,
      group: invite.groupId,
    });

    void this.prompt(invite);
    return true;
  }

  private readonly handleDocumentClick = (event: Event): void => {
    if (!(event instanceof MouseEvent) || event.defaultPrevented || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) {
      return;
    }

    const href = anchor.getAttribute('href');
    if (!href) return;

    this.tryHandle(href, event, this.documentBase());
  };

  private async prompt(invite: Nip29InviteLink): Promise<void> {
    if (this.prompting) return;

    this.prompting = true;

    try {
      const dialogRef = this.dialogs.open<
        Nip29InviteDialogComponent,
        Nip29InviteDialogResult | undefined
      >(Nip29InviteDialogComponent, {
        title: $localize`:@@nip29.invite.title:Open community`,
        headerIcon: 'groups',
        width: 'min(440px, calc(100vw - 24px))',
        maxWidth: 'calc(100vw - 24px)',
        data: invite,
      });

      const { result } = await firstValueFrom(dialogRef.afterClosed$);

      if (result === 'nostria') {
        this.openInNostria(invite);
      } else if (result === 'external') {
        this.openExternal(invite);
      }
    } finally {
      this.prompting = false;
    }
  }

  private openInNostria(invite: Nip29InviteLink): void {
    const { commands, queryParams } = nip29InviteToNostriaCommands(invite);
    void this.router.navigate(commands, { queryParams });
  }

  private openExternal(invite: Nip29InviteLink): void {
    if (!this.isBrowser) return;
    window.open(invite.originalUrl, '_blank', 'noopener,noreferrer');
  }

  private documentBase(): string | undefined {
    if (!this.isBrowser) return undefined;
    return this.document.location?.href;
  }
}
