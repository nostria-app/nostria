import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { FormsModule } from '@angular/forms';
import { Event, UnsignedEvent } from 'nostr-tools';
import { NostrService } from '../../services/nostr.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { UserRelaysService } from '../../services/relays/user-relays';
import { UtilitiesService } from '../../services/utilities.service';

export interface PublishDialogData {
  event?: Event;
  customMode?: boolean;
}

interface PublishOption {
  id: 'account' | 'author' | 'mentioned' | 'custom';
  label: string;
  description: string;
}

interface RelayPublishResult {
  url: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
}

@Component({
  selector: 'app-publish-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatListModule,
    FormsModule,
  ],
  templateUrl: './publish-dialog.component.html',
  styleUrl: './publish-dialog.component.scss',
})
export class PublishDialogComponent {
  private dialogRef = inject(MatDialogRef<PublishDialogComponent>);
  data: PublishDialogData = inject(MAT_DIALOG_DATA);
  accountRelay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private userRelaysService = inject(UserRelaysService);
  private nostrService = inject(NostrService);
  private utilities = inject(UtilitiesService);
  // relayService = inject(RelayService);

  selectedOptions = signal<Set<'account' | 'author' | 'mentioned' | 'custom'>>(new Set(['account']));
  customRelayInput = signal<string>('');
  customRelays = signal<string[]>([]);
  publishResults = signal<RelayPublishResult[]>([]);
  isPublishing = signal<boolean>(false);
  authorRelays = signal<string[]>([]);
  loadingAuthorRelays = signal<boolean>(false);
  mentionedRelays = signal<string[]>([]);
  loadingMentionedRelays = signal<boolean>(false);
  showJsonView = signal<boolean>(false);
  showRelaysView = signal<boolean>(false);
  customMode = signal<boolean>(false);
  customEventJson = signal<string>('');
  customEventError = signal<string>('');

  // Cached parsed event to avoid re-parsing during template rendering
  private cachedParsedEvent: { json: string; event: Event | UnsignedEvent | null } = { json: '', event: null };

  publishOptions: PublishOption[] = [
    {
      id: 'account',
      label: 'Account Relays',
      description: 'Publish to your configured account relays',
    },
    {
      id: 'author',
      label: "Author's Relays",
      description: "Publish to the original author's relays",
    },
    {
      id: 'mentioned',
      label: 'Mentioned Users\' Relays',
      description: 'Publish to all mentioned users\' relays',
    },
    {
      id: 'custom',
      label: 'Additional Relays',
      description: 'Publish to manually specified relays',
    },
  ];

  constructor() {
    // Check if we're in custom mode
    if (this.data?.customMode) {
      this.customMode.set(true);
      // Default to only account relays in custom mode
      this.selectedOptions.set(new Set(['account']));
    }

    // Load author's relays when component initializes
    if (this.data?.event?.pubkey) {
      this.loadAuthorRelays();
    }
  }

  private async loadAuthorRelays(): Promise<void> {
    if (!this.data?.event?.pubkey) {
      return;
    }

    this.loadingAuthorRelays.set(true);
    try {
      const relays = await this.discoveryRelay.getUserRelayUrls(this.data.event.pubkey);
      this.authorRelays.set(relays || []);
    } catch (error) {
      console.error('Error loading author relays:', error);
      this.authorRelays.set([]);
    } finally {
      this.loadingAuthorRelays.set(false);
    }
  }

  /** Get all mentioned pubkeys from p-tags in the event */
  getMentionedPubkeys(): string[] {
    const event = this.customMode() ? this.getParsedEvent() : this.data.event;
    if (!event) {
      return [];
    }

    const pTags = event.tags.filter((tag: string[]) => tag[0] === 'p' && tag[1]);
    const pubkeys = pTags.map((tag: string[]) => tag[1]);

    // Remove duplicates
    return [...new Set(pubkeys)] as string[];
  }

  /** Get the parsed custom event without side effects (for template rendering) */
  private getParsedEvent(): Event | UnsignedEvent | null {
    const jsonString = this.customEventJson().trim();

    // Use cached version if JSON hasn't changed
    if (this.cachedParsedEvent.json === jsonString) {
      return this.cachedParsedEvent.event;
    }

    if (!jsonString) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonString);

      // Basic validation without side effects
      if (parsed.pubkey && typeof parsed.pubkey !== 'string') {
        return null;
      }
      // created_at can be missing (will be auto-generated) or must be a number
      if (parsed.created_at !== undefined && parsed.created_at !== null && typeof parsed.created_at !== 'number') {
        return null;
      }
      if (typeof parsed.kind !== 'number') {
        return null;
      }
      if (!Array.isArray(parsed.tags)) {
        return null;
      }
      if (typeof parsed.content !== 'string') {
        return null;
      }

      const event = parsed as Event | UnsignedEvent;

      // Cache the result
      this.cachedParsedEvent = { json: jsonString, event };

      return event;
    } catch {
      return null;
    }
  }

  /** Check if the event has any mentioned users (p-tags) */
  hasMentionedUsers(): boolean {
    return this.getMentionedPubkeys().length > 0 && this.isSocialEventKind();
  }

  /** Check if the event kind is a social interaction type where mentioned users' relays are relevant */
  private isSocialEventKind(): boolean {
    const event = this.customMode() ? this.getParsedEvent() : this.data.event;
    if (!event) {
      return false;
    }

    // Social interaction kinds where publishing to mentioned users' relays makes sense:
    // 1 - Short text note
    // 6 - Repost
    // 7 - Reaction
    // 16 - Generic repost
    // 1111 - Comment
    // 30023 - Long-form article
    const socialKinds = [1, 6, 7, 16, 1111, 30023];
    return socialKinds.includes(event.kind);
  }

  /** Load relays for all mentioned users */
  async loadMentionedUsersRelays(): Promise<void> {
    const mentionedPubkeys = this.getMentionedPubkeys();
    if (mentionedPubkeys.length === 0) {
      this.mentionedRelays.set([]);
      return;
    }

    this.loadingMentionedRelays.set(true);
    try {
      const allRelays = await this.getAllRelaysForPubkeys(mentionedPubkeys);
      this.mentionedRelays.set(allRelays);
    } catch (error) {
      console.error('Error loading mentioned users relays:', error);
      this.mentionedRelays.set([]);
    } finally {
      this.loadingMentionedRelays.set(false);
    }
  }

  /** Get all relays for an array of pubkeys (processes in batches) */
  private async getAllRelaysForPubkeys(pubkeys: string[]): Promise<string[]> {
    const batchSize = 20;
    const allRelays: string[] = [];

    for (let i = 0; i < pubkeys.length; i += batchSize) {
      const batch = pubkeys.slice(i, i + batchSize);
      const batchPromises = batch.map(pubkey =>
        this.userRelaysService.getUserRelaysForPublishing(pubkey)
      );

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(relays => allRelays.push(...relays));
    }

    // Remove duplicates and normalize
    return [...new Set(allRelays)];
  }

  parseRelayUrl(relayUrl: string): string | null {
    const normalized = this.utilities.normalizeRelayUrl(relayUrl.trim());
    return normalized || null;
  }

  addCustomRelay(): void {
    const relayInput = this.customRelayInput().trim();
    if (!relayInput) {
      return;
    }

    const normalizedUrl = this.parseRelayUrl(relayInput);

    if (!normalizedUrl) {
      alert('Please enter a valid relay URL');
      return;
    }

    if (!this.customRelays().includes(normalizedUrl)) {
      this.customRelays.update(relays => [...relays, normalizedUrl]);
      this.customRelayInput.set('');
    } else {
      alert('This relay is already in the list');
    }
  }

  removeCustomRelay(relay: string): void {
    this.customRelays.update(relays => relays.filter(r => r !== relay));
  }

  getTargetRelays(): string[] {
    const selectedOptions = this.selectedOptions();
    const allRelays: string[] = [];

    if (selectedOptions.has('account')) {
      allRelays.push(...this.accountRelay.getRelayUrls());
    }

    if (selectedOptions.has('author')) {
      allRelays.push(...this.authorRelays());
    }

    if (selectedOptions.has('mentioned')) {
      allRelays.push(...this.mentionedRelays());
    }

    if (selectedOptions.has('custom')) {
      allRelays.push(...this.customRelays());
    }

    // Normalize and remove duplicates
    return this.utilities.getUniqueNormalizedRelayUrls(allRelays);
  }

  onOptionChange(option: 'account' | 'author' | 'mentioned' | 'custom', checked: boolean): void {
    this.selectedOptions.update(options => {
      const newOptions = new Set(options);
      if (checked) {
        newOptions.add(option);

        // If "mentioned" option is checked, load mentioned users' relays
        if (option === 'mentioned') {
          this.loadMentionedUsersRelays();
        }
      } else {
        newOptions.delete(option);
      }
      return newOptions;
    });
  }

  isOptionSelected(option: 'account' | 'author' | 'mentioned' | 'custom'): boolean {
    return this.selectedOptions().has(option);
  }

  async publish(): Promise<void> {
    console.log('Publish button clicked!');
    const targetRelays = this.getTargetRelays();
    console.log('Target relays:', targetRelays);

    if (targetRelays.length === 0) {
      alert('No relays selected for publishing');
      return;
    }

    // Get the event to publish
    let eventToPublish: Event;
    if (this.customMode()) {
      console.log('Custom mode - parsing event');
      // Parse and validate custom event JSON
      const parsedEvent = this.parseCustomEvent();
      if (!parsedEvent) {
        console.log('Failed to parse custom event');
        return;
      }

      // Check if the event needs signing (missing id or sig)
      const needsSigning = !('id' in parsedEvent) || !('sig' in parsedEvent);

      if (needsSigning) {
        console.log('Event needs signing - triggering signature process');
        try {
          // Sign the event using NostrService
          eventToPublish = await this.nostrService.signEvent(parsedEvent);
          console.log('Event signed successfully:', eventToPublish);

          // Update the custom event JSON to show the signed version
          this.customEventJson.set(JSON.stringify(eventToPublish, null, 2));
        } catch (error) {
          console.error('Error signing event:', error);
          alert('Failed to sign event: ' + (error instanceof Error ? error.message : 'Unknown error'));
          return;
        }
      } else {
        console.log('Event already signed, using as-is');
        eventToPublish = parsedEvent as Event;
      }
    } else {
      console.log('Normal mode - using provided event');
      if (!this.data.event) {
        alert('No event to publish');
        return;
      }
      eventToPublish = this.data.event;
    }

    console.log('Event to publish:', eventToPublish);
    this.isPublishing.set(true);

    // Initialize publish results
    const initialResults: RelayPublishResult[] = targetRelays.map(url => ({
      url,
      status: 'pending',
    }));
    this.publishResults.set(initialResults);

    try {
      // Use the pool to publish to multiple relays
      const publishPromises = await this.accountRelay.publishToRelay(eventToPublish, targetRelays);

      if (!publishPromises) {
        console.error('Error during publishing: No promises returned.');
        return;
      }

      // Wait for all publish attempts to complete
      await Promise.allSettled(
        publishPromises.map(async (promise, index) => {
          try {
            await promise;
            this.updatePublishResult(targetRelays[index], 'success', 'Published successfully');
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.updatePublishResult(targetRelays[index], 'error', errorMessage);
          }
        })
      );
    } catch (error) {
      console.error('Error during publishing:', error);
    } finally {
      this.isPublishing.set(false);
    }
  }

  parseCustomEvent(): Event | UnsignedEvent | null {
    const jsonString = this.customEventJson().trim();
    console.log('Parsing custom event, JSON length:', jsonString.length);

    if (!jsonString) {
      this.customEventError.set('Please enter an event JSON');
      return null;
    }

    try {
      const parsed = JSON.parse(jsonString);
      console.log('JSON parsed successfully:', parsed);

      // Validate required event fields with error reporting
      // Note: id and sig are now optional - they will be added during signing
      if (parsed.pubkey && typeof parsed.pubkey !== 'string') {
        this.customEventError.set('Event "pubkey" field must be a string (or omitted for signing)');
        console.log('Validation failed: pubkey is not a string', parsed.pubkey);
        return null;
      }
      // Auto-generate created_at if missing (similar to how id/sig are auto-generated during signing)
      if (parsed.created_at === undefined || parsed.created_at === null) {
        parsed.created_at = Math.floor(Date.now() / 1000);
        console.log('Auto-generated created_at:', parsed.created_at);
      } else if (typeof parsed.created_at !== 'number') {
        this.customEventError.set('Event "created_at" field must be a number (Unix timestamp) or omitted for auto-generation');
        console.log('Validation failed: created_at is not a number', typeof parsed.created_at, parsed.created_at);
        return null;
      }
      if (typeof parsed.kind !== 'number') {
        this.customEventError.set('Event must have a valid "kind" field');
        console.log('Validation failed: kind is not a number', typeof parsed.kind, parsed.kind);
        return null;
      }
      if (!Array.isArray(parsed.tags)) {
        this.customEventError.set('Event must have a valid "tags" array');
        console.log('Validation failed: tags is not an array', parsed.tags);
        return null;
      }
      if (typeof parsed.content !== 'string') {
        this.customEventError.set('Event must have a valid "content" field (string)');
        console.log('Validation failed: content is not a string', typeof parsed.content);
        return null;
      }

      this.customEventError.set('');
      console.log('Event parsed successfully:', parsed);

      const event = parsed as Event | UnsignedEvent;

      // Update cache
      this.cachedParsedEvent = { json: jsonString, event };

      return event;
    } catch (error) {
      this.customEventError.set('Invalid JSON: ' + (error instanceof Error ? error.message : 'Unknown error'));
      return null;
    }
  }

  private updatePublishResult(url: string, status: 'success' | 'error', message?: string): void {
    this.publishResults.update(results =>
      results.map(result => (result.url === url ? { ...result, status, message } : result))
    );
  }

  close(): void {
    this.dialogRef.close();
  }

  canPublish(): boolean {
    const isPublishing = this.isPublishing();
    const targetRelaysCount = this.getTargetRelays().length;
    const customModeActive = this.customMode();
    const customEventJsonEmpty = !this.customEventJson().trim();

    console.log('canPublish check:', {
      isPublishing,
      targetRelaysCount,
      customModeActive,
      customEventJsonEmpty,
      result: !isPublishing && targetRelaysCount > 0 && (!customModeActive || !customEventJsonEmpty)
    });

    if (isPublishing) {
      return false;
    }
    if (targetRelaysCount === 0) {
      return false;
    }
    if (customModeActive && customEventJsonEmpty) {
      return false;
    }
    return true;
  }

  toggleJsonView(): void {
    this.showJsonView.update(show => !show);
  }

  toggleRelaysView(): void {
    this.showRelaysView.update(show => !show);
  }

  getEventJson(): string {
    if (this.customMode()) {
      const parsed = this.getParsedEvent();
      return parsed ? JSON.stringify(parsed, null, 2) : this.customEventJson();
    }
    return JSON.stringify(this.data.event, null, 2);
  }

  onCustomEventChange(value: string): void {
    this.customEventJson.set(value);
    // Clear error when user types
    if (this.customEventError()) {
      this.customEventError.set('');
    }
  }
}
