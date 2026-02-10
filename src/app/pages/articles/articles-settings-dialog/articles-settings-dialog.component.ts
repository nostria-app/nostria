import { Component, inject, signal, output, computed, effect, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { Event, Filter } from 'nostr-tools';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { UtilitiesService } from '../../../services/utilities.service';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { DatabaseService } from '../../../services/database.service';

const RELAY_SET_KIND = 30002;
const ARTICLES_RELAY_SET_D_TAG = 'articles';

// Timeout for relay queries
const RELAY_QUERY_TIMEOUT_MS = 5000;
const RELAY_SUBSCRIPTION_TIMEOUT_MS = 3000;

// Default articles relays to suggest when user has no relay set
// These are well-known relays that typically have good article content
// Users can always customize this list through the settings dialog
const DEFAULT_ARTICLES_RELAYS = [
  'wss://nos.lol/',
  'wss://relay.damus.io/',
];

interface ArticlesRelaySet {
  event: Event | null;
  relays: string[];
  title?: string;
  description?: string;
}

@Component({
  selector: 'app-articles-settings-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDividerModule,
    MatSnackBarModule,
    FormsModule,
  ],
  templateUrl: './articles-settings-dialog.component.html',
  styleUrl: './articles-settings-dialog.component.scss',
})
export class ArticlesSettingsDialogComponent implements OnInit {
  closed = output<{ saved: boolean } | null>();

  private accountState = inject(AccountStateService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountRelay = inject(AccountRelayService);
  private utilities = inject(UtilitiesService);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private database = inject(DatabaseService);

  // State
  isLoading = signal(true);
  isSaving = signal(false);
  hasExistingRelaySet = signal(false);
  articlesRelaySet = signal<ArticlesRelaySet>({ event: null, relays: [] });

  // Editable relay list
  relays = signal<string[]>([]);
  newRelayUrl = signal('');

  // Current user pubkey
  private currentPubkey = computed(() => this.accountState.pubkey());

  constructor() {
    // Effect to sync relays when articlesRelaySet changes
    effect(() => {
      const set = this.articlesRelaySet();
      if (set.relays.length > 0) {
        this.relays.set([...set.relays]);
      }
    });
  }

  ngOnInit(): void {
    this.loadArticlesRelaySet();
  }

  private async loadArticlesRelaySet(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) {
      this.isLoading.set(false);
      return;
    }

    try {
      // First, try to load from local database for immediate use
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        RELAY_SET_KIND,
        ARTICLES_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        this.hasExistingRelaySet.set(true);
        const relays = this.extractRelaysFromEvent(cachedEvent);
        const title = cachedEvent.tags.find((t: string[]) => t[0] === 'title')?.[1];
        const description = cachedEvent.tags.find((t: string[]) => t[0] === 'description')?.[1];

        this.articlesRelaySet.set({
          event: cachedEvent,
          relays,
          title,
          description,
        });
        this.relays.set([...relays]);
      }

      // Then fetch from relays to get the latest version
      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);

      if (relayUrls.length === 0) {
        this.isLoading.set(false);
        return;
      }

      // Query for the user's articles relay set (kind 30002 with d tag "articles")
      const filter: Filter = {
        kinds: [RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [ARTICLES_RELAY_SET_D_TAG],
        limit: 1,
      };

      let foundEvent: Event | null = null;

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, RELAY_QUERY_TIMEOUT_MS);

        const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          // Keep only the newest event
          if (!foundEvent || event.created_at > foundEvent.created_at) {
            foundEvent = event;
          }
        });

        // Wait a bit for events to come in
        setTimeout(() => {
          sub.close();
          clearTimeout(timeout);
          resolve();
        }, RELAY_SUBSCRIPTION_TIMEOUT_MS);
      });

      if (foundEvent) {
        const event = foundEvent as Event;
        // Only update if newer than cached or no cache exists
        const cachedTs = cachedEvent?.created_at ?? 0;
        if (event.created_at > cachedTs) {
          this.hasExistingRelaySet.set(true);
          const relays = this.extractRelaysFromEvent(event);
          const title = event.tags.find((t: string[]) => t[0] === 'title')?.[1];
          const description = event.tags.find((t: string[]) => t[0] === 'description')?.[1];

          this.articlesRelaySet.set({
            event,
            relays,
            title,
            description,
          });
          this.relays.set([...relays]);

          // Persist to database
          const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          await this.database.saveEvent({ ...event, dTag });
        }
      } else if (!cachedEvent) {
        // No existing relay set anywhere, suggest defaults
        this.hasExistingRelaySet.set(false);
        this.relays.set([...DEFAULT_ARTICLES_RELAYS]);
      }
    } catch (error) {
      this.logger.error('Error loading articles relay set:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private extractRelaysFromEvent(event: Event): string[] {
    return event.tags
      .filter(tag => tag[0] === 'relay' && tag[1])
      .map(tag => tag[1]);
  }

  addRelay(): void {
    const url = this.parseRelayUrl(this.newRelayUrl().trim());
    if (!url) {
      this.snackBar.open('Please enter a valid relay URL (wss://...)', 'Dismiss', { duration: 3000 });
      return;
    }

    if (this.relays().includes(url)) {
      this.snackBar.open('This relay is already in the list', 'Dismiss', { duration: 3000 });
      return;
    }

    this.relays.update(relays => [...relays, url]);
    this.newRelayUrl.set('');
  }

  removeRelay(relay: string): void {
    this.relays.update(relays => relays.filter(r => r !== relay));
  }

  addDefaultRelay(relay: string): void {
    if (!this.relays().includes(relay)) {
      this.relays.update(relays => [...relays, relay]);
    }
  }

  private parseRelayUrl(url: string): string | null {
    if (!url) return null;

    // Add wss:// if missing
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = 'wss://' + url;
    }

    // Ensure trailing slash
    if (!url.endsWith('/')) {
      url = url + '/';
    }

    try {
      new URL(url);
      return url;
    } catch {
      return null;
    }
  }

  async saveRelaySet(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) {
      this.snackBar.open('You must be logged in to save settings', 'Dismiss', { duration: 3000 });
      return;
    }

    if (this.relays().length === 0) {
      this.snackBar.open('Please add at least one relay', 'Dismiss', { duration: 3000 });
      return;
    }

    this.isSaving.set(true);

    try {
      // Build the event tags
      const tags: string[][] = [
        ['d', ARTICLES_RELAY_SET_D_TAG],
        ['title', 'Articles Relays'],
        ['description', 'Relays for article content discovery'],
        ...this.relays().map(relay => ['relay', relay]),
      ];

      // Create and sign the event
      const unsignedEvent = {
        kind: RELAY_SET_KIND,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
        pubkey,
      };

      const signedEvent = await this.nostrService.signEvent(unsignedEvent);

      if (!signedEvent) {
        throw new Error('Failed to sign event');
      }

      // Publish to relays using account relays
      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);
      await this.pool.publish(relayUrls, signedEvent);

      // Save to local database
      await this.database.saveEvent({ ...signedEvent, dTag: ARTICLES_RELAY_SET_D_TAG });

      this.snackBar.open('Articles relay settings saved!', 'Dismiss', { duration: 3000 });
      this.hasExistingRelaySet.set(true);
      this.articlesRelaySet.set({
        event: signedEvent,
        relays: this.relays(),
        title: 'Articles Relays',
        description: 'Relays for article content discovery',
      });

      this.closed.emit({ saved: true });
    } catch (error) {
      this.logger.error('Error saving articles relay set:', error);
      this.snackBar.open('Failed to save settings. Please try again.', 'Dismiss', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  // Get suggested relays that aren't already added
  get suggestedRelays(): string[] {
    return DEFAULT_ARTICLES_RELAYS.filter(r => !this.relays().includes(r));
  }
}
