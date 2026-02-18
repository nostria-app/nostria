import { Component, computed, effect, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Event, Filter } from 'nostr-tools';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { AccountStateService } from '../../../services/account-state.service';
import { DatabaseService } from '../../../services/database.service';
import { LoggerService } from '../../../services/logger.service';
import { NostrService } from '../../../services/nostr.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';

const RELAY_SET_KIND = 30002;
const CLIPS_RELAY_SET_D_TAG = 'clips';

const DEFAULT_CLIPS_RELAYS = [
  'wss://nos.lol/',
  'wss://relay.damus.io/',
  'wss://relay3.openvine.co/',
  'wss://relay.divine.video/',
];

interface ClipsRelaySet {
  event: Event | null;
  relays: string[];
  title?: string;
  description?: string;
}

@Component({
  selector: 'app-clips-settings-dialog',
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
  templateUrl: './clips-settings-dialog.component.html',
  styleUrl: './clips-settings-dialog.component.scss',
})
export class ClipsSettingsDialogComponent implements OnInit {
  closed = output<{ saved: boolean } | null>();

  private accountState = inject(AccountStateService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountRelay = inject(AccountRelayService);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private database = inject(DatabaseService);

  isLoading = signal(true);
  isSaving = signal(false);
  hasExistingRelaySet = signal(false);
  clipsRelaySet = signal<ClipsRelaySet>({ event: null, relays: [] });

  relays = signal<string[]>([]);
  newRelayUrl = signal('');

  private currentPubkey = computed(() => this.accountState.pubkey());

  constructor() {
    effect(() => {
      const set = this.clipsRelaySet();
      if (set.relays.length > 0) {
        this.relays.set([...set.relays]);
      }
    });
  }

  ngOnInit(): void {
    this.loadClipsRelaySet();
  }

  private async loadClipsRelaySet(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) {
      this.relays.set([...DEFAULT_CLIPS_RELAYS]);
      this.isLoading.set(false);
      return;
    }

    try {
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        RELAY_SET_KIND,
        CLIPS_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        this.hasExistingRelaySet.set(true);
        const relays = this.extractRelaysFromEvent(cachedEvent);
        const title = cachedEvent.tags.find((t: string[]) => t[0] === 'title')?.[1];
        const description = cachedEvent.tags.find((t: string[]) => t[0] === 'description')?.[1];

        this.clipsRelaySet.set({
          event: cachedEvent,
          relays,
          title,
          description,
        });
      }

      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);

      if (relayUrls.length === 0) {
        if (!cachedEvent) {
          this.relays.set([...DEFAULT_CLIPS_RELAYS]);
        }
        this.isLoading.set(false);
        return;
      }

      const filter: Filter = {
        kinds: [RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [CLIPS_RELAY_SET_D_TAG],
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

          this.clipsRelaySet.set({ event, relays, title, description });
          await this.database.saveEvent({ ...event, dTag: CLIPS_RELAY_SET_D_TAG });
        }
      } else if (!cachedEvent) {
        this.hasExistingRelaySet.set(false);
        this.relays.set([...DEFAULT_CLIPS_RELAYS]);
      }
    } catch (error) {
      this.logger.error('Error loading clips relay set:', error);
      if (this.relays().length === 0) {
        this.relays.set([...DEFAULT_CLIPS_RELAYS]);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  private extractRelaysFromEvent(event: Event): string[] {
    return event.tags.filter(tag => tag[0] === 'relay' && tag[1]).map(tag => tag[1]);
  }

  addRelay(): void {
    const parsedRelay = this.parseRelayUrl(this.newRelayUrl().trim());
    if (!parsedRelay) {
      this.snackBar.open('Please enter a valid relay URL (wss://...)', 'Dismiss', { duration: 3000 });
      return;
    }

    if (this.relays().includes(parsedRelay)) {
      this.snackBar.open('This relay is already in the list', 'Dismiss', { duration: 3000 });
      return;
    }

    this.relays.update(relays => [...relays, parsedRelay]);
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
        ['d', CLIPS_RELAY_SET_D_TAG],
        ['title', 'Clips Relays'],
        ['description', 'Relays for short-form clips discovery'],
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

      await this.database.saveEvent({ ...signedEvent, dTag: CLIPS_RELAY_SET_D_TAG });

      this.snackBar.open('Clips relay settings saved!', 'Dismiss', { duration: 3000 });
      this.hasExistingRelaySet.set(true);
      this.clipsRelaySet.set({
        event: signedEvent,
        relays: this.relays(),
        title: 'Clips Relays',
        description: 'Relays for short-form clips discovery',
      });

      this.closed.emit({ saved: true });
    } catch (error) {
      this.logger.error('Error saving clips relay set:', error);
      this.snackBar.open('Failed to save settings. Please try again.', 'Dismiss', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  get suggestedRelays(): string[] {
    return DEFAULT_CLIPS_RELAYS.filter(relay => !this.relays().includes(relay));
  }
}
