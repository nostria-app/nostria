import { Component, inject, signal, effect, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { ProfileHeaderComponent } from '../../profile/profile-header/profile-header.component';
import { ContactOverviewComponent, ContactInfoComponent, ContactInteractionsComponent } from './tabs';
import { DataService } from '../../../services/data.service';
import { AccountStateService } from '../../../services/account-state.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { NostrRecord } from '../../../interfaces';

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
    ProfileHeaderComponent,
    ContactOverviewComponent,
    ContactInfoComponent,
    ContactInteractionsComponent,
  ],
  templateUrl: './contact-card.component.html',
  styleUrl: './contact-card.component.scss',
})
export class ContactCardComponent {
  pubkeyParam = input.required<string>();

  private data = inject(DataService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);

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
}
