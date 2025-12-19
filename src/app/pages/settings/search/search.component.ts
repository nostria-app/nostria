import {
  Component,
  effect,
  inject,
  signal,
  computed,
  ViewChild,
  TemplateRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RelayInfoDialogComponent } from '../relays/relay-info-dialog.component';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { DatabaseService } from '../../../services/database.service';
import { NotificationService } from '../../../services/notification.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { SearchRelayService, SearchRelayListKind } from '../../../services/relays/search-relay';
import { InfoTooltipComponent } from '../../../components/info-tooltip/info-tooltip.component';
import { DataService } from '../../../services/data.service';

@Component({
  selector: 'app-search-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule,
    InfoTooltipComponent,
  ],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss',
})
export class SearchSettingsComponent {
  private nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private database = inject(DatabaseService);
  private notifications = inject(NotificationService);
  readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  readonly searchRelay = inject(SearchRelayService);
  private readonly data = inject(DataService);

  newSearchRelayUrl = signal('');
  isPublishing = signal(false);

  // Template references for tooltip content
  @ViewChild('searchRelaysInfoContent')
  searchRelaysInfoContent!: TemplateRef<unknown>;

  // Create signal for search relays
  searchRelays = computed(() => {
    return this.searchRelay.relaysSignal();
  });

  constructor() {
    // Effect to load search relays when account changes
    effect(async () => {
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        await this.loadSearchRelays(pubkey);
      }
    });
  }

  private async loadSearchRelays(pubkey: string) {
    try {
      // Try to fetch from relay first
      const event = await this.data.getEventByPubkeyAndKind(pubkey, SearchRelayListKind);
      
      if (event) {
        const relayUrls = event.event.tags
          .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
          .map((tag: string[]) => tag[1]);
        
        if (relayUrls.length > 0) {
          this.searchRelay.setSearchRelays(relayUrls);
          return;
        }
      }
      
      // Fall back to local storage (which is handled by the service)
      await this.searchRelay.load();
    } catch (error) {
      this.logger.error('Failed to load search relays', error);
      await this.searchRelay.load();
    }
  }

  parseUrl(relayUrl: string) {
    let url = relayUrl.trim();

    if (!url) {
      this.showMessage('Please enter a valid relay URL');
      return;
    }

    // Check if the URL has a valid protocol
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      // Default to wss:// if no protocol is specified
      url = `wss://${url}`;
    }

    // Only append trailing slash if there's no path component (just domain)
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === '/') {
        url = url.endsWith('/') ? url : `${url}/`;
      }
    } catch (e) {
      this.logger.error('Invalid URL format', { url, error: e });
      this.showMessage('Invalid URL format');
      return;
    }

    return url;
  }

  async addSearchRelay() {
    const url = this.parseUrl(this.newSearchRelayUrl());

    if (!url) {
      return;
    }

    this.newSearchRelayUrl.set(url);

    // Check if relay already exists
    if (this.searchRelay.getRelayUrls().some(relay => relay === url)) {
      this.showMessage('This relay is already in your list');
      return;
    }

    // Open the relay info dialog
    const dialogRef = this.dialog.open(RelayInfoDialogComponent, {
      width: '500px',
      data: {
        relayUrl: url,
        adding: true,
      },
    });

    dialogRef.afterClosed().subscribe(async (result: { action: string }) => {
      if (result && result.action === 'add') {
        const currentRelays = this.searchRelay.getRelayUrls();
        const newRelays = [...currentRelays, url];
        
        // Save locally
        this.searchRelay.setSearchRelays(newRelays);
        
        // Publish to relays
        await this.publishSearchRelayList(newRelays);
        
        this.newSearchRelayUrl.set('');
        this.showMessage('Search relay added');
      }
    });
  }

  async removeSearchRelay(relayUrl: string) {
    const currentRelays = this.searchRelay.getRelayUrls();
    const newRelays = currentRelays.filter(r => r !== relayUrl);
    
    // Save locally
    this.searchRelay.setSearchRelays(newRelays);
    
    // Publish to relays
    await this.publishSearchRelayList(newRelays);
    
    this.showMessage('Search relay removed');
  }

  async publishSearchRelayList(relayUrls: string[]) {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.showMessage('No active account');
      return;
    }

    this.isPublishing.set(true);

    try {
      const unsignedEvent = this.searchRelay.createSearchRelayListEvent(pubkey, relayUrls);
      const signedEvent = await this.nostr.signEvent(unsignedEvent);
      
      // Publish to account relays
      await this.accountRelay.publish(signedEvent);
      
      // Save to database
      await this.searchRelay.saveEvent(signedEvent);
      
      this.logger.debug('Published search relay list event');
    } catch (error) {
      this.logger.error('Failed to publish search relay list', error);
      this.showMessage('Failed to publish search relay list');
    } finally {
      this.isPublishing.set(false);
    }
  }

  viewRelayInfo(relayUrl: string) {
    this.dialog.open(RelayInfoDialogComponent, {
      width: '500px',
      data: {
        relayUrl: relayUrl,
        adding: false,
      },
    });
  }

  formatRelayUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.host + (parsed.pathname !== '/' ? parsed.pathname : '');
    } catch {
      return url;
    }
  }

  private showMessage(message: string) {
    this.snackBar.open(message, 'Dismiss', {
      duration: 3000,
    });
  }
}
