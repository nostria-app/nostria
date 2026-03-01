import { Injectable, inject, signal, computed } from '@angular/core';
import { Event, UnsignedEvent } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { SettingsService } from './settings.service';
import { PublishService } from './publish.service';

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
  private logger = inject(LoggerService);
  private nostr = inject(NostrService);
  private settings = inject(SettingsService);
  private publishService = inject(PublishService);

  // Override signals for showing blocked content
  private contentOverrides = signal<Set<string>>(new Set());

  // Signal to notify when a new report is published
  // Contains the event ID and timestamp of the report
  private reportPublished = signal<{ eventId: string; timestamp: number } | null>(null);

  // Computed signals for mute list items
  mutedPubkeys = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
  });

  mutedEvents = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter(tag => tag[0] === 'e').map(tag => tag[1]);
  });

  mutedHashtags = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter(tag => tag[0] === 't').map(tag => tag[1]);
  });

  mutedWords = computed(() => {
    const muteList = this.accountState.muteList();
    if (!muteList?.tags) return [];
    return muteList.tags.filter(tag => tag[0] === 'word').map(tag => tag[1]);
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
      account.pubkey
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
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1]?.toLowerCase());

    if (
      eventHashtags.some(hashtag =>
        this.mutedHashtags().some(muted => muted.toLowerCase() === hashtag)
      )
    ) {
      return true;
    }

    // Check for muted words in content
    const mutedWords = this.mutedWords();
    if (ReportingService.contentContainsMutedWord(event.content, mutedWords)) {
      return true;
    }

    // Check for muted words in the author's profile (name, display_name, nip05)
    // This uses cached profiles only to keep the check synchronous
    if (this.checkProfileForMutedWords(event.pubkey, mutedWords)) {
      return true;
    }

    return false;
  }

  /**
   * Check if an author's profile contains any muted words.
   * Checks name, display_name, and nip05 fields using word boundary matching.
   * Only checks cached profiles to keep the operation synchronous.
   * 
   * @param pubkey The author's pubkey
   * @param mutedWords Array of muted words to check against
   * @returns true if any muted word is found in the profile
   */
  private checkProfileForMutedWords(pubkey: string, mutedWords: string[]): boolean {
    if (mutedWords.length === 0) {
      return false;
    }

    // Get cached profile (synchronous, doesn't trigger async fetch)
    const profile = this.data.getCachedProfile(pubkey);
    if (!profile?.data) {
      return false;
    }

    const profileData = profile.data;
    
    // Build a list of profile fields to check
    const fieldsToCheck: string[] = [];
    
    if (profileData.name) {
      fieldsToCheck.push(profileData.name.toLowerCase());
    }
    if (profileData.display_name) {
      fieldsToCheck.push(profileData.display_name.toLowerCase());
    }
    if (profileData.nip05) {
      const nip05Data = profileData.nip05;
      const nip05Values = Array.isArray(nip05Data) ? nip05Data : [nip05Data];
      nip05Values.forEach(v => {
        if (v && typeof v === 'string') {
          fieldsToCheck.push(v.toLowerCase());
        }
      });
    }

    // Check if any muted word appears as a whole word in any of the profile fields
    return ReportingService.fieldsContainMutedWord(fieldsToCheck, mutedWords);
  }

  /**
   * Regex to match nostr URIs (npub, nprofile, note, nevent, naddr) and HTTP(S) URLs.
   * These are stripped from content before muted word matching to avoid
   * false positives from encoded identifiers (e.g., "gm" inside an npub string).
   */
  private static readonly NOSTR_URI_AND_URL_REGEX =
    /nostr:(?:npub|nprofile|note|nevent|naddr)1(?:(?!(?:npub|nprofile|note|nevent|naddr)1)[a-z0-9])+|https?:\/\/\S+/gi;

  /**
   * Strip nostr URIs and URLs from content so muted word matching
   * only applies to human-readable text, not encoded identifiers.
   */
  static stripNostrUrisAndUrls(content: string): string {
    return content.replace(ReportingService.NOSTR_URI_AND_URL_REGEX, ' ');
  }

  /**
   * Check if a muted word appears as a whole word in the given text.
   * Uses word boundary matching to avoid false positives from substrings
   * (e.g., muting "gm" should not match "programming").
   */
  static wordMatchesMutedWord(text: string, mutedWord: string): boolean {
    const escaped = mutedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(text);
  }

  /**
   * Check if event content contains any muted word as a whole word.
   * Strips nostr URIs and URLs first to prevent false positives
   * from encoded identifiers.
   */
  static contentContainsMutedWord(content: string | undefined, mutedWords: string[]): boolean {
    if (!content || mutedWords.length === 0) return false;
    const cleaned = ReportingService.stripNostrUrisAndUrls(content);
    return mutedWords.some(word => ReportingService.wordMatchesMutedWord(cleaned, word));
  }

  /**
   * Check if any of the given text fields contain a muted word as a whole word.
   * Used for profile field matching (name, display_name, nip05).
   */
  static fieldsContainMutedWord(fields: string[], mutedWords: string[]): boolean {
    if (fields.length === 0 || mutedWords.length === 0) return false;
    return mutedWords.some(word =>
      fields.some(field => ReportingService.wordMatchesMutedWord(field, word))
    );
  }

  /**
   * Check if a specific user is muted/blocked
   */
  isUserBlocked(pubkey: string): boolean {
    if (!pubkey) return false;
    return this.mutedPubkeys().includes(pubkey);
  }

  /**
   * Check if a user's profile is blocked by muted words.
   * This is a public method that can be called from components to check
   * if a profile should be hidden based on muted words matching the
   * user's name, display_name, or nip05 fields.
   * 
   * @param pubkey The user's pubkey to check
   * @returns true if any muted word matches the user's profile
   */
  isProfileBlockedByMutedWord(pubkey: string): boolean {
    if (!pubkey) return false;
    const mutedWords = this.mutedWords();
    return this.checkProfileForMutedWords(pubkey, mutedWords);
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

    return reportTypes.some(reportType => {
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
    this.contentOverrides.update(overrides => {
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
   * Get the signal tracking newly published reports
   * Components can use this to reactively update when new reports are published
   */
  getReportPublishedSignal() {
    return this.reportPublished.asReadonly();
  }

  /**
   * Notify that a report has been published for a specific event
   * This triggers a signal update that listening components can react to
   */
  notifyReportPublished(eventId: string): void {
    this.reportPublished.set({ eventId, timestamp: Date.now() });
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
        account.pubkey
      ) as Event;
    }

    // Check if item already exists
    const existingTag = muteList.tags.find(tag => tag[0] === item.type && tag[1] === item.value);

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
    muteList.tags = muteList.tags.filter(tag => !(tag[0] === item.type && tag[1] === item.value));

    // Update the account state
    this.accountState.updateMuteList(muteList);

    this.logger.debug('Removed item from mute list', item);
  }

  /**
   * Mute a user (adds to mute list)
   * Returns true if the operation succeeded (event was signed and published),
   * false if signing failed (e.g. user dismissed PIN/extension dialog).
   */
  async muteUser(pubkey: string): Promise<boolean> {
    // Create a fresh mute list event with the user
    const freshMuteList = await this.createFreshMuteListEvent('user', pubkey);
    if (freshMuteList) {
      // Publish the already-signed mute list to account relays
      await this.publishService.publish(freshMuteList);
      this.logger.debug('Blocked user and published mute list:', pubkey);
      return true;
    }
    return false;
  }

  /**
   * Unblock a user (removes from mute list)
   * Returns true if the operation succeeded, false if signing failed.
   */
  async unblockUser(pubkey: string): Promise<boolean> {
    // Create a fresh mute list event without the user
    const freshMuteList = await this.createFreshMuteListWithoutUser(pubkey);
    if (freshMuteList) {
      // Publish the already-signed mute list to account relays
      await this.publishService.publish(freshMuteList);
      return true;
    }
    return false;
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
   * Add a word to mute list and publish to relays
   */
  async addWordToMuteListAndPublish(word: string): Promise<void> {
    const unsignedEvent = this.createUnsignedMuteListWithItem('word', word.toLowerCase());
    if (!unsignedEvent) return;

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      // Update local state immediately after signing
      this.accountState.muteList.set(signedEvent);

      // Publish the already-signed event
      const result = await this.publishService.publish(signedEvent);

      if (result.success) {
        this.logger.debug('Added word to mute list and published:', word);
      }
    } catch (error) {
      this.logger.error('Failed to add word to mute list:', error);
    }
  }

  /**
   * Add a tag to mute list and publish to relays
   */
  async addTagToMuteListAndPublish(tag: string): Promise<void> {
    const unsignedEvent = this.createUnsignedMuteListWithItem('t', tag.toLowerCase());
    if (!unsignedEvent) return;

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      // Update local state immediately after signing
      this.accountState.muteList.set(signedEvent);

      // Publish the already-signed event
      const result = await this.publishService.publish(signedEvent);

      if (result.success) {
        this.logger.debug('Added tag to mute list and published:', tag);
      }
    } catch (error) {
      this.logger.error('Failed to add tag to mute list:', error);
    }
  }

  /**
   * Create an unsigned mute list event with a new item (does not sign or update state)
   */
  private createUnsignedMuteListWithItem(type: 'word' | 't' | 'e' | 'p', value: string): UnsignedEvent | null {
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

    // Check if item is already muted
    const isAlreadyMuted = existingTags.some(tag => tag[0] === type && tag[1] === value);
    if (!isAlreadyMuted) {
      existingTags.push([type, value]);
    }

    // Create fresh event with current timestamp
    return {
      kind: 10000,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: existingTags,
      pubkey: account.pubkey,
    };
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
      const isAlreadyMuted = existingTags.some(tag => tag[0] === 'p' && tag[1] === target);
      if (!isAlreadyMuted) {
        existingTags.push(['p', target]);
      }
    } else if (type === 'event') {
      // Check if event is already muted
      const isAlreadyMuted = existingTags.some(tag => tag[0] === 'e' && tag[1] === target);
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
      // Use update() to force signal change detection
      this.accountState.muteList.set(signedEvent);

      // Force update by accessing the signal to ensure change detection
      this.accountState.muteList();

      return signedEvent;
    } catch (error) {
      this.logger.error('Error creating fresh mute list event:', error);
      return null;
    }
  }

  /**
   * Create a fresh mute list event without a specific user
   */
  async createFreshMuteListWithoutUser(pubkeyToRemove: string): Promise<Event | null> {
    const unsignedEvent = this.createUnsignedMuteListWithoutItem('p', pubkeyToRemove);
    if (!unsignedEvent) return null;

    try {
      const signedEvent = await this.nostr.signEvent(unsignedEvent);
      this.accountState.muteList.set(signedEvent);
      return signedEvent;
    } catch (error) {
      this.logger.error('Error creating fresh mute list event:', error);
      return null;
    }
  }

  /**
   * Create an unsigned mute list event without a specific item (does not sign or update state)
   */
  private createUnsignedMuteListWithoutItem(type: string, value: string): UnsignedEvent | null {
    const account = this.accountState.account();
    if (!account?.pubkey) {
      return null;
    }

    // Get current mute list or create empty tags array
    const currentMuteList = this.accountState.muteList();
    let existingTags: string[][] = [];

    if (currentMuteList) {
      // Filter out the item to be removed
      existingTags = currentMuteList.tags.filter(
        tag => !(tag[0] === type && tag[1] === value)
      );
    }

    // Create fresh event with current timestamp
    return {
      kind: 10000,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: existingTags,
      pubkey: account.pubkey,
    };
  }

  /**
   * Remove an item from the mute list and publish to relays
   */
  async removeFromMuteListAndPublish(item: MuteListItem): Promise<void> {
    const unsignedEvent = this.createUnsignedMuteListWithoutItem(item.type, item.value);
    if (!unsignedEvent) return;

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      // Update local state immediately after signing
      this.accountState.muteList.set(signedEvent);

      // Publish the already-signed event
      const result = await this.publishService.publish(signedEvent);

      if (result.success) {
        this.logger.debug('Removed item from mute list and published:', item);
      }
    } catch (error) {
      this.logger.error('Failed to remove item from mute list:', error);
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
