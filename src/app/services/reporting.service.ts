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

  // Same 5s bound as RelayPoolService.query and RelayServiceBase.get.
  private readonly muteListFetchTimeoutMs = 5000;
  /** A stuck signer or decrypt prompt must not block later mute-list edits. */
  private readonly muteListSignerTimeoutMs = 15000;
  /** Serializes mute-list edits so a second change re-reads the first result. */
  private muteListEditChain: Promise<void> = Promise.resolve();

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
   * Mute a user (adds to mute list)
   * Returns true if the operation succeeded (event was signed and published),
   * false if signing failed (e.g. user dismissed PIN/extension dialog).
   */
  async muteUser(pubkey: string): Promise<boolean> {
    const published = await this.enqueueMuteListEdit(async (startedPubkey) => {
      const freshMuteList = await this.signMuteListChange(
        { action: 'add', type: 'p', value: pubkey },
        startedPubkey,
      );
      if (!freshMuteList) return false;

      await this.publishService.publish(freshMuteList);
      await this.messaging.deleteChatsForPubkeyLocally(pubkey, {
        addToDeadLetter: true,
        deadLetterReason: 'User blocked (NIP-51 mute list)',
        hideChat: true,
      });

      this.logger.debug('Blocked user and published mute list:', pubkey);
      return true;
    });
    return published === true;
  }

  /**
   * Unblock a user (removes from mute list)
   * Returns true if the operation succeeded, false if signing failed.
   */
  async unblockUser(pubkey: string): Promise<boolean> {
    const published = await this.enqueueMuteListEdit(async (startedPubkey) => {
      const freshMuteList = await this.signMuteListChange(
        { action: 'remove', type: 'p', value: pubkey },
        startedPubkey,
      );
      if (!freshMuteList) return false;
      await this.publishService.publish(freshMuteList);
      return true;
    });
    return published === true;
  }

  /**
   * Add a word to mute list and publish to relays
   */
  async addWordToMuteListAndPublish(word: string): Promise<void> {
    await this.enqueueMuteListEdit((startedPubkey) => this.publishMuteListChange({
      action: 'add',
      type: 'word',
      value: word.toLowerCase(),
    }, 'word', word, startedPubkey));
  }

  /**
   * Add a tag to mute list and publish to relays
   */
  async addTagToMuteListAndPublish(tag: string): Promise<void> {
    await this.enqueueMuteListEdit((startedPubkey) => this.publishMuteListChange({
      action: 'add',
      type: 't',
      value: tag.toLowerCase(),
    }, 'tag', tag, startedPubkey));
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
    const tagType = type === 'user' ? 'p' : 'e';
    const signed = await this.enqueueMuteListEdit((startedPubkey) => this.signMuteListChange({
      action: 'add',
      type: tagType,
      value: target,
    }, startedPubkey));
    return signed ?? null;
  }

  /**
   * Create a fresh mute list event without a specific user
   */
  async createFreshMuteListWithoutUser(pubkeyToRemove: string): Promise<Event | null> {
    const signed = await this.enqueueMuteListEdit((startedPubkey) => this.signMuteListChange({
      action: 'remove',
      type: 'p',
      value: pubkeyToRemove,
    }, startedPubkey));
    return signed ?? null;
  }

  /**
   * Remove an item from the mute list and publish to relays
   */
  async removeFromMuteListAndPublish(item: MuteListItem): Promise<void> {
    await this.enqueueMuteListEdit((startedPubkey) => this.publishMuteListChange({
      action: 'remove',
      type: item.type,
      value: item.value,
    }, 'item', item, startedPubkey));
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
   * Run mute-list edits one at a time. The pubkey is the account at click time,
   * not the account that happens to be active when the queued edit starts.
   */
  private enqueueMuteListEdit<T>(edit: (startedPubkey: string) => Promise<T>): Promise<T | undefined> {
    const startedPubkey = this.accountState.account()?.pubkey;
    const run = this.muteListEditChain.then(
      () => this.runQueuedMuteListEdit(startedPubkey, edit),
      () => this.runQueuedMuteListEdit(startedPubkey, edit),
    );
    this.muteListEditChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async runQueuedMuteListEdit<T>(
    startedPubkey: string | undefined,
    edit: (startedPubkey: string) => Promise<T>,
  ): Promise<T | undefined> {
    if (!startedPubkey) return undefined;
    if (!this.accountMatches(startedPubkey)) {
      this.logger.warn('Refusing queued mute list edit because the account changed', { startedPubkey });
      this.warnMuteListBlocked('fetch');
      return undefined;
    }
    return edit(startedPubkey);
  }

  private accountMatches(pubkey: string): boolean {
    return this.accountState.account()?.pubkey === pubkey;
  }

  private isEditTimeout(error: unknown): boolean {
    return error instanceof Error && error.message.includes('timed out');
  }

  private async publishMuteListChange(
    change: MuteListChange,
    label: string,
    detail: unknown,
    startedPubkey: string,
  ): Promise<void> {
    const signedEvent = await this.signMuteListChange(change, startedPubkey);
    if (!signedEvent) return;

    const result = await this.publishService.publish(signedEvent);
    if (result.success) {
      this.logger.debug(`Updated mute list (${label})`, detail);
    }
  }

  /**
   * Read, merge, and sign one mute-list edit for the account that started it.
   * Does not publish. Callers that publish must stay inside the edit queue.
   */
  private async signMuteListChange(change: MuteListChange, startedPubkey: string): Promise<Event | null> {
    if (!this.accountMatches(startedPubkey)) {
      this.warnMuteListBlocked('fetch');
      return null;
    }

    const unsignedEvent = await this.prepareMuteListUpdate(change, startedPubkey);
    if (!unsignedEvent) return null;
    if (!this.accountMatches(startedPubkey)) {
      this.warnMuteListBlocked('fetch');
      return null;
    }

    try {
      const signedEvent = await this.withTimeout(
        this.nostr.signEvent(unsignedEvent),
        this.muteListSignerTimeoutMs,
        'Mute list signing',
      );
      if (signedEvent.pubkey !== startedPubkey || !this.accountMatches(startedPubkey)) {
        this.logger.warn('Refusing to publish mute list because the account changed', {
          startedPubkey,
          signedPubkey: signedEvent.pubkey,
          currentPubkey: this.accountState.account()?.pubkey,
        });
        this.warnMuteListBlocked('fetch');
        return null;
      }

      this.rememberPublishedMuteList(signedEvent);
      await this.saveMuteListEvent(signedEvent);
      return signedEvent;
    } catch (error) {
      if (this.isEditTimeout(error)) {
        this.logger.warn('Refusing to publish mute list because signing timed out', error);
        this.warnMuteListBlocked('fetch');
      } else {
        this.logger.error('Error signing mute list', error);
      }
      return null;
    }
  }

  private async prepareMuteListUpdate(change: MuteListChange, startedPubkey: string): Promise<UnsignedEvent | null> {
    if (!this.accountMatches(startedPubkey)) {
      this.warnMuteListBlocked('fetch');
      return null;
    }

    const fetched = await this.fetchNewestMuteList(startedPubkey);
    if (!this.accountMatches(startedPubkey)) {
      this.warnMuteListBlocked('fetch');
      return null;
    }
    if (!fetched.ok) {
      this.warnMuteListBlocked('fetch', fetched.silentRelays);
      return null;
    }

    const base = this.chooseMuteListBase(fetched.event);
    let privateTags: string[][] = [];
    if (base?.content?.trim()) {
      try {
        privateTags = await this.withTimeout(
          this.decryptPrivateMuteTags(base.content, startedPubkey),
          this.muteListSignerTimeoutMs,
          'Mute list decryption',
        );
      } catch (error) {
        this.logger.warn('Refusing to publish mute list because private entries could not be decrypted', error);
        this.warnMuteListBlocked('decrypt');
        return null;
      }
    }

    if (!this.accountMatches(startedPubkey)) {
      this.warnMuteListBlocked('fetch');
      return null;
    }

    const merged = applyMuteListChange(base?.tags, privateTags, change);
    let content = '';
    if (merged.privateTags.length > 0) {
      try {
        // NIP-51 private entries, re-encrypted with NIP-44. Amethyst's kind 10000
        // path reads both NIP-04 and NIP-44 (NostrSigner.decrypt) and writes NIP-44.
        content = await this.encryption.encryptNip44(JSON.stringify(merged.privateTags), startedPubkey);
      } catch (error) {
        this.logger.warn('Refusing to publish mute list because private entries could not be re-encrypted', error);
        this.warnMuteListBlocked('decrypt');
        return null;
      }
    }

    if (!this.accountMatches(startedPubkey)) {
      this.warnMuteListBlocked('fetch');
      return null;
    }

    this.pendingPrivateTags = merged.privateTags;

    return {
      kind: kinds.Mutelist,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: merged.publicTags,
      pubkey: startedPubkey,
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

  private warnMuteListBlocked(reason: 'fetch' | 'decrypt', silentRelays: string[] = []): void {
    const message = reason === 'decrypt'
      ? $localize`:@@reporting.muteList.privateUnavailable:Couldn't read the private part of your mute list, so nothing was changed.`
      : this.muteListFetchWarning(silentRelays);
    this.snackBar.open(message, $localize`:@@common.dismiss:Dismiss`, { duration: 8000 });
  }

  private muteListFetchWarning(silentRelays: string[]): string {
    if (silentRelays.length === 0) {
      return $localize`:@@reporting.muteList.notLoaded:Couldn't load your mute list from relays, so nothing was changed.`;
    }
    const relays = silentRelays.join(', ');
    return $localize`:@@reporting.muteList.notLoadedRelays:Couldn't load your mute list, so nothing was changed. No answer from ${relays}:relays:.`;
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

  private async fetchNewestMuteList(
    pubkey: string,
  ): Promise<{ ok: true; event: Event | null } | { ok: false; silentRelays: string[] }> {
    let outboxRelays: string[];
    try {
      outboxRelays = await this.withTimeout(
        this.userRelays.getUserRelays(pubkey),
        this.muteListFetchTimeoutMs,
        'Outbox relay discovery',
      );
    } catch (error) {
      this.logger.warn('Refusing to publish mute list because outbox relays could not be loaded', error);
      return { ok: false, silentRelays: [] };
    }

    const writeRelays = this.getWriteRelayUrls();
    const outboxUrls = this.uniqueRelayUrls(outboxRelays);
    if (writeRelays.length === 0 && outboxUrls.length === 0) {
      this.logger.warn('Refusing to publish mute list because no write or outbox relays are available', { pubkey });
      return { ok: false, silentRelays: [] };
    }

    const urls = this.uniqueRelayUrls([...writeRelays, ...outboxUrls]);

    try {
      // One query over the union so a relay that is both a write relay and an
      // outbox relay is not counted twice. A dead relay must not block the edit
      // once two relays (or every relay, when fewer than two are configured)
      // have sent EOSE or a kind 10000.
      const query = await this.queryMuteListRelays(urls, pubkey);
      const answered = urls.filter(url => query.answeredUrls.has(this.normalizeRelayUrl(url)));
      if (!this.muteListQuorumMet(urls.length, answered.length)) {
        const silentRelays = urls.filter(url => !query.answeredUrls.has(this.normalizeRelayUrl(url)));
        this.logger.warn('Refusing to publish mute list because too few relays answered', {
          pubkey,
          answered,
          silentRelays,
        });
        return { ok: false, silentRelays };
      }

      return {
        ok: true,
        event: pickNewestMuteList(query.events),
      };
    } catch (error) {
      this.logger.warn('Refusing to publish mute list because the relay query failed', error);
      return { ok: false, silentRelays: urls };
    }
  }

  /** Two answers, or every relay when fewer than two are configured. */
  private muteListQuorumMet(configured: number, answered: number): boolean {
    if (configured === 0) return false;
    const required = configured < 2 ? configured : 2;
    return answered >= required;
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

  /**
   * Read kind 10000 until each relay sends EOSE, fails, or the deadline passes.
   * nostr-tools treats its own eose timer as a real EOSE, so this waits on the
   * relay's oneose callback and keeps that timer past our deadline. A kind 10000
   * event also counts as an answer when EOSE never arrives.
   */
  private queryMuteListRelays(
    urls: string[],
    pubkey: string,
  ): Promise<{ events: Event[]; answeredUrls: Set<string> }> {
    if (urls.length === 0) {
      return Promise.resolve({ events: [], answeredUrls: new Set() });
    }

    const events: Event[] = [];
    const answeredUrls = new Set<string>();
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
        resolve({ events, answeredUrls });
      };

      const markAnswered = (url: string) => {
        answeredUrls.add(this.normalizeRelayUrl(url));
      };

      const markDone = (url: string, reachedEose: boolean) => {
        if (settled) return;
        const key = this.normalizeRelayUrl(url);
        if (!pending.has(key)) return;
        pending.delete(key);
        if (reachedEose) markAnswered(url);
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
                  markAnswered(url);
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
