import { computed, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import {
  Filter,
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  kinds,
  NostrEvent,
} from 'nostr-tools';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';
import { EncryptionPermissionService } from './encryption-permission.service';
import { NostriaService } from '../interfaces';
import { bytesToHex } from 'nostr-tools/utils';
import { AccountRelayService } from './relays/account-relay';
import { DatabaseService, StoredDirectMessage } from './database.service';
import { AccountLocalStateService } from './account-local-state.service';
import { RelayPoolService } from './relays/relay-pool';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { SettingsService } from './settings.service';

// Define interfaces for our DM data structures
interface Chat {
  id: string;
  pubkey: string; // For 1-on-1: counterparty pubkey. For groups: empty string (use participants instead)
  unreadCount: number;
  lastMessage?: DirectMessage | null;
  relays?: string[];
  encryptionType?: 'nip04' | 'nip44';
  hasLegacyMessages?: boolean; // true if chat contains any NIP-04 messages
  messages: Map<string, DirectMessage>;
  /** Group chat fields (NIP-17 chat rooms) */
  isGroup?: boolean;
  /** All participant pubkeys INCLUDING the current user, sorted. Defines the room identity. */
  participants?: string[];
  /** Optional conversation name/topic (from the newest 'subject' tag) */
  subject?: string;
  /** Timestamp of the newest subject tag seen */
  subjectUpdatedAt?: number;
}

/**
 * Compute a deterministic chat ID for a group conversation.
 * The room identity is defined by the sorted set of all participant pubkeys.
 * Returns a hex string derived from sorting and joining the pubkeys.
 */
export function computeGroupChatId(participantPubkeys: string[]): string {
  const sorted = [...new Set(participantPubkeys)].sort();
  return 'group:' + sorted.join(',');
}

/**
 * Determine the chat ID and metadata from an unwrapped NIP-44 message.
 * For 1-on-1 messages (single p-tag), returns the counterparty pubkey as chatId.
 * For group messages (multiple p-tags), computes a deterministic group chat ID.
 */
function resolveChatTarget(
  unwrappedMessage: { pubkey: string; tags?: string[][] },
  myPubkey: string
): { chatId: string; isGroup: boolean; participants: string[] } | null {
  const pTags = (unwrappedMessage.tags || [])
    .filter((t: string[]) => t[0] === 'p' && t[1])
    .map((t: string[]) => t[1]);

  if (pTags.length === 0) return null;

  // Collect all participants: sender + all p-tag recipients
  const allParticipants = [...new Set([unwrappedMessage.pubkey, ...pTags])];

  if (allParticipants.length <= 2) {
    // 1-on-1 chat: use counterparty pubkey as chatId (backward compatible)
    const counterparty = unwrappedMessage.pubkey === myPubkey
      ? pTags[0]
      : unwrappedMessage.pubkey;
    if (!counterparty) return null;
    return { chatId: counterparty, isGroup: false, participants: allParticipants };
  }

  // Group chat: 3+ unique participants
  return {
    chatId: computeGroupChatId(allParticipants),
    isGroup: true,
    participants: [...new Set(allParticipants)].sort(),
  };
}

interface DirectMessage {
  id: string;
  rumorKind?: number;
  pubkey: string;
  created_at: number;
  content: string;
  isOutgoing: boolean;
  tags: string[][];
  pending?: boolean;
  failed?: boolean;
  received?: boolean;
  read?: boolean;
  encryptionType?: 'nip04' | 'nip44';
  replyTo?: string; // The event ID this message is replying to (from 'e' tag)
  quotedReplyContent?: string;
  quotedReplyAuthor?: string;
  giftWrapId?: string; // For NIP-44 messages, the gift wrap event ID (used to skip re-decryption)
  failureReason?: string; // Human-readable reason for send failure
  eventKind?: 'message' | 'reaction';
  reactionTo?: string;
  reactionContent?: string;
}

interface DeadLetterListRecord {
  eventIds?: string[];
}

@Injectable({
  providedIn: 'root',
})
export class MessagingService implements NostriaService {
  private nostr = inject(NostrService);
  private relay = inject(AccountRelayService);
  private discoveryRelay = inject(DiscoveryRelayService);
  private pool = inject(RelayPoolService);
  private logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  readonly utilities = inject(UtilitiesService);
  private readonly encryption = inject(EncryptionService);
  private readonly encryptionPermission = inject(EncryptionPermissionService);
  private readonly database = inject(DatabaseService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly injector = inject(Injector);
  private readonly settingsService = inject(SettingsService);
  private userRelayService: any = null; // Lazy-initialized to control load timing

  /** Audio element for new-message notification sound */
  private notificationAudio: HTMLAudioElement | null = null;
  /** Prevents rapid-fire notification sounds */
  private lastNotificationSoundTime = 0;

  isLoading = signal<boolean>(false);
  isLoadingMoreChats = signal<boolean>(false);
  hasMoreChats = signal<boolean>(true);
  error = signal<string | null>(null);
  bootstrapUnreadCount = signal<number | null>(null);

  private chatsMap = signal<Map<string, Chat>>(new Map());
  private oldestChatTimestamp = signal<number | null>(null);
  private bootstrappedPubkey: string | null = null;
  private bootstrapPromise: Promise<void> | null = null;

  /**
   * Fast in-memory lookup of all known outer event IDs (gift wrap IDs for NIP-44,
   * event IDs for NIP-04) that have already been processed. Prevents redundant
   * decryption when the same event arrives from multiple relays or code paths.
   */
  private knownEventIds = new Set<string>();

  /**
   * Tracks gift-wrap event IDs currently being decrypted so concurrent relay
   * callbacks do not queue duplicate decrypt operations for the same event.
   */
  private inFlightGiftWrapIds = new Set<string>();

  /**
   * Persistent dead-letter list for invalid/corrupted DM event IDs.
   * These IDs are skipped across reloads so the app does not repeatedly try
   * to decrypt the same unrecoverable spam/corrupted events.
   */
  private deadLetterEventIds = new Set<string>();
  private deadLetterPersistPromise: Promise<void> = Promise.resolve();

  private readonly deadLetterInfoKey = 'direct-messages';
  private readonly deadLetterInfoType = 'dead-letter-list';
  private readonly maxDeadLetterEventIds = 2000;
  private readonly directMessagePublishTimeoutMs = 5000;
  private readonly DM_STARTUP_DELAY_MS = 4000;
  private readonly MESSAGE_NOTIFICATION_MAX_AGE_SECONDS = 60 * 60;

  /**
   * Resolve callback to cancel the DM startup delay early.
   * Set when the 4-second delay is active; called by requestImmediateDmStart().
   */
  private dmStartupDelayResolve: (() => void) | null = null;

  MESSAGE_SIZE = 400;
  private readonly NOTIFICATION_SOUND_COOLDOWN_MS = 2000;

  /** Play a short notification chime using the Web Audio API */
  private playNotificationSound(): void {
    if (this.settingsService.settings().messageNotificationSoundsEnabled === false) {
      return;
    }

    const now = Date.now();
    if (now - this.lastNotificationSoundTime < this.NOTIFICATION_SOUND_COOLDOWN_MS) return;
    this.lastNotificationSoundTime = now;

    try {
      const ctx = new AudioContext();
      const playTone = (frequency: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.15, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const t = ctx.currentTime;
      playTone(880, t, 0.15);       // A5
      playTone(1174.66, t + 0.12, 0.18); // D6

      // Clean up context after sounds finish
      setTimeout(() => ctx.close(), 500);
    } catch {
      // AudioContext not available (e.g. SSR or denied) – silently ignore
    }
  }

  private shouldPlayNotificationSound(message: DirectMessage): boolean {
    if (message.isOutgoing || message.read) {
      return false;
    }

    const notificationCutoff = this.utilities.currentDate() - this.MESSAGE_NOTIFICATION_MAX_AGE_SECONDS;
    return message.created_at >= notificationCutoff;
  }

  getChat(chatId: string): Chat | null {
    const chat = this.chatsMap().get(chatId);
    return chat || null;
  }

  sortedChats = computed(() => {
    return Array.from(this.chatsMap().entries())
      .map(([chatId, chat]) => ({ chatId, chat }))
      .sort((a, b) => {
        const aTime = a.chat.lastMessage?.created_at || 0;
        const bTime = b.chat.lastMessage?.created_at || 0;
        return bTime - aTime; // Most recent first
      });
  });

  /**
   * Total unread messages count across all chats
   * Note: Computed signals should be pure - side effects moved to an effect
   */
  totalUnreadCount = computed(() => {
    let count = 0;
    for (const [, chat] of this.chatsMap().entries()) {
      count += chat.unreadCount;
    }
    return count;
  });

  unreadBadgeCount = computed(() => {
    const liveCount = this.totalUnreadCount();
    if (this.chatsMap().size > 0 || liveCount > 0) {
      return liveCount;
    }

    return this.bootstrapUnreadCount() ?? 0;
  });

  constructor() {
    // Effect to persist unread count to local storage when it changes
    effect(() => {
      const count = this.totalUnreadCount();
      const pubkey = this.accountState.pubkey();

      if (pubkey) {
        // Use untracked to avoid reading more signals
        untracked(() => {
          const cachedCount = this.accountLocalState.getUnreadMessagesCount(pubkey);
          if (cachedCount !== count) {
            this.accountLocalState.setUnreadMessagesCount(pubkey, count);
          }
        });
      }
    });

    // Effect to auto-start DM subscription when user is logged in
    // This ensures we receive incoming messages even when not on the Messages page
    // Skip for preview accounts - they cannot decrypt DMs
    effect(() => {
      const pubkey = this.accountState.pubkey();
      const account = this.accountState.account();
      const canUseDirectMessages = this.accountState.canUseDirectMessages(account);

      if (pubkey && canUseDirectMessages) {
        // User is logged in with a non-preview account - start the subscription
        untracked(() => {
          this.logger.info('Auto-starting DM subscription for logged in user');
          this.startDmSubscriptionWithRetry();
        });
      } else if (pubkey && account) {
        untracked(() => {
          this.logger.info('Skipping DM subscription for account without signing/decryption capability');
          this.bootstrapUnreadCount.set(null);
          this.bootstrappedPubkey = null;
          if (this.dmStartupDelayResolve) {
            this.dmStartupDelayResolve();
            this.dmStartupDelayResolve = null;
          }
          if (this.liveSubscription) {
            this.closeLiveSubscription();
          }
        });
      } else {
        // User logged out - close the subscription
        untracked(() => {
          this.bootstrapUnreadCount.set(null);
          this.bootstrappedPubkey = null;
          // Cancel any pending startup delay to prevent stale subscription
          if (this.dmStartupDelayResolve) {
            this.dmStartupDelayResolve();
            this.dmStartupDelayResolve = null;
          }
          if (this.liveSubscription) {
            this.logger.info('Closing DM subscription - user logged out');
            this.closeLiveSubscription();
          }
        });
      }
    });
  }

  /**
   * Start the DM subscription with retry logic to wait for relay initialization.
   * Includes a startup delay to prioritize more important queries (metadata, follow lists, etc.).
   * The delay is skipped if the user navigates to Messages before it elapses.
   */
  private async startDmSubscriptionWithRetry(): Promise<void> {
    if (!this.accountState.canUseDirectMessages()) {
      this.logger.info('[MessagingService] Skipping DM startup for account without signing/decryption capability');
      return;
    }

    this.logger.debug('[MessagingService] Waiting for relay initialization before starting DM subscription');

    try {
      await this.relay.waitUntilInitialized();
    } catch {
      this.logger.warn('[MessagingService] Relay initialization timed out, attempting subscription anyway');
    }

    await this.bootstrapFromStorage();

    // Delay DM subscription to let higher-priority queries (metadata, contacts, follow sets) complete first.
    // This delay is cancelled immediately if the user navigates to the Messages page.
    this.logger.debug(`[MessagingService] Delaying DM subscription by ${this.DM_STARTUP_DELAY_MS}ms to prioritize other queries`);
    await new Promise<void>(resolve => {
      this.dmStartupDelayResolve = resolve;
      setTimeout(() => {
        this.dmStartupDelayResolve = null;
        resolve();
      }, this.DM_STARTUP_DELAY_MS);
    });

    // If subscription was already started by the Messages page during the delay, skip
    if (this.liveSubscription) {
      this.logger.debug('[MessagingService] DM subscription already active (started by Messages page), skipping');
      return;
    }

    this.logger.debug('Starting DM subscription...');
    const sub = await this.subscribeToIncomingMessages();
    if (sub) {
      this.logger.info('DM subscription started successfully');
    } else {
      this.logger.warn('Failed to start DM subscription');
    }
  }

  hasMessage(chatId: string, messageId: string): boolean {
    const chat = this.chatsMap().get(chatId);
    if (!chat) return false;

    return chat.messages.has(messageId);
  }

  getChatMessages(chatId: string): DirectMessage[] {
    const chat = this.chatsMap().get(chatId);
    if (!chat) return [];

    return Array.from(chat.messages.values()).sort((a, b) => a.created_at - b.created_at); // Oldest first
  }

  /**
   * Extract the reply-to message ID from event tags
   * According to NIP-17, 'e' tags denote the direct parent message
   */
  private getReplyToFromTags(tags: string[][]): string | undefined {
    const eTag = tags.find(tag => tag[0] === 'e');
    return eTag ? eTag[1] : undefined;
  }

  /**
   * Extract subject from tags (NIP-17 chat rooms).
   * Returns the subject string if found, undefined otherwise.
   */
  private getSubjectFromTags(tags: string[][]): string | undefined {
    const subjectTag = tags.find(tag => tag[0] === 'subject');
    return subjectTag?.[1];
  }

  /**
   * Build group info from a resolved chat target and message tags/timestamp.
   * Returns undefined for 1-on-1 chats.
   */
  private buildGroupInfo(
    target: { chatId: string; isGroup: boolean; participants: string[] },
    tags: string[][],
    created_at: number
  ): { isGroup: boolean; participants: string[]; subject?: string; subjectUpdatedAt?: number } | undefined {
    if (!target.isGroup) return undefined;
    const subject = this.getSubjectFromTags(tags);
    return {
      isGroup: true,
      participants: target.participants,
      subject,
      subjectUpdatedAt: subject ? created_at : undefined,
    };
  }

  private isLikelyReactionContent(content: string): boolean {
    if (!content) {
      return false;
    }

    if (content === '+' || content === '-') {
      return true;
    }

    if (/^:[A-Za-z0-9_\-+]+:$/.test(content)) {
      return true;
    }

    const compact = content.trim();
    if (!compact || compact.includes(' ')) {
      return false;
    }

    // Most emoji reactions are short grapheme clusters; keep this strict to avoid classifying short reply text.
    return Array.from(compact).length <= 4;
  }

  private isReactionFromTags(tags: string[][], content: string): boolean {
    const kTag = tags.find(tag => tag[0] === 'k');
    const hasETag = tags.some(tag => tag[0] === 'e' && !!tag[1]);
    if (!hasETag) {
      return false;
    }

    if (kTag?.[1] === String(kinds.PrivateDirectMessage)) {
      return true;
    }

    return this.isLikelyReactionContent(content);
  }

  private getReactionTargetFromTags(tags: string[][]): string | undefined {
    const eTag = tags.find(tag => tag[0] === 'e');
    return eTag?.[1];
  }

  private extractStructuredReplyPreview(content: string): {
    content: string;
    quotedReplyContent?: string;
    quotedReplyAuthor?: string;
  } {
    const trimmedContent = content.trim();
    if (!trimmedContent.startsWith('{') || !trimmedContent.endsWith('}')) {
      return { content };
    }

    try {
      const parsed = JSON.parse(trimmedContent) as {
        c?: unknown;
        type?: unknown;
        msg?: unknown;
        content?: unknown;
        name?: unknown;
      };

      const looksLikeStructuredPayload =
        typeof parsed === 'object' &&
        parsed !== null &&
        (
          typeof parsed.c === 'string' ||
          typeof parsed.type === 'number' ||
          typeof parsed.msg === 'string' ||
          typeof parsed.name === 'string'
        );

      if (!looksLikeStructuredPayload) {
        return { content };
      }

      const result: {
        content: string;
        quotedReplyContent?: string;
        quotedReplyAuthor?: string;
      } = {
        content,
      };

      if (typeof parsed.msg === 'string' && parsed.msg.trim()) {
        result.content = parsed.msg;
      } else if (typeof parsed.content === 'string' && parsed.content.trim()) {
        result.content = parsed.content;
      }

      if (typeof parsed.name === 'string') {
        try {
          const nested = JSON.parse(parsed.name) as { content?: unknown; user?: unknown };
          if (typeof nested.content === 'string' && nested.content.trim()) {
            result.quotedReplyContent = nested.content;
          }
          if (typeof nested.user === 'string' && nested.user.trim()) {
            result.quotedReplyAuthor = nested.user;
          }
        } catch {
          return result;
        }
      }

      return result;
    } catch {
      return { content };
    }
  }

  private extractStructuredDirectMessageContent(content: string): string {
    return this.extractStructuredReplyPreview(content).content;
  }

  private normalizeMessage(message: DirectMessage): DirectMessage {
    const structuredPreview = this.extractStructuredReplyPreview(message.content || '');
    const normalizedContent = structuredPreview.content;
    const tags = [...(message.tags || [])].filter(tag => !tag[0]?.startsWith('_nostria_'));
    const messageKind = message.rumorKind ?? kinds.PrivateDirectMessage;
    const isReaction =
      message.eventKind === 'reaction' ||
      (messageKind !== kinds.FileMessage && this.isReactionFromTags(tags, normalizedContent));

    if (!isReaction) {
      return {
        ...message,
        content: normalizedContent,
        quotedReplyContent: message.quotedReplyContent || structuredPreview.quotedReplyContent,
        quotedReplyAuthor: message.quotedReplyAuthor || structuredPreview.quotedReplyAuthor,
        tags,
        eventKind: 'message',
      };
    }

    const reactionTarget = message.reactionTo || this.getReactionTargetFromTags(tags);

    return {
      ...message,
      content: normalizedContent,
      quotedReplyContent: message.quotedReplyContent || structuredPreview.quotedReplyContent,
      quotedReplyAuthor: message.quotedReplyAuthor || structuredPreview.quotedReplyAuthor,
      tags,
      eventKind: 'reaction',
      reactionTo: reactionTarget,
      reactionContent: message.reactionContent || normalizedContent,
      replyTo: undefined,
    };
  }

  private getUnreadDelta(message: DirectMessage): number {
    return !message.isOutgoing && !message.read ? 1 : 0;
  }

  private async hydrateStoredMessageState(chatId: string, message: DirectMessage): Promise<DirectMessage> {
    if (message.isOutgoing || message.read) {
      return message;
    }

    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      return message;
    }

    try {
      await this.database.init();
      const storedMessage = await this.database.getDirectMessage(myPubkey, chatId, message.id);

      if (!storedMessage) {
        return message;
      }

      return {
        ...message,
        read: storedMessage.read || message.read,
        received: storedMessage.received || message.received,
        pending: message.pending ?? storedMessage.pending,
        failed: message.failed ?? storedMessage.failed,
        giftWrapId: message.giftWrapId || storedMessage.giftWrapId,
        failureReason: message.failureReason ?? storedMessage.failureReason,
      };
    } catch (error) {
      this.logger.warn('Failed to hydrate stored message state, using live payload', error);
      return message;
    }
  }

  private async addResolvedMessageToChat(
    pubkey: string,
    message: DirectMessage,
    groupInfo?: { isGroup: boolean; participants: string[]; subject?: string; subjectUpdatedAt?: number }
  ): Promise<void> {
    const resolvedMessage = await this.hydrateStoredMessageState(pubkey, message);
    this.addMessageToChat(pubkey, resolvedMessage, groupInfo);
  }

  /**
   * Update an existing message in a chat (e.g., to change pending/failed/received status).
   * Returns true if the message was found and updated, false otherwise.
   */
  updateMessageInChat(pubkey: string, messageId: string, updates: Partial<DirectMessage>): boolean {
    const currentMap = this.chatsMap();
    const chatId = pubkey;
    const chat = currentMap.get(chatId);
    if (!chat) return false;

    const existingMessage = chat.messages.get(messageId);
    if (!existingMessage) return false;

    const updatedMessage = { ...existingMessage, ...updates };
    const newMessagesMap = new Map(chat.messages);
    newMessagesMap.set(messageId, updatedMessage);

    const newMap = new Map(currentMap);
    newMap.set(chatId, {
      ...chat,
      messages: newMessagesMap,
      lastMessage: this.getLatestMessage(newMessagesMap),
    });
    this.chatsMap.set(newMap);

    // Update in storage too
    this.saveMessageToStorage(updatedMessage, chatId);
    return true;
  }

  /**
   * Remove a message from a chat (e.g., when retrying a failed message).
   */
  removeMessageFromChat(pubkey: string, messageId: string): void {
    const currentMap = this.chatsMap();
    const chatId = pubkey;
    const chat = currentMap.get(chatId);
    if (!chat || !chat.messages.has(messageId)) return;

    const newMessagesMap = new Map(chat.messages);
    newMessagesMap.delete(messageId);

    const newMap = new Map(currentMap);
    newMap.set(chatId, {
      ...chat,
      messages: newMessagesMap,
      lastMessage: this.getLatestMessage(newMessagesMap),
    });
    this.chatsMap.set(newMap);
  }

  // Helper method to add a message to a chat (prevents duplicates and updates sorting)
  // For group chats, pass groupInfo with isGroup, participants, and optional subject.
  addMessageToChat(
    pubkey: string,
    message: DirectMessage,
    groupInfo?: { isGroup: boolean; participants: string[]; subject?: string; subjectUpdatedAt?: number }
  ): void {
    // Validate pubkey/chatId to prevent creating invalid chats
    if (!pubkey || pubkey === 'undefined') {
      this.logger.warn('Cannot add message to chat: invalid pubkey', { pubkey, messageId: message.id });
      return;
    }

    const normalizedMessage = this.normalizeMessage(message);
    const currentMap = this.chatsMap();
    // Use pubkey directly as chatId - messages are merged regardless of encryption type
    const chatId = pubkey;

    // Check if this message already exists in the specific chat to prevent duplicates
    const existingChat = currentMap.get(chatId);
    if (existingChat && existingChat.messages.has(normalizedMessage.id)) {
      const existingMessage = existingChat.messages.get(normalizedMessage.id)!;

      // Relay-sourced copies of an existing optimistic message should clear stale
      // local delivery state instead of being ignored as a duplicate.
      const shouldConfirmExistingMessage =
        (!!existingMessage.pending || !!existingMessage.failed || !existingMessage.received) &&
        !normalizedMessage.pending &&
        !normalizedMessage.failed &&
        !!normalizedMessage.received;

      if (shouldConfirmExistingMessage) {
        this.logger.debug(`Message ${normalizedMessage.id} already exists in chat ${chatId}, merging relay-confirmed state`);
        this.updateMessageInChat(chatId, normalizedMessage.id, {
          pending: false,
          failed: false,
          received: true,
          failureReason: undefined,
          giftWrapId: normalizedMessage.giftWrapId || existingMessage.giftWrapId,
          encryptionType: normalizedMessage.encryptionType || existingMessage.encryptionType,
        });
        return;
      }

      // Message already exists in this chat, don't add it again.
      this.logger.debug(`Message ${normalizedMessage.id} already exists in chat ${chatId}, skipping to prevent duplicate`);

      // Even though we're not adding the message, if the incoming copy has a
      // giftWrapId that the existing message lacks, persist it so that future
      // reloads can skip decryption for this gift-wrap event entirely.
      if (normalizedMessage.giftWrapId) {
        this.knownEventIds.add(normalizedMessage.giftWrapId);

        if (!existingMessage.giftWrapId) {
          this.updateMessageInChat(chatId, normalizedMessage.id, {
            giftWrapId: normalizedMessage.giftWrapId,
          });
        }
      }

      // Even if the message is a duplicate, update subject if this message has a newer one
      if (groupInfo?.subject && existingChat.isGroup) {
        this.maybeUpdateGroupSubject(chatId, groupInfo.subject, groupInfo.subjectUpdatedAt);
      }

      return;
    }

    // Track the outer event ID so future encounters can skip decryption entirely
    if (normalizedMessage.giftWrapId) {
      this.knownEventIds.add(normalizedMessage.giftWrapId);
    }
    this.knownEventIds.add(normalizedMessage.id);

    // Create a new Map to ensure signal reactivity
    const newMap = new Map(currentMap);

    // Individual chats are keyed by pubkey (or group chatId), so we use pubkey as chatId
    const chat = newMap.get(chatId);

    if (!chat) {
      // Create new chat if it doesn't exist
      const newChat: Chat = {
        id: chatId,
        pubkey: groupInfo?.isGroup ? '' : pubkey,
        unreadCount: this.getUnreadDelta(normalizedMessage),
        lastMessage: normalizedMessage,
        relays: [],
        encryptionType: 'nip44', // Default to modern encryption for new messages
        hasLegacyMessages: normalizedMessage.encryptionType === 'nip04',
        messages: new Map([[normalizedMessage.id, normalizedMessage]]),
        isGroup: groupInfo?.isGroup || false,
        participants: groupInfo?.participants,
        subject: groupInfo?.subject,
        subjectUpdatedAt: groupInfo?.subjectUpdatedAt,
      };

      this.logger.debug('Created new chat with message', {
        chatId,
        messageId: normalizedMessage.id,
        isOutgoing: normalizedMessage.isOutgoing,
        unreadCount: newChat.unreadCount,
        isGroup: newChat.isGroup,
        participantCount: newChat.participants?.length,
      });

      // Add the new chat to the new map
      newMap.set(chatId, newChat);
    } else {
      // Update existing chat
      const updatedMessagesMap = new Map(chat.messages);
      updatedMessagesMap.set(normalizedMessage.id, normalizedMessage);

      // For groups, update subject if the incoming message has a newer one
      let subject = chat.subject;
      let subjectUpdatedAt = chat.subjectUpdatedAt;
      if (groupInfo?.subject && (!subjectUpdatedAt || (groupInfo.subjectUpdatedAt && groupInfo.subjectUpdatedAt > subjectUpdatedAt))) {
        subject = groupInfo.subject;
        subjectUpdatedAt = groupInfo.subjectUpdatedAt;
      }

      const updatedChat: Chat = {
        ...chat,
        messages: updatedMessagesMap,
        lastMessage: this.getLatestMessage(updatedMessagesMap),
        unreadCount: chat.unreadCount + this.getUnreadDelta(normalizedMessage),
        // Track if chat has any legacy (NIP-04) messages
        hasLegacyMessages: chat.hasLegacyMessages || normalizedMessage.encryptionType === 'nip04',
        // Update group metadata if provided
        subject,
        subjectUpdatedAt,
        // Merge participants if new ones found (shouldn't normally change for same room)
        participants: groupInfo?.participants || chat.participants,
      };

      this.logger.debug('Updated chat with message', {
        chatId,
        messageId: normalizedMessage.id,
        isOutgoing: normalizedMessage.isOutgoing,
        previousUnread: chat.unreadCount,
        newUnread: updatedChat.unreadCount,
      });

      // Update the chat in the new map
      newMap.set(chatId, updatedChat);
    }

    // Set the new map to trigger signal reactivity
    this.chatsMap.set(newMap);

    // Play notification sound for incoming unread messages
    if (this.shouldPlayNotificationSound(normalizedMessage)) {
      this.playNotificationSound();
    }

    // Save message to storage asynchronously
    this.saveMessageToStorage(normalizedMessage, chatId);
  }

  /**
   * Update the subject of a group chat if the new subject is newer.
   */
  private maybeUpdateGroupSubject(chatId: string, subject: string, subjectUpdatedAt?: number): void {
    const currentMap = this.chatsMap();
    const chat = currentMap.get(chatId);
    if (!chat || !chat.isGroup) return;

    if (!chat.subjectUpdatedAt || (subjectUpdatedAt && subjectUpdatedAt > chat.subjectUpdatedAt)) {
      const newMap = new Map(currentMap);
      newMap.set(chatId, {
        ...chat,
        subject,
        subjectUpdatedAt,
      });
      this.chatsMap.set(newMap);
    }
  }

  /**
   * Save a message to IndexedDB storage.
   * Uses put() semantics — inserts new messages and updates existing ones
   * (e.g. when pending→received status changes).
   */
  private async saveMessageToStorage(message: DirectMessage, chatId: string): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return;

    try {
      await this.database.init();
      const existingStoredMessage = await this.database.getDirectMessage(myPubkey, chatId, message.id);

      const storedMessage: StoredDirectMessage = {
        id: `${myPubkey}::${chatId}::${message.id}`,
        accountPubkey: myPubkey,
        chatId: chatId,
        messageId: message.id,
        rumorKind: message.rumorKind,
        pubkey: message.pubkey,
        created_at: message.created_at,
        content: message.content,
        isOutgoing: message.isOutgoing,
        tags: message.tags,
        encryptionType: message.encryptionType!,
        read: message.read || existingStoredMessage?.read || false,
        received: message.received ?? existingStoredMessage?.received ?? false,
        pending: message.pending ?? existingStoredMessage?.pending,
        failed: message.failed ?? existingStoredMessage?.failed,
        giftWrapId: message.giftWrapId || existingStoredMessage?.giftWrapId, // Store gift wrap ID for NIP-44 messages
        failureReason: message.failureReason ?? existingStoredMessage?.failureReason,
      };

      // database.saveDirectMessage uses store.put() which upserts,
      // so this correctly handles both inserts and status updates.
      await this.database.saveDirectMessage(storedMessage);
      this.logger.debug(`Saved message ${message.id} to storage`);
    } catch (error) {
      this.logger.error('Error saving message to storage:', error);
    }
  }

  // Helper method to get the latest message from a messages map
  private getLatestMessage(messagesMap: Map<string, DirectMessage>): DirectMessage | null {
    if (messagesMap.size === 0) return null;

    return Array.from(messagesMap.values()).sort((a, b) => b.created_at - a.created_at)[0];
  }

  private shouldSkipDmEvent(eventId: string | null | undefined): boolean {
    if (!eventId) {
      return false;
    }

    return this.knownEventIds.has(eventId) || this.deadLetterEventIds.has(eventId);
  }

  private getDecryptFailureReason(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    return 'Unknown decrypt failure';
  }

  private isTransientDecryptFailure(error: unknown): boolean {
    const reason = this.getDecryptFailureReason(error).toLowerCase();

    return reason.includes('browser extension nip-04 not available') ||
      reason.includes('browser extension nip-44 not available') ||
      reason.includes('private key not available') ||
      reason.includes('failed to decrypt private key') ||
      reason.includes('user may have cancelled') ||
      reason.includes('decryption returned empty result') ||
      reason.includes('failed to establish remote signer session') ||
      reason.includes('reconnect your signer') ||
      reason.includes('timed out') ||
      reason.includes('timeout') ||
      reason.includes('queue cleared') ||
      reason.includes('missing ciphertext or pubkey');
  }

  private isPermanentDecryptFailure(error: unknown, options?: { allowGenericDecryptFailure?: boolean }): boolean {
    if (this.isTransientDecryptFailure(error)) {
      return false;
    }

    if (error instanceof SyntaxError) {
      return true;
    }

    const reason = this.getDecryptFailureReason(error).toLowerCase();

    return reason.includes('invalid payload length') ||
      reason.includes('content does not appear to be encrypted') ||
      reason.includes('wrapped content is not a valid object') ||
      reason.includes('decrypted message pubkey does not match wrapped content pubkey') ||
      (!!options?.allowGenericDecryptFailure && (
        reason.includes('decryption failed') ||
        reason.includes('unable to decrypt message with any supported algorithm')
      ));
  }

  private normalizeDeadLetterEventIds(record: Record<string, unknown> | null): string[] {
    const eventIds = (record as DeadLetterListRecord | null)?.eventIds;
    if (!Array.isArray(eventIds)) {
      return [];
    }

    return eventIds.filter((eventId): eventId is string => typeof eventId === 'string' && eventId.trim().length > 0);
  }

  private trimDeadLetterEventIds(): void {
    if (this.deadLetterEventIds.size <= this.maxDeadLetterEventIds) {
      return;
    }

    const trimmedEventIds = Array.from(this.deadLetterEventIds).slice(-this.maxDeadLetterEventIds);
    this.deadLetterEventIds = new Set(trimmedEventIds);
  }

  private persistDeadLetterList(): void {
    this.trimDeadLetterEventIds();

    const eventIds = Array.from(this.deadLetterEventIds);
    if (eventIds.length === 0) {
      return;
    }

    this.deadLetterPersistPromise = this.deadLetterPersistPromise
      .catch(() => undefined)
      .then(async () => {
        await this.database.init();
        await this.database.saveInfo(this.deadLetterInfoKey, this.deadLetterInfoType, { eventIds });
      })
      .catch(error => {
        this.logger.warn('Failed to persist DM dead-letter list', error);
      });
  }

  private async loadDeadLetterListFromStorage(): Promise<void> {
    try {
      await this.database.init();
      const record = await this.database.getInfo(this.deadLetterInfoKey, this.deadLetterInfoType);
      const storedEventIds = this.normalizeDeadLetterEventIds(record);
      const mergedEventIds = new Set([...storedEventIds, ...this.deadLetterEventIds]);

      this.deadLetterEventIds = mergedEventIds;
      for (const eventId of mergedEventIds) {
        this.knownEventIds.add(eventId);
      }
    } catch (error) {
      this.logger.warn('Failed to load DM dead-letter list from storage', error);
    }
  }

  private markEventAsDeadLetter(eventId: string | null | undefined, reason: string, context?: Record<string, unknown>): void {
    if (!eventId || this.deadLetterEventIds.has(eventId)) {
      return;
    }

    this.deadLetterEventIds.add(eventId);
    this.knownEventIds.add(eventId);
    this.persistDeadLetterList();

    this.logger.warn('Added DM event to dead-letter list', {
      eventId,
      reason,
      ...context,
    });
  }

  getDeadLetterCount(): number {
    return this.deadLetterEventIds.size;
  }

  async clearDeadLetterList(): Promise<void> {
    const eventIds = Array.from(this.deadLetterEventIds);

    this.deadLetterEventIds.clear();
    for (const eventId of eventIds) {
      this.knownEventIds.delete(eventId);
    }

    this.deadLetterPersistPromise = this.deadLetterPersistPromise
      .catch(() => undefined)
      .then(async () => {
        await this.database.init();
        await this.database.deleteInfoByKeyAndType(this.deadLetterInfoKey, this.deadLetterInfoType);
      })
      .catch(error => {
        this.logger.warn('Failed to clear DM dead-letter list', error);
      });

    await this.deadLetterPersistPromise;
    this.logger.info('Cleared DM dead-letter list');
  }

  clear() {
    this.chatsMap.set(new Map());
    this.oldestChatTimestamp.set(null);
    this.isLoading.set(false);
    this.isLoadingMoreChats.set(false);
    this.hasMoreChats.set(true);
    this.error.set(null);
    this.knownEventIds.clear();
    this.deadLetterEventIds.clear();
    this.deadLetterPersistPromise = Promise.resolve();
    this.bootstrapUnreadCount.set(null);
    this.bootstrappedPubkey = null;
  }

  /**
   * Clear loaded chat/message state for a local cache reset while preserving
   * the dead-letter list so previously deleted/spam event IDs remain skipped.
   */
  clearForResyncPreserveDeadLetter(): void {
    this.chatsMap.set(new Map());
    this.oldestChatTimestamp.set(null);
    this.isLoading.set(false);
    this.isLoadingMoreChats.set(false);
    this.hasMoreChats.set(true);
    this.error.set(null);
    this.knownEventIds.clear();
    for (const eventId of this.deadLetterEventIds) {
      this.knownEventIds.add(eventId);
    }
    this.bootstrapUnreadCount.set(null);
    this.bootstrappedPubkey = null;
  }

  reset() {
    this.chatsMap.set(new Map());
    this.oldestChatTimestamp.set(null);
    this.knownEventIds.clear();
    this.deadLetterEventIds.clear();
    this.deadLetterPersistPromise = Promise.resolve();
    this.bootstrapUnreadCount.set(null);
    this.bootstrappedPubkey = null;
  }

  hasLiveSubscription(): boolean {
    return !!this.liveSubscription;
  }

  /**
   * Cancel the DM startup delay and start the subscription immediately.
   * Called when the user navigates to the Messages page before the delay elapses.
   */
  requestImmediateDmStart(): void {
    if (this.dmStartupDelayResolve) {
      this.logger.info('[MessagingService] Cancelling DM startup delay — user navigated to Messages');
      this.dmStartupDelayResolve();
      this.dmStartupDelayResolve = null;
    }
  }

  private async bootstrapFromStorage(): Promise<void> {
    if (!this.accountState.canUseDirectMessages()) {
      this.bootstrapUnreadCount.set(null);
      this.bootstrappedPubkey = null;
      return;
    }

    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      return;
    }

    if (this.bootstrappedPubkey === myPubkey) {
      return;
    }

    // If another caller is already bootstrapping, wait for it to finish
    if (this.bootstrapPromise) {
      await this.bootstrapPromise;
      return;
    }

    this.bootstrapPromise = this.bootstrapFromStorageInternal(myPubkey);
    try {
      await this.bootstrapPromise;
    } finally {
      this.bootstrapPromise = null;
    }
  }

  private async bootstrapFromStorageInternal(myPubkey: string): Promise<void> {
    try {
      await this.database.init();
      await this.loadDeadLetterListFromStorage();

      const [storedChats, storedMessages] = await Promise.all([
        this.database.getChatsForAccount(myPubkey),
        this.database.getDirectMessagesForAccount(myPubkey),
      ]);

      let unreadCount = 0;
      for (const chat of storedChats) {
        unreadCount += chat.unreadCount;
      }

      for (const message of storedMessages) {
        this.knownEventIds.add(message.messageId);
        if (message.giftWrapId) {
          this.knownEventIds.add(message.giftWrapId);
        }
      }

      this.bootstrapUnreadCount.set(unreadCount);
      this.bootstrappedPubkey = myPubkey;

      this.logger.debug('Bootstrapped DM state from storage', {
        unreadCount,
        storedMessages: storedMessages.length,
        storedChats: storedChats.length,
        knownEventIdsSize: this.knownEventIds.size,
      });
    } catch (error) {
      this.logger.warn('Failed to bootstrap DM state from storage', error);
    }
  }

  async load() {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot load messages: no account pubkey');
      return;
    }

    this.logger.info('Loading messages from storage...');

    try {
      // Load messages from IndexedDB first for instant display
      await this.database.init();
      await this.loadDeadLetterListFromStorage();
      const storedChats = await this.database.getChatsForAccount(myPubkey);

      this.logger.info(`Found ${storedChats.length} stored chats`);

      // Track the oldest message timestamp from stored messages
      let oldestStoredTimestamp: number | null = null;

      // Build chat map from stored messages - group by pubkey to merge NIP-04 and NIP-44 chats
      // For group chats (chatId starts with 'group:'), use chatId directly without merging
      const chatsByKey = new Map<string, { messages: StoredDirectMessage[], unreadCount: number }>();

      for (const chatSummary of storedChats) {
        const messages = await this.database.getMessagesForChat(myPubkey, chatSummary.chatId);

        if (messages.length === 0) continue;

        // Group chats use their chatId directly (starts with 'group:')
        let chatKey: string;
        if (chatSummary.chatId.startsWith('group:')) {
          chatKey = chatSummary.chatId;
        } else if (chatSummary.chatId.endsWith('-nip04') || chatSummary.chatId.endsWith('-nip44')) {
          // Extract pubkey from legacy chatId format (pubkey-nip04 or pubkey-nip44)
          const parts = chatSummary.chatId.split('-');
          chatKey = parts.slice(0, -1).join('-');
        } else {
          chatKey = chatSummary.chatId;
        }

        // Validate chatKey - skip invalid chats
        if (!chatKey || chatKey === 'undefined' || (chatKey.length < 10 && !chatKey.startsWith('group:'))) {
          this.logger.warn('Skipping chat with invalid key', { chatId: chatSummary.chatId, chatKey });
          continue;
        }

        // Merge messages for the same key
        const existing = chatsByKey.get(chatKey);
        if (existing) {
          existing.messages.push(...messages);
          existing.unreadCount += chatSummary.unreadCount;
        } else {
          chatsByKey.set(chatKey, { messages: [...messages], unreadCount: chatSummary.unreadCount });
        }
      }

      // Now create chat objects from merged data
      for (const [chatKey, data] of chatsByKey.entries()) {
        const messagesMap = new Map<string, DirectMessage>();
        let lastMessage: DirectMessage | null = null;
        let hasLegacyMessages = false;

        for (const storedMsg of data.messages) {
          const dm: DirectMessage = {
            id: storedMsg.messageId,
            rumorKind: storedMsg.rumorKind,
            pubkey: storedMsg.pubkey,
            created_at: storedMsg.created_at,
            content: storedMsg.content,
            isOutgoing: storedMsg.isOutgoing,
            tags: storedMsg.tags,
            pending: storedMsg.pending,
            failed: storedMsg.failed,
            received: storedMsg.received,
            read: storedMsg.read,
            encryptionType: storedMsg.encryptionType,
            replyTo: this.getReplyToFromTags(storedMsg.tags || []),
            giftWrapId: storedMsg.giftWrapId,
          };

          const normalizedDm = this.normalizeMessage(dm);

          messagesMap.set(normalizedDm.id, normalizedDm);

          // Track known event IDs from storage so we can skip re-decryption
          if (normalizedDm.giftWrapId) {
            this.knownEventIds.add(normalizedDm.giftWrapId);
          }
          this.knownEventIds.add(normalizedDm.id);

          if (!lastMessage || normalizedDm.created_at > lastMessage.created_at) {
            lastMessage = normalizedDm;
          }

          // Track if chat has any legacy messages
          if (storedMsg.encryptionType === 'nip04') {
            hasLegacyMessages = true;
          }

          // Track the oldest message timestamp across all chats
          if (oldestStoredTimestamp === null || normalizedDm.created_at < oldestStoredTimestamp) {
            oldestStoredTimestamp = normalizedDm.created_at;
          }
        }

        // Detect if this is a group chat and extract participants
        const isGroup = chatKey.startsWith('group:');
        let participants: string[] | undefined;
        let chatPubkey: string;

        if (isGroup) {
          // Extract participant pubkeys from group chatId format: group:pk1,pk2,pk3
          participants = chatKey.substring('group:'.length).split(',');
          // For groups, pubkey is empty string (use participants instead)
          chatPubkey = '';
        } else {
          chatPubkey = chatKey;
        }

        // Check for subject from the most recent message's tags
        let subject: string | undefined;
        let subjectUpdatedAt: number | undefined;
        if (isGroup) {
          for (const storedMsg of data.messages) {
            const msgSubject = this.getSubjectFromTags(storedMsg.tags || []);
            if (msgSubject && (!subjectUpdatedAt || storedMsg.created_at > subjectUpdatedAt)) {
              subject = msgSubject;
              subjectUpdatedAt = storedMsg.created_at;
            }
          }
        }

        // Create the chat object
        const chat: Chat = {
          id: chatKey,
          pubkey: chatPubkey,
          unreadCount: data.unreadCount,
          lastMessage: lastMessage,
          encryptionType: 'nip44', // Default to modern encryption
          hasLegacyMessages: hasLegacyMessages,
          messages: messagesMap,
          isGroup,
          participants,
          subject,
          subjectUpdatedAt,
        };

        this.chatsMap.update(map => {
          const newMap = new Map(map);
          newMap.set(chatKey, chat);
          return newMap;
        });
      }

      // Set the oldest chat timestamp from stored messages so loadMoreChats uses correct starting point
      if (oldestStoredTimestamp !== null) {
        this.oldestChatTimestamp.set(oldestStoredTimestamp);
        this.logger.info(`Set oldest chat timestamp from storage: ${oldestStoredTimestamp} (${new Date(oldestStoredTimestamp * 1000).toISOString()})`);
      }

      this.logger.info(`Loaded ${storedChats.length} chats from storage`);
    } catch (error) {
      this.logger.error('Error loading messages from storage:', error);
    }
  }

  /**
   * Refresh chats to catch any messages that were missed while the page was closed.
   * This does an incremental sync from the last check timestamp.
   * Unlike loadChats(), this is faster as it only fetches new messages.
   */
  async refreshChats(): Promise<void> {
    const myPubkey = this.accountState.pubkey();

    if (!myPubkey) {
      this.logger.warn('Cannot refresh chats: no account pubkey');
      return;
    }

    // Don't refresh if already loading
    if (this.isLoading()) {
      this.logger.debug('Already loading chats, skipping refresh');
      return;
    }

    const lastCheck = this.accountLocalState.getMessagesLastCheck(myPubkey);

    if (!lastCheck) {
      // No last check timestamp, do a full load instead
      this.logger.debug('No lastCheck timestamp, doing full load');
      return this.loadChats();
    }

    // NIP-17 gift wraps have randomized timestamps up to 2 days (172800 seconds) in the past for privacy.
    // We need to use a buffer that accounts for this when refreshing.
    // Use the larger of: lastCheck - 3 days, or 0
    const NIP17_TIMESTAMP_BUFFER = 259200; // 3 days in seconds
    const since = Math.max(0, lastCheck - NIP17_TIMESTAMP_BUFFER);

    this.logger.info(`Refreshing messages since: ${new Date(since * 1000).toISOString()} (with NIP-17 3-day buffer)`);

    // Query both incoming messages (where we're tagged) AND outgoing (from us)
    // This catches messages sent from other devices logged into the same account
    const filterIncoming: Filter = {
      kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
      '#p': [myPubkey],
      since: since,
    };

    const filterOutgoing: Filter = {
      kinds: [kinds.EncryptedDirectMessage],
      authors: [myPubkey],
      since: since,
    };

    try {
      // Collect all relays to query
      // Include: DM relays and account relays only
      // Discovery/indexer relays are only for kind 10002/3 lookups, not for DM content
      const dmRelayUrls = await this.getDmRelayUrls(myPubkey);
      const accountRelays = this.relay.getRelayUrls();
      const allRelays = [...new Set([...dmRelayUrls, ...accountRelays])];

      this.logger.debug('refreshChats relay setup:', {
        dmRelayUrls,
        accountRelays,
        allRelays,
      });

      if (allRelays.length === 0) {
        this.logger.warn('No relays available for refresh');
        return;
      }

      // Query for incoming messages
      const incomingEvents = await this.pool.query(allRelays, filterIncoming, 15000);
      this.logger.info(`Found ${incomingEvents.length} incoming events during refresh`);

      for (const event of incomingEvents) {
        await this.processIncomingEvent(event, myPubkey);
      }

      // Query for outgoing NIP-04 messages (outgoing NIP-44 are already caught via #p tag)
      const outgoingEvents = await this.pool.query(accountRelays, filterOutgoing, 15000);
      this.logger.info(`Found ${outgoingEvents.length} outgoing NIP-04 events during refresh`);

      for (const event of outgoingEvents) {
        await this.processIncomingEvent(event, myPubkey);
      }

      // Update lastCheck timestamp
      const now = this.utilities.currentDate();
      this.accountLocalState.setMessagesLastCheck(myPubkey, now);

      this.logger.info('Chat refresh complete');
    } catch (err) {
      this.logger.error('Error refreshing chats:', err);
    }
  }

  /**
   * Process an incoming DM event (either GiftWrap or EncryptedDirectMessage)
   */
  private async processIncomingEvent(event: NostrEvent, myPubkey: string): Promise<void> {
    try {
      if (event.kind === kinds.GiftWrap) {
        // Check if this gift wrap has already been processed to avoid re-decryption
        if (this.shouldSkipDmEvent(event.id)) {
          this.logger.debug('Gift wrap already processed, skipping decryption (processIncomingEvent)', { eventId: event.id });
          return;
        }

        const unwrappedMessage = await this.unwrapMessageInternal(event);
        if (!unwrappedMessage) return;

        // Use resolveChatTarget to handle both 1-on-1 and group chats
        const target = resolveChatTarget(unwrappedMessage, myPubkey);
        if (!target) {
          this.markEventAsDeadLetter(event.id, 'No valid chat target (missing p-tags)', {
            innerEventId: unwrappedMessage.id,
          });
          return;
        }

        // Check if message already exists to prevent duplicates
        if (this.hasMessage(target.chatId, unwrappedMessage.id)) {
          this.logger.debug(`NIP-44 message ${unwrappedMessage.id} already exists, skipping`);
          return;
        }

        const directMessage: DirectMessage = {
          id: unwrappedMessage.id,
          rumorKind: unwrappedMessage.kind,
          pubkey: unwrappedMessage.pubkey,
          created_at: unwrappedMessage.created_at,
          content: unwrappedMessage.content,
          tags: unwrappedMessage.tags || [],
          isOutgoing: unwrappedMessage.pubkey === myPubkey,
          pending: false,
          failed: false,
          received: true,
          read: false,
          encryptionType: 'nip44',
          replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
          giftWrapId: event.id, // Store gift wrap ID to skip re-decryption later
        };

        const groupInfo = this.buildGroupInfo(target, unwrappedMessage.tags || [], unwrappedMessage.created_at);
        await this.addResolvedMessageToChat(target.chatId, directMessage, groupInfo);
      } else if (event.kind === kinds.EncryptedDirectMessage) {
        let targetPubkey = event.pubkey;

        if (targetPubkey === myPubkey) {
          const pTags = this.utilities.getPTagsValuesFromEvent(event);
          if (pTags.length > 0) {
            targetPubkey = pTags[0];
          } else {
            return;
          }
        }

        if (this.hasMessage(targetPubkey, event.id)) return;

        const unwrappedMessage = await this.unwrapNip04Message(event);
        if (!unwrappedMessage) return;

        const directMessage: DirectMessage = {
          id: unwrappedMessage.id,
          rumorKind: unwrappedMessage.kind,
          pubkey: unwrappedMessage.pubkey,
          created_at: unwrappedMessage.created_at,
          content: unwrappedMessage.content,
          tags: unwrappedMessage.tags || [],
          isOutgoing: event.pubkey === myPubkey,
          pending: false,
          failed: false,
          received: true,
          read: false,
          encryptionType: 'nip04',
          replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
        };

        await this.addResolvedMessageToChat(targetPubkey, directMessage);
      }
    } catch (err) {
      this.logger.error('Error processing incoming event:', err);
    }
  }

  async loadChats() {
    // Don't clear if we're doing an incremental sync
    // Only clear if this is a fresh load (no stored messages)
    const myPubkey = this.accountState.pubkey();

    if (!myPubkey) {
      this.error.set('You need to be logged in to view messages');
      this.isLoading.set(false);
      return;
    }

    // Check if we have any stored messages
    const lastCheck = this.accountLocalState.getMessagesLastCheck(myPubkey);
    const isIncrementalSync = lastCheck && lastCheck > 0;

    if (!isIncrementalSync) {
      // First time load - clear everything
      this.clear();
    }

    this.isLoading.set(true);

    try {
      // Load messages from storage first
      await this.load();

      // For extension users, we'll let the individual decryption requests handle permission
      // Don't block chat loading - just log the info
      if (this.encryptionPermission.needsPermission()) {
        this.logger.info('Extension user - decryption requests will be queued for permission');
      }

      // Get the last check timestamp to only fetch new messages.
      // NIP-17 gift wraps have randomized outer timestamps up to 2 days (172800s) in the past
      // for privacy. When doing an incremental sync we must look further back to catch
      // messages whose outer (relay-indexed) timestamp falls before lastCheck even though
      // the real inner message was created recently.
      const NIP17_TIMESTAMP_BUFFER = 259200; // 3 days in seconds (same buffer used in refreshChats/subscribeToIncomingMessages)
      const since = lastCheck ? Math.max(0, lastCheck - NIP17_TIMESTAMP_BUFFER) : undefined;

      this.logger.info(`Loading messages since: ${since ? new Date(since * 1000).toISOString() : 'beginning'} (incremental: ${isIncrementalSync}, lastCheck: ${lastCheck ? new Date(lastCheck * 1000).toISOString() : 'none'})`);

      // This contains both incoming and outgoing messages for Giftwrapped messages.
      const filterReceived: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        '#p': [myPubkey],
        limit: this.MESSAGE_SIZE,
        since: since,
      };

      const filterSent: Filter = {
        kinds: [kinds.EncryptedDirectMessage],
        authors: [myPubkey],
        limit: this.MESSAGE_SIZE,
        since: since, // Add since filter to outgoing messages too
      };

      // Store pubkeys of people who've messaged us
      // const chatPubkeys = new Set<string>();
      let oldestTimestamp = this.oldestChatTimestamp() || this.utilities.currentDate();

      // ── Independent dual-subscription pipeline ───────────────────────
      // sub1 (filterReceived) captures ALL NIP-17 messages (incoming +
      // outgoing self-copies) plus incoming NIP-04.  Its EOSE fires fast
      // and we process immediately — no waiting.
      // sub2 (filterSent) captures only NIP-04 *sent* messages.  When its
      // EOSE fires we process those as a supplemental batch, adding any
      // messages not already rendered by sub1.
      const sub1Events: NostrEvent[] = [];
      const sub2Events: NostrEvent[] = [];

      const pendingDecryptions: Promise<void>[] = [];

      /**
       * Process a batch of collected events: sort newest-first, decrypt,
       * and add to chats.  Shared by both EOSE handlers.
       */
      const processEventBatch = async (events: NostrEvent[], label: string) => {
        this.logger.info(`${label}: Processing ${events.length} events (newest-first)...`);

        // Sort newest-first so recent chats are decrypted & rendered before old ones
        events.sort((a, b) => b.created_at - a.created_at);

        for (const event of events) {
          if (event.kind === kinds.GiftWrap) {
            const processPromise = (async () => {
              try {
                if (this.shouldSkipDmEvent(event.id)) {
                  this.logger.debug('Gift wrap already processed, skipping decryption', { eventId: event.id });
                  return;
                }

                const wrappedevent = await this.unwrapMessageInternal(event);

                if (!wrappedevent) {
                  this.logger.debug('Failed to unwrap gift-wrapped message', { eventId: event.id });
                  return;
                }

                const directMessage: DirectMessage = {
                  id: wrappedevent.id,
                  pubkey: wrappedevent.pubkey,
                  created_at: wrappedevent.created_at,
                  content: wrappedevent.content,
                  tags: wrappedevent.tags || [],
                  isOutgoing: wrappedevent.pubkey === myPubkey,
                  pending: false,
                  failed: false,
                  received: true,
                  read: false,
                  encryptionType: 'nip44',
                  replyTo: this.getReplyToFromTags(wrappedevent.tags || []),
                  giftWrapId: event.id,
                };

                // Use resolveChatTarget for both 1-on-1 and group chats
                const target = resolveChatTarget(wrappedevent, myPubkey);
                if (!target) {
                  this.markEventAsDeadLetter(event.id, 'No valid chat target (missing p-tags)', {
                    innerEventId: wrappedevent.id,
                  });
                  return;
                }

                const groupInfo = this.buildGroupInfo(target, wrappedevent.tags || [], wrappedevent.created_at);
                await this.addResolvedMessageToChat(target.chatId, directMessage, groupInfo);
              } catch (err) {
                this.logger.error('Error processing GiftWrap event:', err);
              }
            })();
            pendingDecryptions.push(processPromise);
          } else if (event.kind === kinds.EncryptedDirectMessage) {
            let targetPubkey = event.pubkey;

            if (targetPubkey === myPubkey) {
              const pTags = this.utilities.getPTagsValuesFromEvent(event);
              if (pTags.length > 0) {
                targetPubkey = pTags[0];
              } else {
                this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
                continue;
              }
            }

            if (this.hasMessage(targetPubkey, event.id)) {
              continue;
            }

            const nip04Promise = (async () => {
              try {
                const unwrappedMessage = await this.unwrapNip04Message(event);

                if (!unwrappedMessage) {
                  this.logger.warn('Failed to unwrap NIP-04 message', event);
                  return;
                }

                const directMessage: DirectMessage = {
                  id: unwrappedMessage.id,
                  pubkey: unwrappedMessage.pubkey,
                  created_at: unwrappedMessage.created_at,
                  content: unwrappedMessage.content,
                  tags: unwrappedMessage.tags || [],
                  isOutgoing: event.pubkey === myPubkey,
                  pending: false,
                  failed: false,
                  received: true,
                  read: false,
                  encryptionType: 'nip04',
                  replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
                };

                await this.addResolvedMessageToChat(targetPubkey, directMessage);
              } catch (err) {
                this.logger.error('Error processing NIP-04 event:', err);
              }
            })();
            pendingDecryptions.push(nip04Promise);
          }
        }
      };

      // Track whether sub1 has finished so we can finalize once both are done
      let sub1Done = false;
      let sub2Done = false;

      const finalizeIfBothDone = async () => {
        if (!sub1Done || !sub2Done) return;

        // Wait for all pending decryption operations to complete
        this.logger.info(`Waiting for ${pendingDecryptions.length} pending decryption operations...`);
        await Promise.all(pendingDecryptions);
        this.logger.info('All decryption operations complete');

        // Update the oldest timestamp for loading more chats
        this.oldestChatTimestamp.set(oldestTimestamp);

        // Update the last check timestamp only if we have some chats loaded
        const hasChats = this.chatsMap().size > 0;
        if (!isIncrementalSync || hasChats) {
          const now = this.utilities.currentDate();
          this.accountLocalState.setMessagesLastCheck(myPubkey, now);
        }

        this.isLoading.set(false);
      };

      // ── Event collectors ─────────────────────────────────────────────
      const collectSub1Event = (event: NostrEvent) => {
        if (event.created_at < oldestTimestamp) {
          oldestTimestamp = event.created_at;
        }
        sub1Events.push(event);
      };

      const collectSub2Event = (event: NostrEvent) => {
        if (event.created_at < oldestTimestamp) {
          oldestTimestamp = event.created_at;
        }
        sub2Events.push(event);
      };

      // sub1: incoming NIP-17 (both directions) + incoming NIP-04
      // Processes immediately on EOSE — no waiting for sub2
      const sub1 = this.relay.subscribe(
        filterReceived,
        collectSub1Event,
        async () => {
          this.logger.debug(`sub1 EOSE: ${sub1Events.length} events (NIP-17 + received NIP-04)`);
          await processEventBatch(sub1Events, 'sub1');
          sub1Done = true;
          await finalizeIfBothDone();
        }
      );

      // sub2: sent NIP-04 messages (supplemental batch)
      const sub2 = this.relay.subscribe(
        filterSent,
        collectSub2Event,
        async () => {
          this.logger.debug(`sub2 EOSE: ${sub2Events.length} events (sent NIP-04)`);
          await processEventBatch(sub2Events, 'sub2');
          sub2Done = true;
          await finalizeIfBothDone();
        }
      );

      // Also query DM relays (kind 10050) for messages that may have been sent to those relays
      // This ensures we fetch messages from both account relays and DM-specific relays
      // Note: This runs in parallel with the account relay subscriptions
      await this.queryDmRelaysForMessages(myPubkey, filterReceived);

      // Convert to array of Chat objects
    } catch (err) {
      this.logger.error('Failed to load chats', err);
      this.error.set('Failed to load chats. Please try again.');
      this.isLoading.set(false);
    }
  }

  /**
   * Query DM relays (from kind 10050) and discovery relays for messages.
   * This supplements the main subscription by also checking DM-specific and discovery relays.
   */
  private async queryDmRelaysForMessages(myPubkey: string, filter: Filter): Promise<void> {
    try {
      // Get DM relay URLs from kind 10050
      const dmRelayEvent = await this.database.getEventByPubkeyAndKind(myPubkey, kinds.DirectMessageRelaysList);

      const dmRelayUrls = dmRelayEvent?.tags
        .filter(t => t[0] === 'relay' && t[1])
        .map(t => t[1]) || [];

      // DM relays only — discovery/indexer relays are not for DM content
      const allAdditionalRelays = [...new Set([...dmRelayUrls])];

      if (allAdditionalRelays.length === 0) {
        this.logger.debug('No additional relays (DM or discovery) to query');
        return;
      }

      // Check which relays are different from account relays
      const accountRelays = new Set(this.relay.getRelayUrls());
      const uniqueRelays = allAdditionalRelays.filter(url => !accountRelays.has(url));

      if (uniqueRelays.length === 0) {
        this.logger.debug('All additional relays are same as account relays, skipping duplicate query');
        return;
      }

      this.logger.info('Querying additional relays (DM + discovery) for messages', {
        relayCount: uniqueRelays.length,
        relays: uniqueRelays,
      });

      // Query all additional relays for messages
      const events = await this.pool.query(uniqueRelays, filter, 10000);

      this.logger.info(`Found ${events.length} events from additional relays`);

      // Sort newest-first so recent chats are processed before old ones
      events.sort((a, b) => b.created_at - a.created_at);

      // Process each event
      for (const event of events) {
        try {
          if (event.kind === kinds.GiftWrap) {
            // Check if this gift wrap has already been processed to avoid re-decryption
            if (this.shouldSkipDmEvent(event.id)) {
              this.logger.debug('Gift wrap already processed, skipping decryption (queryDmRelays)', { eventId: event.id });
              continue;
            }

            const unwrappedMessage = await this.unwrapMessageInternal(event);
            if (!unwrappedMessage) continue;

            // Use resolveChatTarget for both 1-on-1 and group chats
            const target = resolveChatTarget(unwrappedMessage, myPubkey);
            if (!target) {
              this.markEventAsDeadLetter(event.id, 'No valid chat target (missing p-tags)', {
                innerEventId: unwrappedMessage.id,
              });
              continue;
            }

            const directMessage: DirectMessage = {
              id: unwrappedMessage.id,
              pubkey: unwrappedMessage.pubkey,
              created_at: unwrappedMessage.created_at,
              content: unwrappedMessage.content,
              tags: unwrappedMessage.tags || [],
              isOutgoing: unwrappedMessage.pubkey === myPubkey,
              pending: false,
              failed: false,
              received: true,
              read: false,
              encryptionType: 'nip44',
              replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
              giftWrapId: event.id, // Store gift wrap ID to skip re-decryption later
            };

            const groupInfo = this.buildGroupInfo(target, unwrappedMessage.tags || [], unwrappedMessage.created_at);
            await this.addResolvedMessageToChat(target.chatId, directMessage, groupInfo);
          } else if (event.kind === kinds.EncryptedDirectMessage) {
            let targetPubkey = event.pubkey;

            if (targetPubkey === myPubkey) {
              const pTags = this.utilities.getPTagsValuesFromEvent(event);
              if (pTags.length > 0) {
                targetPubkey = pTags[0];
              } else {
                continue;
              }
            }

            if (this.hasMessage(targetPubkey, event.id)) continue;

            const unwrappedMessage = await this.unwrapNip04Message(event);
            if (!unwrappedMessage) continue;

            const directMessage: DirectMessage = {
              id: unwrappedMessage.id,
              pubkey: unwrappedMessage.pubkey,
              created_at: unwrappedMessage.created_at,
              content: unwrappedMessage.content,
              tags: unwrappedMessage.tags || [],
              isOutgoing: event.pubkey === myPubkey,
              pending: false,
              failed: false,
              received: true,
              read: false,
              encryptionType: 'nip04',
              replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
            };

            await this.addResolvedMessageToChat(targetPubkey, directMessage);
          }
        } catch (err) {
          this.logger.error('Error processing event from additional relay:', err);
        }
      }
    } catch (err) {
      this.logger.error('Error querying additional relays for messages:', err);
    }
  }

  // Store active live subscription reference for cleanup
  private liveSubscription: { close: () => void } | null = null;

  /**
   * Get the relay URLs to use for DM subscriptions.
   * First tries to get DM relays from kind 10050 (NIP-17),
   * falls back to account relays if no DM relays are configured.
   */
  private async getDmRelayUrls(pubkey: string): Promise<string[]> {
    const relayUrls = new Set<string>();

    // Try to get DM relay list (kind 10050) from local storage first.
    // For the current account, the account metadata subscription (subscribeToAccountMetadata)
    // already fetches and caches kind 10050, so the database should have the latest data.
    const dmRelayEvent = await this.database.getEventByPubkeyAndKind(pubkey, kinds.DirectMessageRelaysList);

    if (dmRelayEvent) {
      const storedDmRelayUrls = this.utilities.normalizeRelayUrls(
        dmRelayEvent.tags
          .filter(t => t[0] === 'relay' && t[1])
          .map(t => t[1]),
        false,
        {
          source: 'account-relays',
          ownerPubkey: pubkey,
          eventKind: kinds.DirectMessageRelaysList,
          details: 'cached DM relays for live subscription',
        }
      );

      storedDmRelayUrls.forEach(url => relayUrls.add(url));

      if (storedDmRelayUrls.length > 0) {
        this.logger.info('Loaded cached DM relays from kind 10050', {
          count: storedDmRelayUrls.length,
          relays: storedDmRelayUrls,
        });
      }
    }

    // Only query discovery relays for DM relay list if we don't have cached data.
    // For the current account, the account metadata subscription already fetches kind 10050
    // and saves it to the database, so an extra discovery query would be redundant.
    if (relayUrls.size === 0) {
      try {
        const discoveredDmRelayUrls = await this.discoveryRelay.getUserDmRelayUrls(pubkey);
        discoveredDmRelayUrls.forEach(url => relayUrls.add(url));

        if (discoveredDmRelayUrls.length > 0) {
          this.logger.info('Loaded DM relays from discovery for live subscription', {
            count: discoveredDmRelayUrls.length,
            relays: discoveredDmRelayUrls,
          });
        }
      } catch (error) {
        this.logger.warn('Failed to refresh DM relays from discovery, continuing with cached/account relays', error);
      }
    }

    const accountRelays = this.relay.getRelayUrls();
    accountRelays.forEach(url => relayUrls.add(url));

    const combinedRelays = Array.from(relayUrls);

    if (combinedRelays.length === 0) {
      this.logger.info('No DM relays found, using account relays', { count: accountRelays.length });
      return accountRelays;
    }

    this.logger.info('Using combined DM relay set for subscription', {
      count: combinedRelays.length,
      relays: combinedRelays,
    });

    return combinedRelays;
  }

  /**
   * Subscribe to real-time incoming direct messages.
   * Opens a persistent subscription that stays open until explicitly closed.
   * This is automatically called when the user logs in and closed when they log out.
   * Uses DM relays (kind 10050) if available, falls back to account relays.
   * @returns A subscription object with a close() method for cleanup
   */
  async subscribeToIncomingMessages(): Promise<{ close: () => void } | null> {
    if (!this.accountState.canUseDirectMessages()) {
      this.logger.info('Cannot subscribe to messages: account cannot sign/decrypt');
      return null;
    }

    const myPubkey = this.accountState.pubkey();

    if (!myPubkey) {
      this.logger.warn('Cannot subscribe to messages: no account pubkey');
      return null;
    }

    // Ensure known event IDs are loaded from storage before opening relay subscriptions.
    // Without this, events from the 3-day lookback window arrive before knownEventIds is populated,
    // causing unnecessary NIP-44 decryption prompts for already-stored messages.
    await this.bootstrapFromStorage();

    // Close any existing live subscription before creating a new one
    if (this.liveSubscription) {
      this.logger.info('Closing existing live message subscription');
      this.liveSubscription.close();
      this.liveSubscription = null;
    }

    // Get all relay URLs (combine DM relays and account relays)
    // Discovery/indexer relays are only for kind 10002/3 lookups, not for DM content
    const dmRelayUrls = await this.getDmRelayUrls(myPubkey);
    const accountRelays = this.relay.getRelayUrls();
    const allRelays = [...new Set([...dmRelayUrls, ...accountRelays])];

    this.logger.debug('subscribeToIncomingMessages relay setup:', {
      dmRelayUrls,
      accountRelays,
      allRelays,
    });

    if (allRelays.length === 0) {
      this.logger.warn('Cannot subscribe to messages: no relays available');
      return null;
    }

    // NIP-17 gift wraps have randomized timestamps up to 2 days (172800 seconds) in the past for privacy.
    // We need to use a buffer that accounts for this, plus some extra margin.
    // Using 3 days (259200 seconds) to be safe.
    const NIP17_TIMESTAMP_BUFFER = 259200; // 3 days in seconds
    const since = this.utilities.currentDate() - NIP17_TIMESTAMP_BUFFER;

    // Filter for messages where we're tagged (incoming NIP-04/NIP-44, and our own outgoing NIP-44)
    const filterTagged: Filter = {
      kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
      '#p': [myPubkey],
      since: since,
    };

    // Filter for outgoing NIP-04 messages (authored by us)
    const filterAuthored: Filter = {
      kinds: [kinds.EncryptedDirectMessage],
      authors: [myPubkey],
      since: since,
    };

    this.logger.debug('subscribeToIncomingMessages filters:', {
      filterTagged,
      filterAuthored,
      sinceDate: new Date(since * 1000).toISOString(),
      bufferDays: NIP17_TIMESTAMP_BUFFER / 86400,
    });

    this.logger.info('Opening live subscription for DMs', {
      since: new Date(since * 1000).toISOString(),
      relayCount: allRelays.length,
      relays: allRelays,
    });

    // Track processed event IDs to avoid duplicates
    // Uses the service-level knownEventIds for cross-call dedup

    const processEvent = async (event: NostrEvent) => {
      // Skip if already processed (across all code paths, not just this batch)
      if (this.shouldSkipDmEvent(event.id)) {
        return;
      }

      this.logger.debug('Received real-time DM event', { kind: event.kind, id: event.id });

      try {
        if (event.kind === kinds.GiftWrap) {
          // Handle NIP-44 gift-wrapped message
          const unwrappedMessage = await this.unwrapMessageInternal(event);
          if (!unwrappedMessage) {
            this.logger.warn('Live subscription: Failed to unwrap gift-wrapped message', { eventId: event.id });
            return;
          }

          // Determine the chat target (1-on-1 or group)
          const target = resolveChatTarget(unwrappedMessage, myPubkey);
          if (!target) {
            this.markEventAsDeadLetter(event.id, 'No valid chat target (missing p-tags)', {
              innerEventId: unwrappedMessage.id,
            });
            return;
          }

          this.logger.info('Live subscription: Successfully unwrapped NIP-44 message', {
            eventId: event.id,
            chatId: target.chatId.slice(0, 24) + '...',
            isOutgoing: unwrappedMessage.pubkey === myPubkey,
            isGroup: target.isGroup,
          });

          const directMessage: DirectMessage = {
            id: unwrappedMessage.id,
            pubkey: unwrappedMessage.pubkey,
            created_at: unwrappedMessage.created_at,
            content: unwrappedMessage.content,
            tags: unwrappedMessage.tags || [],
            isOutgoing: unwrappedMessage.pubkey === myPubkey,
            pending: false,
            failed: false,
            received: true,
            read: false,
            encryptionType: 'nip44',
            replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
            giftWrapId: event.id, // Store gift wrap ID to skip re-decryption later
          };

          const groupInfo = this.buildGroupInfo(target, unwrappedMessage.tags || [], unwrappedMessage.created_at);
          this.addMessageToChat(target.chatId, directMessage, groupInfo);
        } else if (event.kind === kinds.EncryptedDirectMessage) {
          // Handle NIP-04 legacy encrypted message
          const unwrappedMessage = await this.unwrapNip04MessageInternal(event);
          if (!unwrappedMessage) {
            this.logger.warn('Live subscription: Failed to unwrap NIP-04 message', { eventId: event.id });
            return;
          }

          // For NIP-04, determine chat partner
          let targetPubkey: string;
          if (event.pubkey === myPubkey) {
            // Outgoing - get recipient from p tag
            const pTags = this.utilities.getPTagsValuesFromEvent(event);
            targetPubkey = pTags[0];
          } else {
            // Incoming - sender is pubkey
            targetPubkey = event.pubkey;
          }

          if (!targetPubkey || targetPubkey === 'undefined') {
            this.logger.warn('Live subscription: Could not determine target pubkey from NIP-04 message');
            return;
          }

          this.logger.info('Live subscription: Successfully unwrapped NIP-04 message', {
            eventId: event.id,
            targetPubkey: targetPubkey.slice(0, 16) + '...',
            isOutgoing: event.pubkey === myPubkey,
          });

          const directMessage: DirectMessage = {
            id: unwrappedMessage.id,
            pubkey: unwrappedMessage.pubkey,
            created_at: unwrappedMessage.created_at,
            content: unwrappedMessage.content,
            tags: unwrappedMessage.tags || [],
            isOutgoing: event.pubkey === myPubkey,
            pending: false,
            failed: false,
            received: true,
            read: false,
            encryptionType: 'nip04',
            replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
          };

          this.addMessageToChat(targetPubkey, directMessage);
        }
      } catch (err) {
        this.logger.error('Error processing real-time DM event:', err);
      }
    };

    // Subscribe to messages where we're tagged (incoming + our outgoing NIP-44)
    const sub1 = this.pool.subscribe(allRelays, filterTagged, processEvent);

    // Subscribe to our outgoing NIP-04 messages
    const sub2 = this.pool.subscribe(accountRelays, filterAuthored, processEvent);

    // Create combined subscription object
    const combinedSub = {
      close: () => {
        this.logger.info('Closing live message subscriptions');
        sub1.close();
        sub2.close();
      },
    };

    this.liveSubscription = combinedSub;
    return combinedSub;
  }

  /**
   * Close the live incoming messages subscription.
   * Call this when leaving the Messages page.
   */
  closeLiveSubscription(): void {
    if (this.liveSubscription) {
      this.logger.info('Closing live message subscription');
      this.liveSubscription.close();
      this.liveSubscription = null;
    }
  }

  /**
   * Unwrap and decrypt a NIP-04 direct message
   */
  async unwrapNip04Message(event: NostrEvent): Promise<any | null> {
    return await this.unwrapNip04MessageInternal(event);
  }

  /**
   * Internal unwrap and decrypt a NIP-04 direct message
   */
  private async unwrapNip04MessageInternal(event: NostrEvent): Promise<any | null> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return null;

    // Skip decryption for accounts that cannot decrypt (e.g. preview).
    // Prevents logging an error for every NIP-04 message when we already know we can't read them.
    if (!this.accountState.canDecrypt()) {
      return null;
    }

    try {
      // For NIP-04 messages, the sender is the event pubkey
      const tags = this.utilities.getPTagsValuesFromEvent(event);

      if (tags.length === 0) {
        this.markEventAsDeadLetter(event.id, 'NIP-04 message missing recipient p-tag');
        return null;
      } else if (tags.length > 1) {
        // NIP-04 only supports one recipient, yet some clients have sent DMs with more. Ignore those.
        this.logger.warn('NIP-04 message has multiple recipients, ignoring.', event);
        this.markEventAsDeadLetter(event.id, 'NIP-04 message has multiple recipients');
        return null;
      }

      // If we are the sender, get the pubkey from 'p' tag.
      // If we are the receiver, use the event pubkey.
      let decryptionPubkey = event.pubkey;

      if (decryptionPubkey === myPubkey) {
        if (tags.length > 0) {
          decryptionPubkey = tags[0]; // Use the first 'p' tag as the recipient
        }
      }

      // Use the EncryptionService to decrypt
      const decryptionResult = await this.encryption.autoDecrypt(
        event.content,
        decryptionPubkey,
        event,
        event.created_at
      );

      // Return the message with decrypted content
      return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        content: decryptionResult.content,
        tags: event.tags,
      };
    } catch (err) {
      if (this.isPermanentDecryptFailure(err)) {
        this.markEventAsDeadLetter(event.id, this.getDecryptFailureReason(err), {
          encryptionType: 'nip04',
        });
        this.logger.warn('Failed to decrypt NIP-04 message permanently; moving to dead-letter list', err);
        return null;
      }

      this.logger.error('Failed to decrypt NIP-04 message', err);
      return null;
    }
  }

  /**
   * Internal unwrap and decrypt a gift-wrapped message (direct processing)
   */
  private async unwrapMessageInternal(wrappedEvent: any): Promise<any | null> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return null;

    // Skip gift-wrap decryption for accounts that cannot decrypt (e.g. preview).
    if (!this.accountState.canDecrypt()) {
      return null;
    }

    if (!wrappedEvent?.id) {
      return null;
    }

    // Cross-path dedup: skip immediately when we already handled this outer event.
    if (this.shouldSkipDmEvent(wrappedEvent.id)) {
      return null;
    }

    // In-flight dedup: avoid multiple concurrent decrypts of the same gift wrap.
    if (this.inFlightGiftWrapIds.has(wrappedEvent.id)) {
      return null;
    }

    this.inFlightGiftWrapIds.add(wrappedEvent.id);
    let shouldRememberWrappedEvent = false;

    try {
      // Check if this message is for us
      const recipient = wrappedEvent.tags.find((t: string[]) => t[0] === 'p')?.[1];
      if (recipient !== myPubkey && wrappedEvent.pubkey !== myPubkey) {
        return null;
      }

      // The "wrappedEvent.pubkey" is a random pubkey used to wrap the message. We must use recipient pubkey to decrypt the wrapped content.
      // const wrappedPubkey = recipient;
      // const wrappedPubkey = wrappedEvent.pubkey;

      // First decrypt the wrapped content using the EncryptionService
      // This will handle both browser extension and direct decryption
      let wrappedContent: any;
      try {
        const decryptionResult = await this.encryption.autoDecrypt(
          wrappedEvent.content,
          wrappedEvent.pubkey,
          wrappedEvent,
          wrappedEvent.created_at
        );
        wrappedContent = JSON.parse(decryptionResult.content);
      } catch (err) {
        // Dead-letter any decrypt failure that isn't clearly transient (e.g.
        // extension unavailable, user cancelled, timeout). This prevents
        // repeatedly prompting the user to decrypt spam/corrupted events.
        if (!this.isTransientDecryptFailure(err)) {
          this.markEventAsDeadLetter(wrappedEvent.id, this.getDecryptFailureReason(err), {
            encryptionType: 'nip44',
            stage: 'wrapped-content',
          });
        }
        this.logger.debug('Failed to decrypt wrapped content', { eventId: wrappedEvent.id });
        return null;
      }

      // Root/sealed event ID is stable for this wrapped payload. If we already know it
      // from cache or previous processing, skip the second decrypt stage entirely.
      const rootWrappedEventId = typeof wrappedContent?.id === 'string' ? wrappedContent.id : null;
      if (rootWrappedEventId && this.shouldSkipDmEvent(rootWrappedEventId)) {
        this.knownEventIds.add(wrappedEvent.id);
        shouldRememberWrappedEvent = true;
        this.logger.debug('Skipping NIP-44 unwrap: root wrapped event already known', {
          giftWrapId: wrappedEvent.id,
          rootWrappedEventId,
        });
        return null;
      }

      // Get the sealed message
      let sealedEvent;
      if (wrappedEvent.pubkey === myPubkey) {
        // This will never happen for NIP-44?
        // If we sent it, we can directly use the encryptedMessage
        sealedEvent = wrappedContent.encryptedMessage;
      } else {
        // Decrypt the sealed content using the EncryptionService
        try {
          sealedEvent = await this.unwrapSealedContent(wrappedContent, wrappedEvent);
        } catch (err) {
          if (!this.isTransientDecryptFailure(err)) {
            this.markEventAsDeadLetter(wrappedEvent.id, this.getDecryptFailureReason(err), {
              encryptionType: 'nip44',
              stage: 'sealed-content',
              rootWrappedEventId,
            });
          }
          this.logger.warn('Failed to decrypt sealed content', {
            error: err,
            giftWrapId: wrappedEvent.id,
            wrappedKind: wrappedContent?.kind,
          });
          return null;
        }
      }

      if (wrappedContent.pubkey !== sealedEvent.pubkey) {
        const pubkeyMismatchError = new Error('Decrypted message pubkey does not match wrapped content pubkey');
        this.markEventAsDeadLetter(wrappedEvent.id, pubkeyMismatchError.message, {
          encryptionType: 'nip44',
          stage: 'pubkey-validation',
          rootWrappedEventId,
        });
        return null;
      }

      if (rootWrappedEventId) {
        this.knownEventIds.add(rootWrappedEventId);
      }

      shouldRememberWrappedEvent = true;

      // Return the final decrypted message
      return {
        ...sealedEvent,
      };
    } catch (err) {
      if (this.isPermanentDecryptFailure(err, { allowGenericDecryptFailure: true })) {
        this.markEventAsDeadLetter(wrappedEvent.id, this.getDecryptFailureReason(err), {
          encryptionType: 'nip44',
          stage: 'unwrap',
        });
        this.logger.warn('Failed to unwrap message permanently; moving to dead-letter list', err);
        return null;
      }

      this.logger.error('Failed to unwrap message', err);
      throw err;
    } finally {
      this.inFlightGiftWrapIds.delete(wrappedEvent.id);
      if (shouldRememberWrappedEvent) {
        this.knownEventIds.add(wrappedEvent.id);
      }
    }
  }

  private async unwrapSealedContent(wrappedContent: any, wrappedEvent: NostrEvent): Promise<any> {
    if (!wrappedContent || typeof wrappedContent !== 'object') {
      throw new Error('Wrapped content is not a valid object');
    }

    if (!this.encryption.isContentEncrypted(wrappedContent.content)) {
      throw new Error('Content does not appear to be encrypted');
    }

    const sealedDecryptionResult = await this.encryption.autoDecrypt(
      wrappedContent.content,
      wrappedContent.pubkey,
      wrappedEvent,
      wrappedEvent.created_at
    );

    return JSON.parse(sealedDecryptionResult.content);
  }

  /**
   * Load more (older) messages for a specific chat.
   *
   * Always computes the query window from the oldest message currently in the chat,
   * going back at least 2 days further to account for NIP-17 gift wrap timestamp
   * randomization (up to 2 days offset). Queries DM relays (kind 10050), account
   * relays, and discovery relays so gift-wrapped messages are not missed.
   */
  async loadMoreMessages(chatId: string, beforeTimestamp?: number): Promise<DirectMessage[]> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      throw new Error('User not authenticated');
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      throw new Error('Chat not found');
    }

    // Always compute "until" from the oldest message currently visible in the chat.
    // This ensures each "scroll up" request moves the window backwards correctly
    // regardless of any stored timestamp state.
    const currentMessages = this.getChatMessages(chatId);
    let oldestInnerTimestamp: number;
    if (currentMessages.length === 0) {
      oldestInnerTimestamp = this.utilities.currentDate();
    } else {
      oldestInnerTimestamp = Math.min(...currentMessages.map(m => m.created_at));
    }

    // NIP-17 gift wraps use randomized outer timestamps up to 2 days (172800s) in the past.
    // The inner (decrypted) message timestamp is the real one, but relays index by the
    // outer timestamp. To find older messages we need to look further back.
    const NIP17_TIMESTAMP_BUFFER = 172800; // 2 days in seconds
    const until = oldestInnerTimestamp + NIP17_TIMESTAMP_BUFFER; // outer timestamp could be up to 2 days after inner
    const since = oldestInnerTimestamp - NIP17_TIMESTAMP_BUFFER; // also look 2 days before the oldest inner

    // Query both NIP-04 and NIP-44 messages for merged chats
    const messageKinds = [kinds.EncryptedDirectMessage, kinds.GiftWrap];

    this.logger.debug(
      `Loading more messages for chat ${chatId}, oldest inner: ${oldestInnerTimestamp} (${new Date(oldestInnerTimestamp * 1000).toISOString()}), ` +
      `query window: since=${new Date(since * 1000).toISOString()} until=${new Date(until * 1000).toISOString()}`
    );

    // Build combined relay list: DM relays (kind 10050) + account relays
    // Discovery/indexer relays are only for kind 10002/3 lookups, not for DM content
    const dmRelayUrls = await this.getDmRelayUrls(myPubkey);
    const accountRelays = this.relay.getRelayUrls();
    const allRelays = [...new Set([...dmRelayUrls, ...accountRelays])];

    // Create filters — use `since` to narrow the window and avoid pulling everything
    const filterReceived: Filter = {
      kinds: messageKinds,
      '#p': [myPubkey],
      since: since,
      until: until,
      limit: this.MESSAGE_SIZE,
    };

    const filterSent: Filter = {
      kinds: messageKinds,
      authors: [myPubkey],
      since: since,
      until: until,
      limit: this.MESSAGE_SIZE,
    };

    const loadedMessages: DirectMessage[] = [];

    // Track outer event IDs we've already seen in this batch to prevent
    // the same event arriving from multiple relays being processed twice.
    // Uses service-level knownEventIds for cross-call dedup.

    const processEvent = async (event: NostrEvent) => {
      try {
        // Dedup: skip if we already processed this outer event in this or any previous batch
        if (this.shouldSkipDmEvent(event.id)) {
          return;
        }
        this.knownEventIds.add(event.id);

        if (event.kind === kinds.GiftWrap) {
          // --- NIP-44 (Gift Wrap) ---

          const unwrappedMessage = await this.unwrapMessageInternal(event);
          if (!unwrappedMessage) return;

          // For NIP-44, isOutgoing is determined from the INNER message pubkey
          const isOutgoing = unwrappedMessage.pubkey === myPubkey;

          // Use resolveChatTarget to determine the correct chat
          const target = resolveChatTarget(unwrappedMessage, myPubkey);
          if (!target) {
            this.markEventAsDeadLetter(event.id, 'No valid chat target (missing p-tags)', {
              innerEventId: unwrappedMessage.id,
            });
            return;
          }

          // Only process messages belonging to THIS chat
          if (target.chatId !== chatId) {
            return;
          }

          // Check if we already have this inner message ID in the chat
          if (this.hasMessage(target.chatId, unwrappedMessage.id)) {
            return;
          }

          const directMessage: DirectMessage = {
            id: unwrappedMessage.id,
            pubkey: unwrappedMessage.pubkey,
            created_at: unwrappedMessage.created_at,
            content: unwrappedMessage.content,
            isOutgoing: isOutgoing,
            tags: unwrappedMessage.tags || [],
            pending: false,
            failed: false,
            received: true,
            read: false,
            encryptionType: 'nip44',
            replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
            giftWrapId: event.id,
          };

          loadedMessages.push(directMessage);
          const groupInfo = this.buildGroupInfo(target, unwrappedMessage.tags || [], unwrappedMessage.created_at);
          await this.addResolvedMessageToChat(target.chatId, directMessage, groupInfo);

        } else if (event.kind === kinds.EncryptedDirectMessage) {
          // --- NIP-04 ---
          // For NIP-04, isOutgoing is determined from the outer event pubkey
          const isOutgoing = event.pubkey === myPubkey;

          let targetPubkey = event.pubkey;
          if (isOutgoing) {
            const pTags = this.utilities.getPTagsValuesFromEvent(event);
            if (pTags.length > 0) {
              targetPubkey = pTags[0];
            } else {
              return;
            }
          }

          // Only process messages belonging to THIS chat (NIP-04 is always 1-on-1)
          if (targetPubkey !== chatId) {
            return;
          }

          // Check if we already have this event in the chat
          if (this.hasMessage(targetPubkey, event.id)) {
            return;
          }

          const decryptedMessage = await this.unwrapNip04MessageInternal(event);
          if (!decryptedMessage) return;

          const directMessage: DirectMessage = {
            id: decryptedMessage.id,
            pubkey: decryptedMessage.pubkey,
            created_at: decryptedMessage.created_at,
            content: decryptedMessage.content,
            isOutgoing: isOutgoing,
            tags: decryptedMessage.tags || [],
            pending: false,
            failed: false,
            received: true,
            read: false,
            encryptionType: 'nip04',
            replyTo: this.getReplyToFromTags(decryptedMessage.tags || []),
          };

          loadedMessages.push(directMessage);
          await this.addResolvedMessageToChat(targetPubkey, directMessage);
        }
      } catch (error) {
        this.logger.error('Failed to process older message:', error);
      }
    };

    try {
      const [receivedEvents, sentEvents] = await Promise.all([
        this.pool.query(allRelays, filterReceived, 15000),
        this.pool.query(allRelays, filterSent, 15000),
      ]);

      for (const event of receivedEvents) {
        await processEvent(event);
      }

      for (const event of sentEvents) {
        await processEvent(event);
      }

      this.logger.debug(`Loaded ${loadedMessages.length} older messages for chat ${chatId}`);
      return loadedMessages.sort((a, b) => a.created_at - b.created_at);
    } catch (error) {
      this.logger.error('Failed to load more messages:', error);
      throw error;
    }
  }
  /**
   * Load more (older) chats by fetching older messages
   */
  async loadMoreChats(): Promise<void> {
    if (this.isLoadingMoreChats() || !this.hasMoreChats()) {
      return;
    }

    this.isLoadingMoreChats.set(true);
    this.error.set(null);

    try {
      const myPubkey = this.accountState.pubkey();
      if (!myPubkey) {
        this.error.set('You need to be logged in to view messages');
        this.isLoadingMoreChats.set(false);
        return;
      }

      const oldestTimestamp = this.oldestChatTimestamp();
      if (!oldestTimestamp) {
        this.hasMoreChats.set(false);
        this.isLoadingMoreChats.set(false);
        return;
      }

      this.logger.debug(`Loading more chats before timestamp: ${oldestTimestamp} (${new Date(oldestTimestamp * 1000).toISOString()})`);


      const filterReceived: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        '#p': [myPubkey],
        until: oldestTimestamp - 1,
        limit: this.MESSAGE_SIZE,
      };

      const filterSent: Filter = {
        kinds: [kinds.GiftWrap, kinds.EncryptedDirectMessage],
        authors: [myPubkey],
        until: oldestTimestamp - 1,
        limit: this.MESSAGE_SIZE,
      };

      let newOldestTimestamp = oldestTimestamp;
      let messagesReceivedFound = 0;
      let messagesSentFound = 0;
      let pendingDecryptions = 0;
      let completedDecryptions = 0;
      let eoseReceived = false;

      // Function to check if we're done and apply final logic
      const checkCompletion = () => {
        if (eoseReceived && pendingDecryptions === completedDecryptions) {
          this.logger.debug(
            `Decryption complete. Received: ${messagesReceivedFound}, Sent: ${messagesSentFound}`
          );

          // Update the oldest timestamp for future loads
          this.oldestChatTimestamp.set(newOldestTimestamp);

          // If both received and sent messages are below the limit, we assume no more chats
          if (messagesReceivedFound < this.MESSAGE_SIZE && messagesSentFound < this.MESSAGE_SIZE) {
            this.logger.debug('No more chats available');
            this.hasMoreChats.set(false);
          }

          this.isLoadingMoreChats.set(false);
        }
      };

      // Subscribe to get older messages
      const sub1 = this.relay.subscribe(
        filterReceived,
        async (event: NostrEvent) => {
          // Track the oldest timestamp
          if (event.created_at < newOldestTimestamp) {
            newOldestTimestamp = event.created_at;
          }

          // Increment pending decryptions counter
          pendingDecryptions++;

          try {
            // Handle incoming wrapped events
            if (event.kind === kinds.GiftWrap) {
              // Check if this gift wrap has already been processed to avoid re-decryption
              if (this.shouldSkipDmEvent(event.id)) {
                this.logger.debug('Gift wrap already processed, skipping decryption (loadMoreChats sub1)', { eventId: event.id });
                completedDecryptions++;
                checkCompletion();
                return;
              }

              const wrappedevent = await this.unwrapMessageInternal(event);

              if (!wrappedevent) {
                this.logger.warn('Failed to unwrap gift-wrapped message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: wrappedevent.id,
                pubkey: wrappedevent.pubkey,
                created_at: wrappedevent.created_at,
                content: wrappedevent.content,
                tags: wrappedevent.tags || [],
                isOutgoing: wrappedevent.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip44',
                replyTo: this.getReplyToFromTags(wrappedevent.tags || []),
                giftWrapId: event.id, // Store gift wrap ID to skip re-decryption later
              };

              // Determine target chat using resolveChatTarget
              const target = resolveChatTarget(wrappedevent, myPubkey);
              if (!target) {
                this.markEventAsDeadLetter(event.id, 'No valid chat target (missing p-tags)', {
                  innerEventId: wrappedevent.id,
                });
                completedDecryptions++;
                checkCompletion();
                return;
              }

              if (directMessage.isOutgoing) {
                messagesSentFound++;
              } else {
                messagesReceivedFound++;
              }

              // Add the message to the chat (this will create new chats if needed)
              const groupInfo = this.buildGroupInfo(target, wrappedevent.tags || [], wrappedevent.created_at);
              await this.addResolvedMessageToChat(target.chatId, directMessage, groupInfo);
            } else if (event.kind === kinds.EncryptedDirectMessage) {
              // Handle incoming NIP-04 direct messages
              let targetPubkey = event.pubkey;

              // Target pubkey logic
              if (targetPubkey === myPubkey) {
                const pTags = this.utilities.getPTagsValuesFromEvent(event);
                if (pTags.length > 0) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              }

              if (this.hasMessage(targetPubkey, event.id)) {
                completedDecryptions++;
                checkCompletion();
                return; // Skip if we already have this message
              }

              const unwrappedMessage = await this.unwrapNip04Message(event);

              if (!unwrappedMessage) {
                this.logger.warn('Failed to unwrap NIP-04 message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: unwrappedMessage.id,
                pubkey: unwrappedMessage.pubkey,
                created_at: unwrappedMessage.created_at,
                content: unwrappedMessage.content,
                tags: unwrappedMessage.tags || [],
                isOutgoing: event.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip04',
                replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
              };

              if (directMessage.isOutgoing) {
                messagesSentFound++;
              } else {
                messagesReceivedFound++;
              }

              // Add the message to the chat (this will create new chats if needed)
              await this.addResolvedMessageToChat(targetPubkey, directMessage);
            }
          } catch (error) {
            this.logger.error('Error processing message during loadMoreChats:', error);
          } finally {
            // Always increment completed counter and check for completion
            completedDecryptions++;
            checkCompletion();
          }
        },
        () => {
          // EOSE callback - just mark that we've received all events
          this.logger.debug(
            `EOSE received. Pending: ${pendingDecryptions}, Completed: ${completedDecryptions}`
          );
          eoseReceived = true;
          checkCompletion();
        }
      );

      const sub2 = this.relay.subscribe(
        filterSent,
        async (event: NostrEvent) => {
          // Track the oldest timestamp
          if (event.created_at < newOldestTimestamp) {
            newOldestTimestamp = event.created_at;
          }

          // Increment pending decryptions counter
          pendingDecryptions++;

          try {
            // Handle incoming wrapped events
            if (event.kind === kinds.GiftWrap) {
              // Check if this gift wrap has already been processed to avoid re-decryption
              if (this.shouldSkipDmEvent(event.id)) {
                this.logger.debug('Gift wrap already processed, skipping decryption (loadMoreChats sub2)', { eventId: event.id });
                completedDecryptions++;
                checkCompletion();
                return;
              }

              const wrappedevent = await this.unwrapMessageInternal(event);

              if (!wrappedevent) {
                this.logger.warn('Failed to unwrap gift-wrapped message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: wrappedevent.id,
                pubkey: wrappedevent.pubkey,
                created_at: wrappedevent.created_at,
                content: wrappedevent.content,
                tags: wrappedevent.tags || [],
                isOutgoing: wrappedevent.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip44',
                replyTo: this.getReplyToFromTags(wrappedevent.tags || []),
                giftWrapId: event.id, // Store gift wrap ID to skip re-decryption later
              };

              // Determine target chat using resolveChatTarget
              const target = resolveChatTarget(wrappedevent, myPubkey);
              if (!target) {
                this.markEventAsDeadLetter(event.id, 'No valid chat target (missing p-tags)', {
                  innerEventId: wrappedevent.id,
                });
                completedDecryptions++;
                checkCompletion();
                return;
              }

              if (directMessage.isOutgoing) {
                messagesSentFound++;
              } else {
                messagesReceivedFound++;
              }

              // Add the message to the chat (this will create new chats if needed)
              const groupInfo = this.buildGroupInfo(target, wrappedevent.tags || [], wrappedevent.created_at);
              await this.addResolvedMessageToChat(target.chatId, directMessage, groupInfo);
            } else if (event.kind === kinds.EncryptedDirectMessage) {
              // Handle incoming NIP-04 direct messages
              let targetPubkey = event.pubkey;

              // Target pubkey logic
              if (targetPubkey === myPubkey) {
                const pTags = this.utilities.getPTagsValuesFromEvent(event);
                if (pTags.length > 0) {
                  targetPubkey = pTags[0];
                } else {
                  this.logger.warn('NIP-04 message has no recipients, ignoring.', event);
                  completedDecryptions++;
                  checkCompletion();
                  return;
                }
              }

              if (this.hasMessage(targetPubkey, event.id)) {
                completedDecryptions++;
                checkCompletion();
                return; // Skip if we already have this message
              }

              const unwrappedMessage = await this.unwrapNip04Message(event);

              if (!unwrappedMessage) {
                this.logger.warn('Failed to unwrap NIP-04 message', event);
                completedDecryptions++;
                checkCompletion();
                return;
              }

              // Create a DirectMessage object from the unwrapped content
              const directMessage: DirectMessage = {
                id: unwrappedMessage.id,
                pubkey: unwrappedMessage.pubkey,
                created_at: unwrappedMessage.created_at,
                content: unwrappedMessage.content,
                tags: unwrappedMessage.tags || [],
                isOutgoing: event.pubkey === myPubkey,
                pending: false,
                failed: false,
                received: true,
                read: false,
                encryptionType: 'nip04',
                replyTo: this.getReplyToFromTags(unwrappedMessage.tags || []),
              };

              if (directMessage.isOutgoing) {
                messagesSentFound++;
              } else {
                messagesReceivedFound++;
              }

              // Add the message to the chat (this will create new chats if needed)
              await this.addResolvedMessageToChat(targetPubkey, directMessage);
            }
          } catch (error) {
            this.logger.error('Error processing message during loadMoreChats:', error);
          } finally {
            // Always increment completed counter and check for completion
            completedDecryptions++;
            checkCompletion();
          }
        },
        () => {
          // EOSE callback - just mark that we've received all events
          this.logger.debug(
            `EOSE received. Pending: ${pendingDecryptions}, Completed: ${completedDecryptions}`
          );
          eoseReceived = true;
          checkCompletion();
        }
      );
    } catch (err) {
      this.logger.error('Failed to load more chats', err);
      this.error.set('Failed to load more chats. Please try again.');
      this.isLoadingMoreChats.set(false);
    }
  }

  // Helper method to add a chat directly to the chatsMap (for temporary/new chats)
  addChat(chat: Chat): void {
    const currentMap = this.chatsMap();
    const newMap = new Map(currentMap);
    newMap.set(chat.id, chat);
    this.chatsMap.set(newMap);
  }

  /**
   * Remove a chat from the local view (hide it)
   * Note: This doesn't delete messages from storage, just hides the chat
   */
  removeChat(chatId: string): void {
    const currentMap = this.chatsMap();
    const newMap = new Map(currentMap);
    newMap.delete(chatId);
    this.chatsMap.set(newMap);
    this.logger.info(`Chat ${chatId} hidden from view`);
  }

  /**
   * Delete a chat locally, including stored direct messages and cached raw events.
   * Optionally places the chat's event IDs in the DM dead-letter list so replayed
   * spam/corrupted events are ignored in future loads.
   */
  async deleteChatLocally(
    chatId: string,
    options: { addToDeadLetter?: boolean; deadLetterReason?: string } = {}
  ): Promise<boolean> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot delete chat: no account pubkey');
      return false;
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      this.logger.warn(`Cannot delete chat: chat ${chatId} not found`);
      return false;
    }

    const eventIds = new Set<string>();
    for (const message of chat.messages.values()) {
      if (message.id) {
        eventIds.add(message.id);
      }
      if (message.giftWrapId) {
        eventIds.add(message.giftWrapId);
      }
    }

    try {
      const shouldAddToDeadLetter = options.addToDeadLetter === true;
      if (shouldAddToDeadLetter) {
        const reason = options.deadLetterReason || 'Chat deleted by user';
        for (const eventId of eventIds) {
          this.markEventAsDeadLetter(eventId, reason, { chatId });
        }
      }

      await this.database.init();
      await this.database.deleteChat(myPubkey, chatId);

      if (eventIds.size > 0) {
        await this.database.deleteEvents(Array.from(eventIds));
      }

      const currentMap = this.chatsMap();
      const newMap = new Map(currentMap);
      newMap.delete(chatId);
      this.chatsMap.set(newMap);

      for (const eventId of eventIds) {
        this.inFlightGiftWrapIds.delete(eventId);
        if (!shouldAddToDeadLetter) {
          this.knownEventIds.delete(eventId);
        }
      }

      this.logger.info('Deleted chat locally', {
        chatId,
        messageCount: chat.messages.size,
        eventCount: eventIds.size,
        addToDeadLetter: shouldAddToDeadLetter,
      });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete chat locally', {
        chatId,
        error,
      });
      return false;
    }
  }

  async deleteChatsForPubkeyLocally(
    targetPubkey: string,
    options: { addToDeadLetter?: boolean; deadLetterReason?: string; hideChat?: boolean } = {}
  ): Promise<{ deletedCount: number; failedCount: number }> {
    const accountPubkey = this.accountState.pubkey();
    const chatsToDelete = Array.from(this.chatsMap().values()).filter(chat => chat.pubkey === targetPubkey);

    if (chatsToDelete.length === 0) {
      return { deletedCount: 0, failedCount: 0 };
    }

    let deletedCount = 0;
    let failedCount = 0;

    for (const chat of chatsToDelete) {
      if (options.hideChat && accountPubkey) {
        this.accountLocalState.hideChat(accountPubkey, chat.id);
      }

      const success = await this.deleteChatLocally(chat.id, {
        addToDeadLetter: options.addToDeadLetter,
        deadLetterReason: options.deadLetterReason,
      });

      if (success) {
        deletedCount++;
      } else {
        failedCount++;
      }
    }

    return { deletedCount, failedCount };
  }

  /**
   * Mark all unread messages in a chat as read
   */
  async markChatAsRead(chatId: string): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot mark chat as read: no account pubkey');
      return;
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      this.logger.warn(`Cannot mark chat as read: chat ${chatId} not found`);
      return;
    }

    // If chat already has 0 unread count, nothing to do
    if (chat.unreadCount === 0) {
      return;
    }

    try {
      // Mark all messages as read in storage
      await this.database.init();
      await this.database.markChatAsRead(myPubkey, chatId);

      // Update the in-memory chat's unread count and mark messages as read
      const currentMap = this.chatsMap();
      const newMap = new Map(currentMap);

      const updatedMessagesMap = new Map(chat.messages);
      for (const [msgId, message] of updatedMessagesMap.entries()) {
        if (!message.isOutgoing && !message.read) {
          updatedMessagesMap.set(msgId, { ...message, read: true });
        }
      }

      const updatedChat: Chat = {
        ...chat,
        unreadCount: 0,
        messages: updatedMessagesMap,
      };

      newMap.set(chatId, updatedChat);
      this.chatsMap.set(newMap);

      this.logger.debug(`Marked chat ${chatId} as read`);
    } catch (error) {
      this.logger.error('Error marking chat as read:', error);
    }
  }

  /**
   * Mark all chats as read
   */
  async markAllChatsAsRead(): Promise<void> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot mark all chats as read: no account pubkey');
      return;
    }

    try {
      await this.database.init();

      const currentMap = this.chatsMap();
      const newMap = new Map(currentMap);

      for (const [chatId, chat] of currentMap.entries()) {
        if (chat.unreadCount > 0) {
          // Mark in database
          await this.database.markChatAsRead(myPubkey, chatId);

          // Update in-memory
          const updatedMessagesMap = new Map(chat.messages);
          for (const [msgId, message] of updatedMessagesMap.entries()) {
            if (!message.isOutgoing && !message.read) {
              updatedMessagesMap.set(msgId, { ...message, read: true });
            }
          }

          const updatedChat: Chat = {
            ...chat,
            unreadCount: 0,
            messages: updatedMessagesMap,
          };

          newMap.set(chatId, updatedChat);
        }
      }

      this.chatsMap.set(newMap);

      // Update the cached unread count in local state
      this.accountLocalState.setUnreadMessagesCount(myPubkey, 0);

      this.logger.debug('Marked all chats as read');
    } catch (error) {
      this.logger.error('Error marking all chats as read:', error);
    }
  }

  /**
   * Delete a message from a chat (local deletion only)
   * This removes the message from local storage and memory.
   * Note: This does not delete the message from relays - that would require
   * publishing a NIP-09 deletion event, but gift-wrapped messages use ephemeral
   * keys so deletion requests cannot be verified by relays.
   * 
   * For outgoing messages, the user can only delete their own view of the message.
   * The recipient will still have their copy.
   * 
   * @param chatId The chat ID (pubkey of the other party)
   * @param messageId The message ID to delete
   * @returns true if the message was deleted, false otherwise
   */
  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot delete message: no account pubkey');
      return false;
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      this.logger.warn(`Cannot delete message: chat ${chatId} not found`);
      return false;
    }

    const message = chat.messages.get(messageId);
    if (!message) {
      this.logger.warn(`Cannot delete message: message ${messageId} not found in chat ${chatId}`);
      return false;
    }

    try {
      // Delete from IndexedDB
      await this.database.init();
      await this.database.deleteDirectMessage(myPubkey, chatId, messageId);

      // Update in-memory state
      const currentMap = this.chatsMap();
      const newMap = new Map(currentMap);
      const existingChat = newMap.get(chatId);

      if (existingChat) {
        const updatedMessagesMap = new Map(existingChat.messages);
        updatedMessagesMap.delete(messageId);

        // Recalculate last message
        const newLastMessage = this.getLatestMessage(updatedMessagesMap);

        // Recalculate unread count if we deleted an unread message
        let newUnreadCount = existingChat.unreadCount;
        if (!message.isOutgoing && !message.read) {
          newUnreadCount = Math.max(0, newUnreadCount - 1);
        }

        const updatedChat: Chat = {
          ...existingChat,
          messages: updatedMessagesMap,
          lastMessage: newLastMessage,
          unreadCount: newUnreadCount,
        };

        newMap.set(chatId, updatedChat);
        this.chatsMap.set(newMap);
      }

      this.logger.info(`Deleted message ${messageId} from chat ${chatId}`);
      return true;
    } catch (error) {
      this.logger.error('Error deleting message:', error);
      return false;
    }
  }

  /**
   * Hide a message in a chat (for received messages)
   * This stores the message ID in local state so it's filtered out of display.
   * The message remains in storage but is not shown to the user.
   * 
   * @param chatId The chat ID (pubkey of the other party)
   * @param messageId The message ID to hide
   * @returns true if the message was hidden, false otherwise
   */
  hideMessage(chatId: string, messageId: string): boolean {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      this.logger.warn('Cannot hide message: no account pubkey');
      return false;
    }

    const chat = this.getChat(chatId);
    if (!chat) {
      this.logger.warn(`Cannot hide message: chat ${chatId} not found`);
      return false;
    }

    const message = chat.messages.get(messageId);
    if (!message) {
      this.logger.warn(`Cannot hide message: message ${messageId} not found in chat ${chatId}`);
      return false;
    }

    // Store in local state
    this.accountLocalState.hideMessage(myPubkey, chatId, messageId);
    this.logger.info(`Hidden message ${messageId} in chat ${chatId}`);
    return true;
  }

  /**
   * Check if a message is hidden
   */
  isMessageHidden(chatId: string, messageId: string, trackChanges = false): boolean {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) return false;
    return this.accountLocalState.isMessageHidden(myPubkey, chatId, messageId, trackChanges);
  }

  /**
   * Lazy load UserRelayService to control initialization timing.
   * Uses the root Injector since both services are providedIn: 'root'.
   */
  private async getUserRelayService() {
    if (!this.userRelayService) {
      const { UserRelayService } = await import('./relays/user-relay');
      try {
        this.userRelayService = this.injector.get(UserRelayService, null);
        if (!this.userRelayService) {
          this.logger.warn('UserRelayService not available from injector');
        }
      } catch (e) {
        this.logger.warn('Could not resolve UserRelayService from injector', e);
      }
    }
    return this.userRelayService;
  }

  /**
   * Send a direct message using NIP-17 (NIP-44 encryption with gift wrapping)
   * This method can be called from anywhere in the app to send DMs
   * 
   * @param messageText The message content to send
   * @param receiverPubkey The recipient's public key
   * @returns Promise<DirectMessage> The sent message object
   */
  async sendDirectMessage(
    messageText: string,
    receiverPubkey: string,
    options?: {
      rumorKind?: number;
      extraRumorTags?: string[][];
    }
  ): Promise<DirectMessage> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      throw new Error('You need to be logged in to send messages');
    }

    const isNoteToSelf = receiverPubkey === myPubkey;

    try {
      // Step 1: Create the message (unsigned event) - kind 14
      const tags: string[][] = [['p', receiverPubkey]];
      if (options?.extraRumorTags?.length) {
        tags.push(...options.extraRumorTags.map(tag => [...tag]));
      }

      const unsignedMessage = {
        kind: options?.rumorKind ?? kinds.PrivateDirectMessage,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: messageText,
      };

      // Calculate the message ID (but don't sign it)
      const rumorId = getEventHash(unsignedMessage);
      const rumorWithId = { ...unsignedMessage, id: rumorId };
      const eventText = JSON.stringify(rumorWithId);

      // Step 2: Create the seal (kind 13) - encrypt the rumor
      const sealedContent = await this.encryption.encryptNip44(eventText, receiverPubkey);

      const sealedMessage = {
        kind: kinds.Seal,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
        tags: [],
        content: sealedContent,
      };

      // Sign the sealed message
      const signedSealedMessage = await this.nostr.signEvent(sealedMessage);

      // Step 3: Create the gift wrap (kind 1059) - encrypt with ephemeral key
      const ephemeralKey = generateSecretKey();
      const ephemeralPubkey = getPublicKey(ephemeralKey);

      // Encrypt the sealed message using the ephemeral key and recipient's pubkey
      const giftWrapContent = await this.encryption.encryptNip44WithKey(
        JSON.stringify(signedSealedMessage),
        bytesToHex(ephemeralKey),
        receiverPubkey
      );

      const giftWrap = {
        kind: kinds.GiftWrap,
        pubkey: ephemeralPubkey,
        created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
        tags: [['p', receiverPubkey]],
        content: giftWrapContent,
      };

      // Sign the gift wrap with the ephemeral key
      const signedGiftWrap = finalizeEvent(giftWrap, ephemeralKey);

      // Get UserRelayService for publishing to DM relays (NIP-17)
      const userRelayService = await this.getUserRelayService();

      // For Note to Self: Only publish one gift wrap to self
      // For regular messages: Create and publish two gift wraps (one for recipient, one for self)
      if (isNoteToSelf) {
        // Note to Self: Only one gift wrap needed
        const publishPromises: Promise<unknown>[] = [];

        // Publish to sender's DM relays if UserRelayService is available
        if (userRelayService) {
          publishPromises.push(userRelayService.publishToDmRelays(myPubkey, signedGiftWrap));
        }

        await this.awaitDirectMessagePublishes(publishPromises, 'note-to-self');
      } else {
        // Regular message: Create second gift wrap for self
        const sealedContent2 = await this.encryption.encryptNip44(eventText, myPubkey);

        const sealedMessage2 = {
          kind: kinds.Seal,
          pubkey: myPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [],
          content: sealedContent2,
        };

        const signedSealedMessage2 = await this.nostr.signEvent(sealedMessage2);

        const giftWrapContent2 = await this.encryption.encryptNip44WithKey(
          JSON.stringify(signedSealedMessage2),
          bytesToHex(ephemeralKey),
          myPubkey
        );

        const giftWrap2 = {
          kind: kinds.GiftWrap,
          pubkey: ephemeralPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [['p', myPubkey]],
          content: giftWrapContent2,
        };

        const signedGiftWrap2 = finalizeEvent(giftWrap2, ephemeralKey);

        // Publish both gift wraps to recipient's and sender's DM relays (NIP-17)
        const publishPromises: Promise<unknown>[] = [];

        // Publish to recipient's DM relays (kind 10050) - this is the primary delivery mechanism per NIP-17
        if (userRelayService) {
          publishPromises.push(userRelayService.publishToDmRelays(receiverPubkey, signedGiftWrap));
          publishPromises.push(userRelayService.publishToDmRelays(myPubkey, signedGiftWrap2));
        }

        await this.awaitDirectMessagePublishes(publishPromises, 'direct-message');
      }

      // Create the message object
      const message: DirectMessage = {
        id: rumorId,
        rumorKind: unsignedMessage.kind,
        pubkey: myPubkey,
        created_at: unsignedMessage.created_at,
        content: messageText,
        isOutgoing: true,
        tags: unsignedMessage.tags,
        encryptionType: 'nip44',
      };

      // Add message to local chat state
      this.addMessageToChat(receiverPubkey, message);

      return message;
    } catch (error) {
      this.logger.error('Failed to send NIP-44 message', error);
      throw error;
    }
  }

  /**
   * Send a payment notification as a DM.
   * Uses sendDirectMessage() so both sender and receiver see the same rumor content
   * (same event ID), which preserves reaction compatibility.
   *
   * @param messageText The message content both parties will see
   * @param receiverPubkey The recipient's public key
   */
  async sendPaymentNotification(messageText: string, receiverPubkey: string): Promise<void> {
    await this.sendDirectMessage(messageText, receiverPubkey);
  }

  /**
   * Send a message to a group chat using NIP-17 (NIP-44 encryption with gift wrapping).
   * Per NIP-17, each participant receives an individually gift-wrapped copy of the same rumor.
   * The room identity is defined by the set of pubkey + p tags.
   *
   * @param messageText The message content to send
   * @param participants All participant pubkeys (including the sender)
   * @param subject Optional conversation subject/topic tag
   * @returns Promise<DirectMessage> The sent message object
   */
  async sendGroupMessage(
    messageText: string,
    participants: string[],
    subject?: string
  ): Promise<DirectMessage> {
    const myPubkey = this.accountState.pubkey();
    if (!myPubkey) {
      throw new Error('You need to be logged in to send messages');
    }

    // Deduplicate and sort participants - ensure sender is included
    const allParticipants = [...new Set([myPubkey, ...participants])].sort();

    if (allParticipants.length < 3) {
      throw new Error('Group messages require at least 3 participants (sender + 2 others)');
    }

    const chatId = computeGroupChatId(allParticipants);
    // Other participants (everyone except the sender) get p-tags in the rumor
    const otherParticipants = allParticipants.filter(p => p !== myPubkey);

    try {
      // Step 1: Create the rumor (unsigned kind 14 event)
      // p-tags include all recipients (not the sender - sender is in .pubkey)
      const tags: string[][] = otherParticipants.map(p => ['p', p]);
      if (subject) {
        tags.push(['subject', subject]);
      }

      const unsignedMessage = {
        kind: kinds.PrivateDirectMessage,
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: messageText,
      };

      // Calculate the message ID (but don't sign it - it's a rumor)
      const rumorId = getEventHash(unsignedMessage);
      const rumorWithId = { ...unsignedMessage, id: rumorId };
      const rumorJson = JSON.stringify(rumorWithId);

      // Step 2: Create a seal (kind 13) for each recipient + self, then gift-wrap each
      // Per NIP-17: each recipient gets their own gift wrap encrypted for them
      const userRelayService = await this.getUserRelayService();
      const publishPromises: Promise<unknown>[] = [];

      // Create gift wraps for all participants (including self)
      for (const recipientPubkey of allParticipants) {
        // Create the seal - encrypt the rumor for this specific recipient
        const sealedContent = await this.encryption.encryptNip44(rumorJson, recipientPubkey);

        const sealedMessage = {
          kind: kinds.Seal,
          pubkey: myPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [],
          content: sealedContent,
        };

        const signedSeal = await this.nostr.signEvent(sealedMessage);

        // Create the gift wrap with an ephemeral key
        const ephemeralKey = generateSecretKey();
        const ephemeralPubkey = getPublicKey(ephemeralKey);

        const giftWrapContent = await this.encryption.encryptNip44WithKey(
          JSON.stringify(signedSeal),
          bytesToHex(ephemeralKey),
          recipientPubkey
        );

        const giftWrap = {
          kind: kinds.GiftWrap,
          pubkey: ephemeralPubkey,
          created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
          tags: [['p', recipientPubkey]],
          content: giftWrapContent,
        };

        const signedGiftWrap = finalizeEvent(giftWrap, ephemeralKey);

        // Publish to recipient's DM relays (primary NIP-17 delivery)
        if (userRelayService) {
          publishPromises.push(userRelayService.publishToDmRelays(recipientPubkey, signedGiftWrap));
        }
      }

      await this.awaitDirectMessagePublishes(publishPromises, 'direct-message');

      // Create the local message object
      const message: DirectMessage = {
        id: rumorId,
        rumorKind: kinds.PrivateDirectMessage,
        pubkey: myPubkey,
        created_at: unsignedMessage.created_at,
        content: messageText,
        isOutgoing: true,
        tags: unsignedMessage.tags,
        encryptionType: 'nip44',
      };

      // Add message to local group chat state
      this.addMessageToChat(chatId, message, {
        isGroup: true,
        participants: allParticipants,
        subject,
        subjectUpdatedAt: subject ? unsignedMessage.created_at : undefined,
      });

      return message;
    } catch (error) {
      this.logger.error('Failed to send group message', error);
      throw error;
    }
  }

  private async awaitDirectMessagePublishes(
    publishPromises: Promise<unknown>[],
    publishContext: 'direct-message' | 'note-to-self'
  ): Promise<void> {
    if (publishPromises.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      publishPromises.map((promise, index) =>
        this.withPublishTimeout(
          promise,
          `${publishContext}:${index + 1}`,
          this.directMessagePublishTimeoutMs
        )
      )
    );

    const timedOutPublishes = results.filter(result => {
      if (result.status !== 'rejected') {
        return false;
      }

      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return reason.includes('Publish timeout');
    }).length;

    if (timedOutPublishes > 0) {
      this.logger.warn('[MessagingService] Some DM relay publishes timed out after local send completed', {
        publishContext,
        timeoutMs: this.directMessagePublishTimeoutMs,
        timedOutPublishes,
        totalPublishes: publishPromises.length,
      });
    }
  }

  private withPublishTimeout<T>(promise: Promise<T>, publishLabel: string, timeoutMs: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Publish timeout (${publishLabel}) after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });
  }
}
