import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { nip19 } from 'nostr-tools';
import { CommunityService, COMMUNITY_DEFINITION_KIND } from '../../../services/community.service';
import { ApplicationService } from '../../../services/application.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { LoggerService } from '../../../services/logger.service';

@Component({
  selector: 'app-create-community',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDividerModule,
    FormsModule,
    RouterLink,
  ],
  templateUrl: './create-community.component.html',
  styleUrls: ['./create-community.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateCommunityComponent implements OnInit {
  private communityService = inject(CommunityService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private accountRelay = inject(AccountRelayService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private readonly logger = inject(LoggerService);

  name = signal('');
  description = signal('');
  image = signal('');
  rules = signal('');
  isPublishing = signal(false);

  // Moderators: list of pubkeys (hex)
  moderatorPubkeys = signal<string[]>([]);
  newModeratorPubkey = signal('');

  // Relays: pre-populated from account relays
  relayUrls = signal<string[]>([]);
  newRelayUrl = signal('');

  ngOnInit(): void {
    // Pre-populate relays from account relay settings
    const accountRelays = this.accountRelay.getRelayUrls();
    if (accountRelays.length > 0) {
      this.relayUrls.set([...accountRelays]);
    }
  }

  addModerator(): void {
    const pubkey = this.newModeratorPubkey().trim();
    if (!pubkey) return;

    // Basic hex pubkey validation (64 hex chars)
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
      this.snackBar.open('Invalid pubkey format (must be 64 hex characters)', 'Close', { duration: 3000 });
      return;
    }

    if (this.moderatorPubkeys().includes(pubkey)) {
      this.snackBar.open('Moderator already added', 'Close', { duration: 3000 });
      return;
    }

    this.moderatorPubkeys.update(list => [...list, pubkey]);
    this.newModeratorPubkey.set('');
  }

  removeModerator(pubkey: string): void {
    this.moderatorPubkeys.update(list => list.filter(p => p !== pubkey));
  }

  addRelay(): void {
    const url = this.newRelayUrl().trim();
    if (!url) return;

    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      this.snackBar.open('Relay URL must start with wss:// or ws://', 'Close', { duration: 3000 });
      return;
    }

    if (this.relayUrls().includes(url)) {
      this.snackBar.open('Relay already added', 'Close', { duration: 3000 });
      return;
    }

    this.relayUrls.update(list => [...list, url]);
    this.newRelayUrl.set('');
  }

  removeRelay(url: string): void {
    this.relayUrls.update(list => list.filter(r => r !== url));
  }

  async createCommunity(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.snackBar.open('Community name is required', 'Close', { duration: 3000 });
      return;
    }

    // Generate a URL-safe d-tag from the name
    const dTag = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 64);

    if (!dTag) {
      this.snackBar.open('Invalid community name', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);

    try {
      // Build moderators list - add current user as moderator by default
      const currentPubkey = this.accountState.pubkey();
      const moderators: { pubkey: string; relay?: string }[] = [];

      if (currentPubkey) {
        moderators.push({ pubkey: currentPubkey });
      }

      for (const pubkey of this.moderatorPubkeys()) {
        if (pubkey !== currentPubkey) {
          moderators.push({ pubkey });
        }
      }

      // Build relays list
      const relays: { url: string }[] = this.relayUrls().map(url => ({ url }));

      const result = await this.communityService.publishCommunity({
        dTag,
        name,
        description: this.description().trim() || undefined,
        image: this.image().trim() || undefined,
        rules: this.rules().trim() || undefined,
        moderators: moderators.length > 0 ? moderators : undefined,
        relays: relays.length > 0 ? relays : undefined,
      });

      if (result.success && result.event) {
        this.snackBar.open('Community created!', 'Close', { duration: 3000 });
        // Navigate using naddr encoding
        const naddr = nip19.naddrEncode({
          kind: COMMUNITY_DEFINITION_KIND,
          pubkey: result.event.pubkey,
          identifier: dTag,
        });
        this.router.navigate(['/communities', naddr], {
          state: { communityEvent: result.event },
        });
      } else {
        this.snackBar.open(result.error || 'Failed to create community', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[CreateCommunity] Error creating community:', error);
      this.snackBar.open('Error creating community', 'Close', { duration: 3000 });
    } finally {
      this.isPublishing.set(false);
    }
  }
}
