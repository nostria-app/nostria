import { Component, inject, signal, output, computed, effect, OnInit, ChangeDetectionStrategy } from '@angular/core';
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
const CHATS_RELAY_SET_D_TAG = 'chats';

// Default chats relays to suggest when user has no relay set
const DEFAULT_CHATS_RELAYS = ['wss://nos.lol/', 'wss://relay.damus.io/'];

interface ChatsRelaySet {
  event: Event | null;
  relays: string[];
  title?: string;
  description?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-chats-settings-dialog',
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
  templateUrl: './chats-settings-dialog.component.html',
  styleUrl: './chats-settings-dialog.component.scss',
})
export class ChatsSettingsDialogComponent implements OnInit {
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
  chatsRelaySet = signal<ChatsRelaySet>({ event: null, relays: [] });

  // Editable relay list
  relays = signal<string[]>([]);
  newRelayUrl = signal('');

  // Current user pubkey
  private currentPubkey = computed(() => this.accountState.pubkey());

  constructor() {
    effect(() => {
      const set = this.chatsRelaySet();
      if (set.relays.length > 0) {
        this.relays.set([...set.relays]);
      }
    });
  }

  ngOnInit(): void {
    this.loadChatsRelaySet();
  }

  private async loadChatsRelaySet(): Promise<void> {
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
        CHATS_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        this.hasExistingRelaySet.set(true);
        const relays = this.extractRelaysFromEvent(cachedEvent);
        const title = cachedEvent.tags.find((t: string[]) => t[0] === 'title')?.[1];
        const description = cachedEvent.tags.find((t: string[]) => t[0] === 'description')?.[1];

        this.chatsRelaySet.set({
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

      const filter: Filter = {
        kinds: [RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [CHATS_RELAY_SET_D_TAG],
        limit: 1,
      };

      let foundEvent: Event | null = null;

      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          resolve();
        }, 5000);

        const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          if (!foundEvent || event.created_at > foundEvent.created_at) {
            foundEvent = event;
          }
        });

        setTimeout(() => {
          sub.close();
          clearTimeout(timeout);
          resolve();
        }, 3000);
      });

      if (foundEvent) {
        const event = foundEvent as Event;
        const cachedTs = cachedEvent?.created_at ?? 0;
        if (event.created_at > cachedTs) {
          this.hasExistingRelaySet.set(true);
          const relays = this.extractRelaysFromEvent(event);
          const title = event.tags.find((t: string[]) => t[0] === 'title')?.[1];
          const description = event.tags.find((t: string[]) => t[0] === 'description')?.[1];

          this.chatsRelaySet.set({
            event,
            relays,
            title,
            description,
          });
          this.relays.set([...relays]);

          const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          await this.database.saveEvent({ ...event, dTag });
        }
      } else if (!cachedEvent) {
        this.hasExistingRelaySet.set(false);
        this.relays.set([...DEFAULT_CHATS_RELAYS]);
      }
    } catch (error) {
      this.logger.error('Error loading chats relay set:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private extractRelaysFromEvent(event: Event): string[] {
    return event.tags.filter(tag => tag[0] === 'relay' && tag[1]).map(tag => tag[1]);
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

    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = 'wss://' + url;
    }

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
      const tags: string[][] = [
        ['d', CHATS_RELAY_SET_D_TAG],
        ['title', 'Chats Relays'],
        ['description', 'Relays for public chat discovery'],
        ...this.relays().map(relay => ['relay', relay]),
      ];

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

      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);
      await this.pool.publish(relayUrls, signedEvent);

      await this.database.saveEvent({ ...signedEvent, dTag: CHATS_RELAY_SET_D_TAG });

      this.snackBar.open('Chats relay settings saved!', 'Dismiss', { duration: 3000 });
      this.hasExistingRelaySet.set(true);
      this.chatsRelaySet.set({
        event: signedEvent,
        relays: this.relays(),
        title: 'Chats Relays',
        description: 'Relays for public chat discovery',
      });

      this.closed.emit({ saved: true });
    } catch (error) {
      this.logger.error('Error saving chats relay set:', error);
      this.snackBar.open('Failed to save settings. Please try again.', 'Dismiss', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  get suggestedRelays(): string[] {
    return DEFAULT_CHATS_RELAYS.filter(r => !this.relays().includes(r));
  }
}
