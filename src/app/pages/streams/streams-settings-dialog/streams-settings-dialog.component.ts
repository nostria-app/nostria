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
import { UtilitiesService } from '../../../services/utilities.service';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';

const RELAY_SET_KIND = 30002;
const STREAMS_RELAY_SET_D_TAG = 'streams';

// Default streams relays to suggest when user has no relay set
const DEFAULT_STREAMS_RELAYS = ['wss://nos.lol/', 'wss://relay.damus.io/'];

interface StreamsRelaySet {
  event: Event | null;
  relays: string[];
  title?: string;
  description?: string;
}

@Component({
  selector: 'app-streams-settings-dialog',
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
  templateUrl: './streams-settings-dialog.component.html',
  styleUrl: './streams-settings-dialog.component.scss',
})
export class StreamsSettingsDialogComponent implements OnInit {
  closed = output<{ saved: boolean } | null>();

  private accountState = inject(AccountStateService);
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);

  // State
  isLoading = signal(true);
  isSaving = signal(false);
  hasExistingRelaySet = signal(false);
  streamsRelaySet = signal<StreamsRelaySet>({ event: null, relays: [] });

  // Editable relay list
  relays = signal<string[]>([]);
  newRelayUrl = signal('');

  // Current user pubkey
  private currentPubkey = computed(() => this.accountState.pubkey());

  constructor() {
    // Effect to sync relays when streamsRelaySet changes
    effect(
      () => {
        const set = this.streamsRelaySet();
        if (set.relays.length > 0) {
          this.relays.set([...set.relays]);
        }
      },
      { allowSignalWrites: true }
    );
  }

  ngOnInit(): void {
    this.loadStreamsRelaySet();
  }

  private async loadStreamsRelaySet(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) {
      this.isLoading.set(false);
      return;
    }

    try {
      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);

      if (relayUrls.length === 0) {
        this.isLoading.set(false);
        return;
      }

      // Query for the user's streams relay set (kind 30002 with d tag "streams")
      const filter: Filter = {
        kinds: [RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [STREAMS_RELAY_SET_D_TAG],
        limit: 1,
      };

      let foundEvent: Event | null = null;

      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          resolve();
        }, 5000);

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
        }, 3000);
      });

      if (foundEvent) {
        const event = foundEvent as Event;
        this.hasExistingRelaySet.set(true);
        const relays = this.extractRelaysFromEvent(event);
        const title = event.tags.find((t: string[]) => t[0] === 'title')?.[1];
        const description = event.tags.find((t: string[]) => t[0] === 'description')?.[1];

        this.streamsRelaySet.set({
          event,
          relays,
          title,
          description,
        });
        this.relays.set([...relays]);
      } else {
        // No existing relay set, suggest defaults
        this.hasExistingRelaySet.set(false);
        this.relays.set([...DEFAULT_STREAMS_RELAYS]);
      }
    } catch (error) {
      this.logger.error('Error loading streams relay set:', error);
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
        ['d', STREAMS_RELAY_SET_D_TAG],
        ['title', 'Streams Relays'],
        ['description', 'Relays for live stream content discovery'],
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

      // Publish to relays
      const relayUrls = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
      await this.pool.publish(relayUrls, signedEvent);

      this.snackBar.open('Streams relay settings saved!', 'Dismiss', { duration: 3000 });
      this.hasExistingRelaySet.set(true);
      this.streamsRelaySet.set({
        event: signedEvent,
        relays: this.relays(),
        title: 'Streams Relays',
        description: 'Relays for live stream content discovery',
      });

      this.closed.emit({ saved: true });
    } catch (error) {
      this.logger.error('Error saving streams relay set:', error);
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
    return DEFAULT_STREAMS_RELAYS.filter(r => !this.relays().includes(r));
  }
}
