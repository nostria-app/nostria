import { Injectable, inject, signal, computed } from '@angular/core';
import { Event, UnsignedEvent } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { StorageService } from './storage.service';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { SettingsService } from './settings.service';

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
  private nostr = inject(NostrService);
  private settings = inject(SettingsService);

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
   * Check if a specific user is muted/blocked
   */
  isUserBlocked(pubkey: string): boolean {
    if (!pubkey) return false;
    return this.mutedPubkeys().includes(pubkey);
  }

  /**
   * Check if content override is active for a specific event
   */
  isContentOverrideActive(eventId: string): boolean {
    return this.contentOverrides().has(eventId);
  }

  /**
   * Check if an event should be hidden due to reports
   * This is a simple check that can be expanded with more logic
   */
  shouldHideEventDueToReports(_event: Event): boolean {
    // For now, we'll determine this based on the event component loading reports
    // The actual hiding logic will be handled by the event component
    // This method can be expanded to include threshold logic, trust networks, etc.
    return false; // Placeholder - actual logic will be in the event component
  }

  /**
   * Check if content should be hidden based on report types and user settings
   */
  shouldHideContentForReportTypes(reportTypes: string[]): boolean {
    const userSettings = this.settings.settings();

    return reportTypes.some((reportType) => {
      switch (reportType) {
        case 'nudity':
          return userSettings.hideNudity ?? true;
        case 'malware':
          return userSettings.hideMalware ?? true;
        case 'profanity':
          return userSettings.hideProfanity ?? true;
        case 'illegal':
          return userSettings.hideIllegal ?? true;
        case 'spam':
          return userSettings.hideSpam ?? true;
        case 'impersonation':
          return userSettings.hideImpersonation ?? true;
        case 'other':
          return userSettings.hideOther ?? true;
        default:
          return true; // Hide unknown report types by default
      }
    });
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
    // Create a fresh mute list event with the user
    const freshMuteList = await this.createFreshMuteListEvent('user', pubkey);
    if (freshMuteList) {
      // Publish the updated mute list to account relays
      this.accountState.publish.set(freshMuteList);
      this.logger.debug('Blocked user and published mute list:', pubkey);
    }
  }

  /**
   * Unblock a user (removes from mute list)
   */
  async unblockUser(pubkey: string): Promise<void> {
    // Create a fresh mute list event without the user
    const freshMuteList = await this.createFreshMuteListWithoutUser(pubkey);
    if (freshMuteList) {
      // Publish the updated mute list to account relays
      this.accountState.publish.set(freshMuteList);
    }
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

  /**
   * Create a fresh mute list event with new timestamp
   */
  async createFreshMuteListEvent(type: 'user' | 'event', target: string): Promise<Event | null> {
    const account = this.accountState.account();
    if (!account?.pubkey) {
      return null;
    }

    // Get current mute list or create empty tags array
    const currentMuteList = this.accountState.muteList();
    let existingTags: string[][] = [];

    if (currentMuteList) {
      existingTags = [...currentMuteList.tags];
    }

    // Add the new target to the tags
    if (type === 'user') {
      // Check if user is already muted
      const isAlreadyMuted = existingTags.some((tag) => tag[0] === 'p' && tag[1] === target);
      if (!isAlreadyMuted) {
        existingTags.push(['p', target]);
      }
    } else if (type === 'event') {
      // Check if event is already muted
      const isAlreadyMuted = existingTags.some((tag) => tag[0] === 'e' && tag[1] === target);
      if (!isAlreadyMuted) {
        existingTags.push(['e', target]);
      }
    }

    // Create fresh event with current timestamp
    const muteListEvent: UnsignedEvent = {
      kind: 10000,
      created_at: Math.floor(Date.now() / 1000), // Fresh timestamp
      content: '',
      tags: existingTags,
      pubkey: account.pubkey,
    };

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(muteListEvent);

      // Update the account state with the new mute list
      this.accountState.muteList.set(signedEvent);

      return signedEvent;
    } catch (error) {
      console.error('Error creating fresh mute list event:', error);
      return null;
    }
  }

  /**
   * Create a fresh mute list event without a specific user
   */
  async createFreshMuteListWithoutUser(pubkeyToRemove: string): Promise<Event | null> {
    const account = this.accountState.account();
    if (!account?.pubkey) {
      return null;
    }

    // Get current mute list or create empty tags array
    const currentMuteList = this.accountState.muteList();
    let existingTags: string[][] = [];

    if (currentMuteList) {
      // Filter out the user to be removed
      existingTags = currentMuteList.tags.filter(
        (tag) => !(tag[0] === 'p' && tag[1] === pubkeyToRemove),
      );
    }

    // Create fresh event with current timestamp
    const muteListEvent: UnsignedEvent = {
      kind: 10000,
      created_at: Math.floor(Date.now() / 1000), // Fresh timestamp
      content: '',
      tags: existingTags,
      pubkey: account.pubkey,
    };

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(muteListEvent);

      // Update the account state with the new mute list
      this.accountState.muteList.set(signedEvent);

      return signedEvent;
    } catch (error) {
      console.error('Error creating fresh mute list event without user:', error);
      return null;
    }
  }

  /**
   * Clear reporting service state when switching accounts
   */
  clear(): void {
    // Reset content overrides
    this.contentOverrides.set(new Set());
  }
}
