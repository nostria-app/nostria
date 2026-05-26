// @vitest-environment jsdom
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeDirectChatId, MessagingService } from './messaging.service';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, kinds } from 'nostr-tools';
import { v2 } from 'nostr-tools/nip44';
import { AccountRelayService } from './relays/account-relay';
import { RelayPoolService } from './relays/relay-pool';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { EncryptionPermissionService } from './encryption-permission.service';
import { DatabaseService } from './database.service';
import { AccountLocalStateService } from './account-local-state.service';
import { SettingsService } from './settings.service';

interface MessagingServicePrivate {
    getReplyToFromTags(tags: string[][]): string | undefined;
}

describe('MessagingService', () => {
    let service: MessagingService;

    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

    // Mock services
    const mockNostrService = {
        getPool: vi.fn().mockName("NostrService.getPool"),
        publish: vi.fn().mockName("NostrService.publish")
    };
    const mockRelayService = {
        getPool: vi.fn().mockName("RelayService.getPool")
    };
    const mockLoggerService = {
        log: vi.fn().mockName("LoggerService.log"),
        debug: vi.fn().mockName("LoggerService.debug"),
        info: vi.fn().mockName("LoggerService.info"),
        error: vi.fn().mockName("LoggerService.error"),
        warn: vi.fn().mockName("LoggerService.warn")
    };
    const mockAccountStateService = {
        state: vi.fn().mockName("AccountStateService.state"),
        pubkey: vi.fn().mockReturnValue(null),
        account: vi.fn().mockReturnValue(null),
        canUseDirectMessages: vi.fn().mockReturnValue(false)
    };
    const mockUtilitiesService = {
        utils: vi.fn().mockName("UtilitiesService.utils"),
        getPTagsValuesFromEvent: vi.fn().mockReturnValue([]),
        currentDate: vi.fn().mockReturnValue(1)
    };
    const mockEncryptionService = {
        encrypt: vi.fn().mockName("EncryptionService.encrypt"),
        decrypt: vi.fn().mockName("EncryptionService.decrypt")
    };
    const mockRelayPoolService = {
        query: vi.fn().mockResolvedValue([]),
        publishWithTracking: vi.fn().mockReturnValue([])
    };
    const mockDiscoveryRelayService = {
        getRelayUrls: vi.fn().mockReturnValue([])
    };
    const mockEncryptionPermissionService = {
        hasPermission: vi.fn().mockReturnValue(true)
    };
    const mockDatabaseService = {
        getAllMessages: vi.fn().mockResolvedValue([]),
        getChats: vi.fn().mockResolvedValue([]),
        getMessagesByChat: vi.fn().mockResolvedValue([]),
        saveMessage: vi.fn().mockResolvedValue(undefined),
        saveChat: vi.fn().mockResolvedValue(undefined),
        updateChatUnreadCount: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        deleteChat: vi.fn().mockResolvedValue(undefined),
        clearMessages: vi.fn().mockResolvedValue(undefined)
    };
    const mockAccountLocalStateService = {
        getUnreadMessagesCount: vi.fn().mockReturnValue(0),
        setUnreadMessagesCount: vi.fn(),
        getMessagesLastCheck: vi.fn().mockReturnValue(null),
        setMessagesLastCheck: vi.fn(),
        hideChat: vi.fn(),
        hideMessage: vi.fn(),
        isMessageHidden: vi.fn().mockReturnValue(false)
    };
    const mockSettingsService = {
        settings: vi.fn().mockReturnValue({ messageNotificationSoundsEnabled: false }),
        get: vi.fn()
    };

    beforeEach(async () => {
        TestBed.resetTestingModule();
        vi.clearAllMocks();

        await TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MessagingService,
                { provide: NostrService, useValue: mockNostrService },
                { provide: AccountRelayService, useValue: mockRelayService },
                { provide: LoggerService, useValue: mockLoggerService },
                { provide: AccountStateService, useValue: mockAccountStateService },
                { provide: UtilitiesService, useValue: mockUtilitiesService },
                { provide: EncryptionService, useValue: mockEncryptionService },
                { provide: RelayPoolService, useValue: mockRelayPoolService },
                { provide: DiscoveryRelayService, useValue: mockDiscoveryRelayService },
                { provide: EncryptionPermissionService, useValue: mockEncryptionPermissionService },
                { provide: DatabaseService, useValue: mockDatabaseService },
                { provide: AccountLocalStateService, useValue: mockAccountLocalStateService },
                { provide: SettingsService, useValue: mockSettingsService },
            ],
        }).compileComponents();

        service = TestBed.inject(MessagingService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should keep NIP-04 and NIP-17 direct chats separate for the same pubkey', () => {
        const senderPubkey = '0'.repeat(64);
        const receiverPubkey = '1'.repeat(64);

        service.addMessageToChat(receiverPubkey, {
            id: 'legacy-message-id',
            pubkey: receiverPubkey,
            created_at: 1,
            content: 'legacy',
            isOutgoing: false,
            tags: [['p', senderPubkey]],
            encryptionType: 'nip04',
        });

        service.addMessageToChat(receiverPubkey, {
            id: 'modern-message-id',
            pubkey: senderPubkey,
            created_at: 2,
            content: 'modern',
            isOutgoing: true,
            tags: [['p', receiverPubkey]],
            encryptionType: 'nip44',
        });

        service.addMessageToChat(computeDirectChatId(receiverPubkey, 'nip04'), {
            id: 'modern-message-from-stale-chat-id',
            pubkey: senderPubkey,
            created_at: 3,
            content: 'modern from stale id',
            isOutgoing: true,
            tags: [['p', receiverPubkey]],
            encryptionType: 'nip44',
        });

        const legacyChat = service.getChat(computeDirectChatId(receiverPubkey, 'nip04'));
        const modernChat = service.getChat(computeDirectChatId(receiverPubkey, 'nip44'));

        expect(legacyChat?.pubkey).toBe(receiverPubkey);
        expect(legacyChat?.encryptionType).toBe('nip04');
        expect(legacyChat?.messages.has('legacy-message-id')).toBe(true);
        expect(legacyChat?.messages.has('modern-message-id')).toBe(false);
        expect(legacyChat?.messages.has('modern-message-from-stale-chat-id')).toBe(false);

        expect(modernChat?.pubkey).toBe(receiverPubkey);
        expect(modernChat?.encryptionType).toBe('nip44');
        expect(modernChat?.messages.has('modern-message-id')).toBe(true);
        expect(modernChat?.messages.has('modern-message-from-stale-chat-id')).toBe(true);
        expect(modernChat?.messages.has('legacy-message-id')).toBe(false);

        expect(service.getChat(receiverPubkey)).toBeNull();
    });

    it('Verifying NIP-17', () => {
        const myKey = generateSecretKey();
        const myPubkey = getPublicKey(myKey);

        const receiverKey = generateSecretKey();
        const receiverKeyPubkey = getPublicKey(receiverKey);

        // Step 1: Create the message (unsigned event) - kind 14
        const unsignedMessage = {
            kind: kinds.PrivateDirectMessage,
            pubkey: myPubkey,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', receiverKeyPubkey]],
            content: 'Hello World',
        };

        // Calculate the message ID (but don't sign it)
        const rumorId = getEventHash(unsignedMessage);
        const rumorWithId = { ...unsignedMessage, id: rumorId };
        const plaintext = JSON.stringify(rumorWithId);

        // Use nostr-tools nip44 v2 encryption
        const conversationKey = v2.utils.getConversationKey(myKey, receiverKeyPubkey);
        const sealedContent = v2.encrypt(plaintext, conversationKey);

        const sealedMessage = {
            kind: kinds.Seal,
            pubkey: myPubkey,
            created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
            tags: [],
            content: sealedContent,
        };

        // Sign the sealed message
        const signedSealedMessage = finalizeEvent(sealedMessage, myKey);

        // Use nostr-tools nip44 v2 encryption
        const conversationKey2 = v2.utils.getConversationKey(myKey, myPubkey);
        const sealedContent2 = v2.encrypt(plaintext, conversationKey2);

        const sealedMessage2 = {
            kind: kinds.Seal,
            pubkey: myPubkey,
            created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
            tags: [],
            content: sealedContent2,
        };

        // Sign the sealed message
        const signedSealedMessage2 = finalizeEvent(sealedMessage2, myKey);

        const ephemeralKey = generateSecretKey();
        const ephemeralPubkey = getPublicKey(ephemeralKey);

        const conversationKeyEmpheral1 = v2.utils.getConversationKey(ephemeralKey, receiverKeyPubkey);
        const giftWrapContent1 = v2.encrypt(JSON.stringify(signedSealedMessage), conversationKeyEmpheral1);

        const selfEphemeralKey = generateSecretKey();
        const selfEphemeralPubkey = getPublicKey(selfEphemeralKey);

        const conversationKeyEmpheral2 = v2.utils.getConversationKey(selfEphemeralKey, myPubkey);
        const giftWrapContent2 = v2.encrypt(JSON.stringify(signedSealedMessage2), conversationKeyEmpheral2);

        const giftWrap = {
            kind: kinds.GiftWrap,
            pubkey: ephemeralPubkey,
            created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
            tags: [['p', receiverKeyPubkey]],
            content: giftWrapContent1,
        };

        // Sign the gift wrap with the ephemeral key
        const signedGiftWrap = finalizeEvent(giftWrap, ephemeralKey);

        // Step 4: Create the gift wrap for self (kind 1059) with a fresh random wrapper key.
        const giftWrapSelf = {
            kind: kinds.GiftWrap,
            pubkey: selfEphemeralPubkey,
            created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
            tags: [['p', myPubkey]],
            content: giftWrapContent2,
        };

        // Sign the gift wrap with the self-copy ephemeral key
        const signedGiftWrapSelf = finalizeEvent(giftWrapSelf, selfEphemeralKey);

        // Use nostr-tools nip44 v2 decryption
        const conversationKeyDecrypt = v2.utils.getConversationKey(receiverKey, signedGiftWrap.pubkey);
        const decryptedGiftWrap = JSON.parse(v2.decrypt(signedGiftWrap.content, conversationKeyDecrypt));

        // The receiver & the author should both be able to decrypt the content of kind 13.
        const receiverConversationKey = v2.utils.getConversationKey(receiverKey, decryptedGiftWrap.pubkey);
        const decryptedMessageEvent = JSON.parse(v2.decrypt(decryptedGiftWrap.content, receiverConversationKey));

        // Now the sender will decrypt his own gift wrap to get the original message.
        const conversationKeyDecryptSelf = v2.utils.getConversationKey(myKey, signedGiftWrapSelf.pubkey);
        const decryptedGiftWrapSelf = JSON.parse(v2.decrypt(signedGiftWrapSelf.content, conversationKeyDecryptSelf));

        // The receiver & the author should both be able to decrypt the content of kind 13.
        const receiverConversationKey2 = v2.utils.getConversationKey(myKey, decryptedGiftWrapSelf.pubkey);
        const decryptedMessageEvent2 = JSON.parse(v2.decrypt(decryptedGiftWrapSelf.content, receiverConversationKey2));

        expect(signedGiftWrapSelf.pubkey).not.toEqual(signedGiftWrap.pubkey);
        expect(decryptedMessageEvent2.id).toEqual(decryptedMessageEvent.id);
    });

    it('should extract replyTo from e tag', () => {
        // Test the private getReplyToFromTags method by testing a DirectMessage with e tag
        const tags: string[][] = [
            ['p', 'pubkey123'],
            ['e', 'event-id-to-reply-to'],
        ];

        const replyTo = (service as unknown as MessagingServicePrivate).getReplyToFromTags(tags);

        expect(replyTo).toBe('event-id-to-reply-to');
    });

    it('should return undefined when no e tag exists', () => {
        const tags: string[][] = [
            ['p', 'pubkey123'],
        ];

        const replyTo = (service as unknown as MessagingServicePrivate).getReplyToFromTags(tags);

        expect(replyTo).toBeUndefined();
    });

    it('should handle multiple tags and find e tag', () => {
        const tags: string[][] = [
            ['p', 'pubkey123'],
            ['subject', 'Test Subject'],
            ['e', 'reply-event-id'],
            ['other', 'value'],
        ];

        const replyTo = (service as unknown as MessagingServicePrivate).getReplyToFromTags(tags);

        expect(replyTo).toBe('reply-event-id');
    });
});
