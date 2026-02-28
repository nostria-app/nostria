import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { MessagingService } from './messaging.service';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { UtilitiesService } from './utilities.service';
import { EncryptionService } from './encryption.service';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, kinds } from 'nostr-tools';
import { v2 } from 'nostr-tools/nip44';
import { AccountRelayService } from './relays/account-relay';

describe('MessagingService', () => {
    let service: MessagingService;

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
        error: vi.fn().mockName("LoggerService.error"),
        warn: vi.fn().mockName("LoggerService.warn")
    };
    const mockAccountStateService = {
        state: vi.fn().mockName("AccountStateService.state")
    };
    const mockUtilitiesService = {
        utils: vi.fn().mockName("UtilitiesService.utils")
    };
    const mockEncryptionService = {
        encrypt: vi.fn().mockName("EncryptionService.encrypt"),
        decrypt: vi.fn().mockName("EncryptionService.decrypt")
    };

    beforeEach(async () => {
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
            ],
        }).compileComponents();

        service = TestBed.inject(MessagingService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
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

        const conversationKeyEmpheral2 = v2.utils.getConversationKey(ephemeralKey, myPubkey);
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

        // Step 4: Create the gift wrap for self (kind 1059) - same content but different tags in pubkey.
        // Should we use different ephemeral key for self? The content is the same anyway,
        // so correlation of messages (and pub keys who are chatting) can be done through the content of gift wrap.
        const giftWrapSelf = {
            kind: kinds.GiftWrap,
            pubkey: ephemeralPubkey,
            created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random timestamp within 2 days
            tags: [['p', myPubkey]],
            content: giftWrapContent2,
        };

        // Sign the gift wrap with the ephemeral key
        const signedGiftWrapSelf = finalizeEvent(giftWrapSelf, ephemeralKey);

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

        expect(decryptedMessageEvent2.id).toEqual(decryptedMessageEvent.id);
    });

    it('should extract replyTo from e tag', () => {
        // Test the private getReplyToFromTags method by testing a DirectMessage with e tag
        const tags: string[][] = [
            ['p', 'pubkey123'],
            ['e', 'event-id-to-reply-to'],
        ];

        // Access the private method through any for testing
        const replyTo = (service as any).getReplyToFromTags(tags);

        expect(replyTo).toBe('event-id-to-reply-to');
    });

    it('should return undefined when no e tag exists', () => {
        const tags: string[][] = [
            ['p', 'pubkey123'],
        ];

        const replyTo = (service as any).getReplyToFromTags(tags);

        expect(replyTo).toBeUndefined();
    });

    it('should handle multiple tags and find e tag', () => {
        const tags: string[][] = [
            ['p', 'pubkey123'],
            ['subject', 'Test Subject'],
            ['e', 'reply-event-id'],
            ['other', 'value'],
        ];

        const replyTo = (service as any).getReplyToFromTags(tags);

        expect(replyTo).toBe('reply-event-id');
    });
});
