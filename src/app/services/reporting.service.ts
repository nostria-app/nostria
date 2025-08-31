import { Injectable, inject, signal, computed } from '@angular/core';
import { Event, UnsignedEvent } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { StorageService } from './storage.service';
import { LoggerService } from './logger.service';

export type ReportType =
  | 'nudity'
  | 'malware'
  | 'profanity'
  | 'illegal'
  | 'spam'
  | 'impersonation'
  | 'other';

export interface ReportTarget {
  type: 'user' | 'content';
  pubkey: string;
  eventId?: string;
}

export interface MuteListItem {
  type: 'p' | 'e' | 't' | 'word';
  value: string;
}

/**
 * Service to handle NIP-56 reporting and NIP-51 mute list management
 */
@Injectable({
  providedIn: 'root',
})
export class ReportingService {
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);
  private data = inject(DataService);
  private storage = inject(StorageService);
  private logger = inject(LoggerService);

  // Override signals for showing blocked content
  private contentOverrides = signal<Set<string>>(new Set());

  // Computed signals for mute list items
  mutedPubkeys = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]);
  });

  mutedEvents = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter((tag) => tag[0] === 'e').map((tag) => tag[1]);
  });

  mutedHashtags = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter((tag) => tag[0] === 't').map((tag) => tag[1]);
  });

  mutedWords = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter((tag) => tag[0] === 'word').map((tag) => tag[1]);
  });

  /**
   * Create a NIP-56 report event
   */
  createReportEvent(target: ReportTarget, reportType: ReportType, content?: string): Event {
    const account = this.accountState.account();
    if (!account?.pubkey) {
      throw new Error('No account available for reporting');
    }

    const tags: string[][] = [];

    // Always include the pubkey being reported
    tags.push(['p', target.pubkey, reportType]);

    // For content reports, include the event ID
    if (target.type === 'content' && target.eventId) {
      tags.push(['e', target.eventId, reportType]);
    }

    const reportEvent = this.utilities.createEvent(
      1984, // NIP-56 report kind
      content || '',
      tags,
      account.pubkey,
    );

    return reportEvent as Event;
  }

  /**
   * Check if content should be blocked based on mute list
   */
  isContentBlocked(event: Event): boolean {
    // Check if user is muted
    if (this.mutedPubkeys().includes(event.pubkey)) {
      return true;
    }

    // Check if specific event is muted
    if (this.mutedEvents().includes(event.id)) {
      return true;
    }

    // Check for muted hashtags in event tags
    const eventHashtags = event.tags
      .filter((tag) => tag[0] === 't')
      .map((tag) => tag[1]?.toLowerCase());

    if (
      eventHashtags.some((hashtag) =>
        this.mutedHashtags().some((muted) => muted.toLowerCase() === hashtag),
      )
    ) {
      return true;
    }

    // Check for muted words in content
    const content = event.content?.toLowerCase() || '';
    if (this.mutedWords().some((word) => content.includes(word.toLowerCase()))) {
      return true;
    }

    return false;
  }

  /**
   * Check if content override is active for a specific event
   */
  isContentOverrideActive(eventId: string): boolean {
    return this.contentOverrides().has(eventId);
  }

  /**
   * Toggle content override for a specific event
   */
  toggleContentOverride(eventId: string): void {
    this.contentOverrides.update((overrides) => {
      const newOverrides = new Set(overrides);
      if (newOverrides.has(eventId)) {
        newOverrides.delete(eventId);
      } else {
        newOverrides.add(eventId);
      }
      return newOverrides;
    });
  }

  /**
   * Add an item to the mute list
   */
  async addToMuteList(item: MuteListItem): Promise<void> {
    const account = this.accountState.account();
    if (!account?.pubkey) {
      this.logger.warn('No account available for mute list update');
      return;
    }

    let muteList = this.accountState.muteList();

    // Create new mute list if none exists
    if (!muteList) {
      muteList = this.utilities.createEvent(
        10000, // NIP-51 mute list kind
        '',
        [],
        account.pubkey,
      ) as Event;
    }

    // Check if item already exists
    const existingTag = muteList.tags.find((tag) => tag[0] === item.type && tag[1] === item.value);

    if (existingTag) {
      this.logger.debug('Item already in mute list', item);
      return;
    }

    // Add new tag
    muteList.tags.push([item.type, item.value]);

    // Update the account state
    this.accountState.updateMuteList(muteList);

    this.logger.debug('Added item to mute list', item);
  }

  /**
   * Remove an item from the mute list
   */
  async removeFromMuteList(item: MuteListItem): Promise<void> {
    const muteList = this.accountState.muteList();
    if (!muteList) {
      this.logger.warn('No mute list available for update');
      return;
    }

    // Remove the tag
    muteList.tags = muteList.tags.filter((tag) => !(tag[0] === item.type && tag[1] === item.value));

    // Update the account state
    this.accountState.updateMuteList(muteList);

    this.logger.debug('Removed item from mute list', item);
  }

  /**
   * Mute a user (adds to mute list)
   */
  async muteUser(pubkey: string): Promise<void> {
    await this.addToMuteList({
      type: 'p',
      value: pubkey,
    });
  }

  /**
   * Mute an event/thread (adds to mute list)
   */
  async muteEvent(eventId: string): Promise<void> {
    await this.addToMuteList({
      type: 'e',
      value: eventId,
    });
  }

  /**
   * Mute a hashtag (adds to mute list)
   */
  async muteHashtag(hashtag: string): Promise<void> {
    await this.addToMuteList({
      type: 't',
      value: hashtag.toLowerCase(),
    });
  }

  /**
   * Mute a word (adds to mute list)
   */
  async muteWord(word: string): Promise<void> {
    await this.addToMuteList({
      type: 'word',
      value: word.toLowerCase(),
    });
  }

  /**
   * Get report type options for the UI
   */
  getReportTypeOptions(): { value: ReportType; label: string; description: string }[] {
    return [
      {
        value: 'nudity',
        label: 'Nudity/Adult Content',
        description: 'Sexual or explicit content',
      },
      {
        value: 'spam',
        label: 'Spam',
        description: 'Unwanted promotional content or repetitive messages',
      },
      {
        value: 'profanity',
        label: 'Hateful Speech',
        description: 'Offensive language or discriminatory content',
      },
      {
        value: 'illegal',
        label: 'Illegal Content',
        description: 'Content that may be illegal in some jurisdictions',
      },
      {
        value: 'impersonation',
        label: 'Impersonation',
        description: 'Someone pretending to be someone else',
      },
      {
        value: 'malware',
        label: 'Malware/Security Threat',
        description: 'Malicious software or security risks',
      },
      {
        value: 'other',
        label: 'Other',
        description: 'Other issues not covered above',
      },
    ];
  }
}
