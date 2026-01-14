import { Component, inject, signal, effect, input, output, viewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ContactOverviewComponent, ContactInteractionsComponent, ContactMonetaryComponent } from './tabs';
import { DataService } from '../../../services/data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { LayoutService } from '../../../services/layout.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { NostrRecord } from '../../../interfaces';
import { nip19 } from 'nostr-tools';

@Component({
  selector: 'app-contact-card',
  imports: [
    CommonModule,
    MatTabsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    ContactOverviewComponent,
    ContactInteractionsComponent,
    ContactMonetaryComponent,
  ],
  templateUrl: './contact-card.component.html',
  styleUrl: './contact-card.component.scss',
})
export class ContactCardComponent {
  pubkeyParam = input.required<string>();
  close = output<void>();

  contactContainer = viewChild<ElementRef>('contactContainer');

  private data = inject(DataService);
  private router = inject(Router);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private imageCacheService = inject(ImageCacheService);

  pubkey = signal<string>('');
  userMetadata = signal<NostrRecord | undefined>(undefined);
  isLoading = signal<boolean>(true);
  selectedTabIndex = signal<number>(0);

  private lastLoadedPubkey = '';
  private loadingInProgress = false;

  constructor() {
    effect(() => {
      const pubkeyParam = this.pubkeyParam();

      // Only load if pubkey changed and not currently loading
      if (pubkeyParam && pubkeyParam !== this.lastLoadedPubkey && !this.loadingInProgress) {
        this.loadContactData(pubkeyParam);
      }
    });
  }

  private async loadContactData(pubkeyParam: string): Promise<void> {
    // Prevent re-entry
    if (this.loadingInProgress) return;

    this.loadingInProgress = true;
    this.isLoading.set(true);

    try {
      // Convert npub to hex if necessary
      let hexPubkey = pubkeyParam;
      if (pubkeyParam.startsWith('npub')) {
        const decoded = this.utilities.safeGetHexPubkey(pubkeyParam);
        if (decoded) {
          hexPubkey = decoded;
        }
      }

      this.pubkey.set(hexPubkey);
      this.lastLoadedPubkey = pubkeyParam;

      // Scroll to top when opening new contact
      this.scrollToTop();

      // Load user metadata - don't refresh, just get from cache
      const metadata = await this.data.getProfile(hexPubkey, { refresh: false });
      this.userMetadata.set(metadata);
    } catch (error) {
      this.logger.error('Error loading contact data:', error);
    } finally {
      this.isLoading.set(false);
      this.loadingInProgress = false;
    }
  }

  getFormattedName(): string {
    const metadata = this.userMetadata();
    if (!metadata) return this.getTruncatedPubkey();

    return (
      (metadata.data.display_name as string) ||
      (metadata.data.name as string) ||
      this.getTruncatedPubkey()
    );
  }

  getTruncatedPubkey(): string {
    const pubkey = this.pubkey();
    return pubkey ? `${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 8)}` : '';
  }

  getVerifiedIdentifier(): string | null {
    const metadata = this.userMetadata();
    if (!metadata || !metadata.data.nip05) return null;

    return this.utilities.parseNip05(metadata.data.nip05 as string);
  }

  closeContact(): void {
    this.close.emit();
  }

  openFullProfile(): void {
    const pubkey = this.pubkey();
    if (pubkey) {
      // Convert hex to npub
      try {
        const npub = nip19.npubEncode(pubkey);
        this.router.navigate([{ outlets: { right: ['p', npub] } }]);
      } catch (error) {
        this.logger.error('Error converting pubkey to npub:', error);
      }
    }
  }

  openMessage(): void {
    const pubkey = this.pubkey();
    if (pubkey) {
      this.layout.openSendMessage(pubkey);
    }
  }

  getOptimizedImageUrl(originalUrl: string): string {
    if (!originalUrl) return '';

    return this.imageCacheService.getOptimizedImageUrl(originalUrl);
  }

  private scrollToTop(): void {
    const container = this.contactContainer();
    if (container) {
      container.nativeElement.scrollTop = 0;
    }
  }
}
