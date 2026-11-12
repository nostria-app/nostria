import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject, signal, computed, effect, untracked, Service } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event, kinds, UnsignedEvent } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { EncryptionService } from './encryption.service';
import { LoggerService } from './logger.service';
import { NostrService } from './nostr.service';
import { SettingsService } from './settings.service';
import { PublishService } from './publish.service';
import { AccountRelayService } from './relays/account-relay';
import { PoolService } from './relays/pool.service';
import { UserRelaysService } from './relays/user-relays';
import { DatabaseService } from './database.service';
import { MessagingService } from './messaging.service';
import {
  applyMuteListChange,
  collectMuteValues,
  MuteListChange,
  parsePrivateMuteTags,
  pickNewestMuteList,
} from '../utils/mute-list';

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

type ProfileMutedWordField = {
  value: string;
  matchMode: 'word' | 'substring';
};

/**
 * Service to handle NIP-56 reporting and NIP-51 mute list management
 */
@Service()
export class ReportingService {
  private accountState = inject(AccountStateService);
  private utilities = inject(UtilitiesService);
  private data = inject(DataService);
  private logger = inject(LoggerService);
  private nostr = inject(NostrService);
  private settings = inject(SettingsService);
  private publishService = inject(PublishService);
  private accountRelay = inject(AccountRelayService);
  private userRelays = inject(UserRelaysService);
  private pool = inject(PoolService);
  private database = inject(DatabaseService);
  private messaging = inject(MessagingService);
  private encryption = inject(EncryptionService);
  private snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Kind 10000 we built after a complete relay read. Newer than a slow relay echo.
  private authoritativeMuteListId: string | null = null;
  // Event id whose private content was already decrypted into account state.
  private importedMuteListId: string | null = null;
  private privateTagSyncGeneration = 0;
  // Private tags waiting to be stored once the replacement event is signed.
  private pendingPrivateTags: string[][] = [];

  private readonly muteListFetchTimeoutMs = 8000;

  // Override signals for showing blocked content
  private contentOverrides = signal<Set<string>>(new Set());

  // Signal to notify when a new report is published
  // Contains the event ID and timestamp of the report
  private reportPublished = signal<{ eventId: string; timestamp: number } | null>(null);

  constructor() {
    // Decrypt is a browser crypto call, so it cannot be a computed. Import
    // private NIP-51 entries whenever the cached list changes; publishing
    // still refuses unless a fresh decrypt of the relay copy succeeds.
    if (!this.isBrowser) return;

    effect(() => {
      const event = this.accountState.muteList();
      untracked(() => {
        void this.syncPrivateMuteTags(event);
      });
    });
  }

  // Computed signals for mute list items (public tags + decrypted private entries)
  mutedPubkeys = computed(() =>
    collectMuteValues(this.accountState.muteList()?.tags, this.accountState.privateMuteTags(), 'p'),
  );

  mutedEvents = computed(() =>
    collectMuteValues(this.accountState.muteList()?.tags, this.accountState.privateMuteTags(), 'e'),
  );

  mutedHashtags = computed(() =>
    collectMuteValues(this.accountState.muteList()?.tags, this.accountState.privateMuteTags(), 't'),
  );

  mutedWords = computed(() =>
    collectMuteValues(this.accountState.muteList()?.tags, this.accountState.privateMuteTags(), 'word'),
  );

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
    * Checks name and display_name as whole words, and nip05/lud16 as identifier substrings.
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

    this.data.getProfileMetadataRevision();

    // Get cached profile (synchronous, doesn't trigger async fetch)
    const profile = this.data.getCachedProfile(pubkey);
    if (!profile?.data) {
      return false;
    }

    const profileData = profile.data;
    const fieldsToCheck = ReportingService.collectProfileFieldsForMutedWordCheck(profileData as Record<string, unknown>);

    // Check profile text fields as whole words and identifier fields as substrings
    return ReportingService.fieldsContainMutedWord(fieldsToCheck, mutedWords);
  }

  static collectProfileFieldsForMutedWordCheck(profileData: Record<string, unknown>): ProfileMutedWordField[] {
    const fieldsToCheck: ProfileMutedWordField[] = [];

    ReportingService.appendLowerCaseProfileValues(fieldsToCheck, profileData['name'], 'word');
    ReportingService.appendLowerCaseProfileValues(fieldsToCheck, profileData['display_name'], 'word');
    ReportingService.appendLowerCaseProfileValues(fieldsToCheck, profileData['nip05'], 'substring');
    ReportingService.appendLowerCaseProfileValues(fieldsToCheck, profileData['lud16'], 'substring');

    return fieldsToCheck;
  }

  private static appendLowerCaseProfileValues(
    fieldsToCheck: ProfileMutedWordField[],
    value: unknown,
    matchMode: ProfileMutedWordField['matchMode']
  ): void {
    const values = Array.isArray(value) ? value : [value];

    values.forEach(entry => {
      if (entry && typeof entry === 'string') {
        fieldsToCheck.push({
          value: entry.toLowerCase(),
          matchMode,
        });
      }
    });
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
    const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
    return regex.test(text);
  }

  static identifierContainsMutedWord(text: string, mutedWord: string): boolean {
    return text.toLowerCase().includes(mutedWord.toLowerCase());
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
   * Check if any of the given profile fields contain a muted word.
   * Plain text fields use whole-word matching, while identifier fields such
   * as nip05 and lud16 use substring matching.
   */
  static fieldsContainMutedWord(fields: Array<string | ProfileMutedWordField>, mutedWords: string[]): boolean {
    if (fields.length === 0 || mutedWords.length === 0) return false;

    return mutedWords.some(word =>
      fields.some(field => {
        const normalizedField = typeof field === 'string'
          ? { value: field, matchMode: 'word' as const }
          : field;

        if (normalizedField.matchMode === 'substring') {
          return ReportingService.identifierContainsMutedWord(normalizedField.value, word);
        }

        return ReportingService.wordMatchesMutedWord(normalizedField.value, word);
      })
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
    * user's name, display_name, nip05, or lud16 fields.
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

      await this.messaging.deleteChatsForPubkeyLocally(pubkey, {
        addToDeadLetter: true,
        deadLetterReason: 'User blocked (NIP-51 mute list)',
        hideChat: true,
      });

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
    const unsignedEvent = await this.createUnsignedMuteListWithItem('word', word.toLowerCase());
    if (!unsignedEvent) return;

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      this.rememberPublishedMuteList(signedEvent);
      await this.saveMuteListEvent(signedEvent);

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
    const unsignedEvent = await this.createUnsignedMuteListWithItem('t', tag.toLowerCase());
    if (!unsignedEvent) return;

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      this.rememberPublishedMuteList(signedEvent);
      await this.saveMuteListEvent(signedEvent);

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
   * Create an unsigned mute list event with a new item (does not sign or update state).
   * Returns null when the latest list could not be loaded — callers must not publish.
   */
  private async createUnsignedMuteListWithItem(type: 'word' | 't' | 'e' | 'p', value: string): Promise<UnsignedEvent | null> {
    return this.prepareMuteListUpdate({ action: 'add', type, value });
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

    const tagType = type === 'user' ? 'p' : 'e';
    const muteListEvent = await this.prepareMuteListUpdate({
      action: 'add',
      type: tagType,
      value: target,
    });
    if (!muteListEvent) {
      return null;
    }

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(muteListEvent);

      this.rememberPublishedMuteList(signedEvent);
      await this.saveMuteListEvent(signedEvent);

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
    const unsignedEvent = await this.createUnsignedMuteListWithoutItem('p', pubkeyToRemove);
    if (!unsignedEvent) return null;

    try {
      const signedEvent = await this.nostr.signEvent(unsignedEvent);
      this.rememberPublishedMuteList(signedEvent);
      await this.saveMuteListEvent(signedEvent);
      return signedEvent;
    } catch (error) {
      this.logger.error('Error creating fresh mute list event:', error);
      return null;
    }
  }

  /**
   * Create an unsigned mute list event without a specific item (does not sign or update state).
   * Returns null when the latest list could not be loaded — callers must not publish.
   */
  private async createUnsignedMuteListWithoutItem(type: string, value: string): Promise<UnsignedEvent | null> {
    return this.prepareMuteListUpdate({ action: 'remove', type, value });
  }

  /**
   * Remove an item from the mute list and publish to relays
   */
  async removeFromMuteListAndPublish(item: MuteListItem): Promise<void> {
    const unsignedEvent = await this.createUnsignedMuteListWithoutItem(item.type, item.value);
    if (!unsignedEvent) return;

    try {
      // Sign the event
      const signedEvent = await this.nostr.signEvent(unsignedEvent);

      this.rememberPublishedMuteList(signedEvent);
      await this.saveMuteListEvent(signedEvent);

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
    this.authoritativeMuteListId = null;
    this.importedMuteListId = null;
    this.pendingPrivateTags = [];
    this.privateTagSyncGeneration++;
    this.accountState.privateMuteTags.set([]);
  }

  /**
   * Build the next kind 10000 from the newest copy on write relays and outbox
   * relays. A failed fetch, or private content that cannot be decrypted and
   * re-encrypted, returns null so nothing is signed or published.
   */
  private async prepareMuteListUpdate(change: MuteListChange): Promise<UnsignedEvent | null> {
    const account = this.accountState.account();
    if (!account?.pubkey) {
      return null;
    }

    const fetched = await this.fetchNewestMuteList(account.pubkey);
    if (!fetched.ok) {
      this.warnMuteListBlocked('fetch');
      return null;
    }

    const base = this.chooseMuteListBase(fetched.event);
    let privateTags: string[][] = [];
    if (base?.content?.trim()) {
      try {
        privateTags = await this.decryptPrivateMuteTags(base.content, account.pubkey);
      } catch (error) {
        this.logger.warn('Refusing to publish mute list because private entries could not be decrypted', error);
        this.warnMuteListBlocked('decrypt');
        return null;
      }
    }

    const merged = applyMuteListChange(base?.tags, privateTags, change);
    let content = '';
    if (merged.privateTags.length > 0) {
      try {
        // NIP-51: private entries are a JSON tag array, encrypted to the author.
        content = await this.encryption.encryptNip44(JSON.stringify(merged.privateTags), account.pubkey);
      } catch (error) {
        this.logger.warn('Refusing to publish mute list because private entries could not be re-encrypted', error);
        this.warnMuteListBlocked('decrypt');
        return null;
      }
    }

    this.pendingPrivateTags = merged.privateTags;

    return {
      kind: kinds.Mutelist,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: merged.publicTags,
      pubkey: account.pubkey,
    };
  }

  private chooseMuteListBase(relayEvent: Event | null): Event | null {
    const local = this.accountState.muteList();
    if (
      local?.id &&
      local.id === this.authoritativeMuteListId &&
      (!relayEvent || local.created_at >= relayEvent.created_at)
    ) {
      return local;
    }
    return relayEvent;
  }

  private rememberPublishedMuteList(event: Event): void {
    this.authoritativeMuteListId = event.id;
    this.importedMuteListId = event.id;
    this.accountState.privateMuteTags.set(this.pendingPrivateTags.map(tag => [...tag]));
    this.accountState.muteList.set(event);
  }

  private warnMuteListBlocked(reason: 'fetch' | 'decrypt'): void {
    const message = reason === 'fetch'
      ? $localize`:@@reporting.muteList.notLoaded:Couldn't load your mute list from relays, so nothing was changed.`
      : $localize`:@@reporting.muteList.privateUnavailable:Couldn't read the private part of your mute list, so nothing was changed.`;
    this.snackBar.open(message, $localize`:@@common.dismiss:Dismiss`, { duration: 6000 });
  }

  private async syncPrivateMuteTags(event: Event | undefined): Promise<void> {
    const generation = ++this.privateTagSyncGeneration;
    if (!event?.content?.trim()) {
      if (this.accountState.privateMuteTags().length > 0) {
        this.accountState.privateMuteTags.set([]);
      }
      this.importedMuteListId = event?.id ?? null;
      return;
    }

    if (event.id === this.importedMuteListId) return;

    const pubkey = event.pubkey || this.accountState.account()?.pubkey;
    if (!pubkey) return;

    try {
      const tags = await this.decryptPrivateMuteTags(event.content, pubkey);
      if (generation !== this.privateTagSyncGeneration) return;
      if (this.accountState.muteList()?.id !== event.id) return;
      this.accountState.privateMuteTags.set(tags);
      this.importedMuteListId = event.id;
    } catch (error) {
      if (generation !== this.privateTagSyncGeneration) return;
      this.logger.warn('Mute list private entries are not available yet', error);
      if (this.accountState.muteList()?.id === event.id) {
        this.accountState.privateMuteTags.set([]);
      }
      this.importedMuteListId = event.id;
    }
  }

  /**
   * NIP-44 first, then NIP-04. A failure here must propagate so the edit is
   * dropped instead of publishing an empty `content`.
   */
  private async decryptPrivateMuteTags(content: string, pubkey: string): Promise<string[][]> {
    let plaintext: string | undefined;
    let nip44Error: unknown;

    try {
      plaintext = await this.encryption.decryptNip44(content, pubkey);
    } catch (error) {
      nip44Error = error;
    }

    if (plaintext === undefined) {
      try {
        plaintext = await this.encryption.decryptNip04(content, pubkey);
      } catch (nip04Error) {
        this.logger.warn('NIP-44 and NIP-04 decryption failed for mute list', { nip44Error, nip04Error });
        throw nip04Error instanceof Error ? nip04Error : new Error('Mute list decryption failed');
      }
    }

    return parsePrivateMuteTags(plaintext);
  }

  private async fetchNewestMuteList(pubkey: string): Promise<{ ok: true; event: Event | null } | { ok: false }> {
    let outboxRelays: string[];
    try {
      outboxRelays = await this.withTimeout(
        this.userRelays.getUserRelays(pubkey),
        this.muteListFetchTimeoutMs,
        'Outbox relay discovery',
      );
    } catch (error) {
      this.logger.warn('Refusing to publish mute list because outbox relays could not be loaded', error);
      return { ok: false };
    }

    const writeRelays = this.getWriteRelayUrls();
    const outboxUrls = this.uniqueRelayUrls(outboxRelays);
    if (writeRelays.length === 0 && outboxUrls.length === 0) {
      this.logger.warn('Refusing to publish mute list because no write or outbox relays are available', { pubkey });
      return { ok: false };
    }

    try {
      // One subscription over the union so a relay that is both a write relay
      // and an outbox relay is not queried twice. Each group still has to EOSE.
      const query = await this.queryMuteListRelays(
        this.uniqueRelayUrls([...writeRelays, ...outboxUrls]),
        pubkey,
      );

      const writeLoaded = this.groupReachedEose(writeRelays, query.eoseUrls);
      const outboxLoaded = this.groupReachedEose(outboxUrls, query.eoseUrls);
      if (!writeLoaded || !outboxLoaded) {
        this.logger.warn('Refusing to publish mute list because a relay query timed out before EOSE', {
          pubkey,
          writeLoaded,
          outboxLoaded,
          writeRelays,
          outboxUrls,
        });
        return { ok: false };
      }

      return {
        ok: true,
        event: pickNewestMuteList(query.events),
      };
    } catch (error) {
      this.logger.warn('Refusing to publish mute list because the relay query failed', error);
      return { ok: false };
    }
  }

  private getWriteRelayUrls(): string[] {
    const marked = this.accountRelay.relays()
      .filter(relay => relay.write !== false && !!relay.url)
      .map(relay => relay.url);
    if (marked.length > 0) {
      return this.uniqueRelayUrls(marked);
    }
    return this.uniqueRelayUrls(this.accountRelay.getRelayUrls());
  }

  private uniqueRelayUrls(urls: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const url of urls) {
      const trimmed = url?.trim();
      if (!trimmed) continue;
      const key = this.normalizeRelayUrl(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(trimmed);
    }
    return unique;
  }

  private normalizeRelayUrl(url: string): string {
    return url.trim().replace(/\/+$/, '').toLowerCase();
  }

  private groupReachedEose(urls: string[], eoseUrls: Set<string>): boolean {
    if (urls.length === 0) return true;
    const reached = new Set([...eoseUrls].map(url => this.normalizeRelayUrl(url)));
    // Every relay in the group must EOSE. A timeout on one relay can hide a
    // newer kind 10000, and publishing the copy we did see would replace it.
    return urls.every(url => reached.has(this.normalizeRelayUrl(url)));
  }

  /**
   * Read kind 10000 from each relay until that relay sends EOSE, fails, or the
   * deadline passes. nostr-tools treats its own eose timer as a real EOSE, so
   * this waits on the relay's oneose callback and keeps that timer past our
   * deadline. A relay that only times out must not look like an empty list.
   */
  private queryMuteListRelays(urls: string[], pubkey: string): Promise<{ events: Event[]; eoseUrls: Set<string> }> {
    if (urls.length === 0) {
      return Promise.resolve({ events: [], eoseUrls: new Set() });
    }

    const events: Event[] = [];
    const eoseUrls = new Set<string>();
    const pending = new Set(urls.map(url => this.normalizeRelayUrl(url)));
    const subscriptions: { close: () => void }[] = [];
    let settled = false;

    return new Promise(resolve => {
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const subscription of subscriptions) {
          try {
            subscription.close();
          } catch {
            // The relay may already have closed this subscription.
          }
        }
        resolve({ events, eoseUrls });
      };

      const markDone = (url: string, reachedEose: boolean) => {
        if (settled) return;
        const key = this.normalizeRelayUrl(url);
        if (!pending.has(key)) return;
        pending.delete(key);
        if (reachedEose) eoseUrls.add(key);
        if (pending.size === 0) finish();
      };

      const timer = setTimeout(() => finish(), this.muteListFetchTimeoutMs);

      void Promise.all(urls.map(async url => {
        try {
          const relay = await this.withTimeout(
            this.pool.pool.ensureRelay(url),
            this.muteListFetchTimeoutMs,
            `Mute list relay ${url}`,
          );
          if (settled) return;

          const subscription = relay.subscribe(
            [{ authors: [pubkey], kinds: [kinds.Mutelist], limit: 1 }],
            {
              // Longer than our deadline so the library's fake EOSE timer
              // cannot mark a silent relay as finished.
              eoseTimeout: this.muteListFetchTimeoutMs + 5000,
              onevent: (event: Event) => {
                if (event.pubkey === pubkey && event.kind === kinds.Mutelist) {
                  events.push(event);
                }
              },
              oneose: () => markDone(url, true),
              onclose: () => markDone(url, false),
            },
          );
          subscriptions.push(subscription);
        } catch (error) {
          this.logger.warn('Mute list relay did not connect', { url, error });
          markDone(url, false);
        }
      }));
    });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private async saveMuteListEvent(event: Event): Promise<void> {
    try {
      await this.database.saveReplaceableEvent(event);
    } catch (error) {
      this.logger.warn('Failed to store mute list locally', error);
    }
  }
}
