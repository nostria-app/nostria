// @vitest-environment jsdom
import '@angular/compiler';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kinds } from 'nostr-tools';
import { MessagesComponent } from './messages.component';

/**
 * Tests for optimistic message sending behavior.
 *
 * The key UX improvement: after encryption and signing complete,
 * isSending is cleared and the message appears immediately in the UI.
 * Relay publishing happens in the background without blocking the UI.
 */

// Minimal DirectMessage shape for testing
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
    encryptionType?: 'nip04' | 'nip44';
}

const TEST_MY_PUBKEY = '0'.repeat(64);
const TEST_RECEIVER_PUBKEY = '1'.repeat(64);
const TEST_NIP44_CHAT_ID = `${TEST_RECEIVER_PUBKEY}-nip44`;
const TEST_NIP04_CHAT_ID = `${TEST_RECEIVER_PUBKEY}-nip04`;

function createComponent(): MessagesComponent {
    const component = Object.create(MessagesComponent.prototype) as MessagesComponent;

    // Initialize signals that sendMessage() reads/writes
    (component as any).newMessageText = signal('');
    (component as any).isSending = signal(false);
    (component as any).isGroupChat = signal(false);
    (component as any).uploadStatus = signal('');
    (component as any).mediaPreviews = signal([]);
    (component as any).hasMoreMessages = signal(true);
    (component as any).pendingTags = signal<string[][]>([]);
    (component as any).pendingMessages = signal<DirectMessage[]>([]);
    (component as any).replyingToMessage = signal(null);
    (component as any).showMobileList = signal(true);
    (component as any).showChatDetails = signal(false);
    (component as any).isSinglePaneView = signal(false);

    // Mock selectedChat
    const mockChat = {
        id: TEST_NIP44_CHAT_ID,
        pubkey: TEST_RECEIVER_PUBKEY,
        unreadCount: 0,
        messages: new Map(),
        encryptionType: 'nip44',
        hasLegacyMessages: false,
    };
    (component as any).selectedChatId = signal(TEST_NIP44_CHAT_ID);
    (component as any).selectedChat = signal(mockChat);

    // Mock services
    (component as any).accountState = {
        pubkey: signal(TEST_MY_PUBKEY),
    };

    (component as any).accountLocalState = {
        getChatDraft: vi.fn().mockReturnValue(''),
        setChatDraft: vi.fn(),
    };

    (component as any).userRelayService = {
        ensureRelaysForPubkey: vi.fn().mockResolvedValue(undefined),
        ensureDmRelaysForPubkey: vi.fn().mockResolvedValue(undefined),
        getRelaysForPubkey: vi.fn().mockReturnValue(['wss://regular.relay/']),
        getUserDmRelaysForPublishing: vi.fn().mockResolvedValue(['wss://relay.example/']),
        publishToDmRelays: vi.fn().mockResolvedValue(true),
        publish: vi.fn().mockResolvedValue(undefined),
    };

    (component as any).accountRelay = {
        publish: vi.fn().mockResolvedValue(undefined),
    };

    (component as any).discoveryRelay = {
        getRelayUrls: vi.fn().mockReturnValue(['wss://discovery.relay/']),
        getPool: vi.fn().mockReturnValue({
            publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
        }),
    };

    (component as any).logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };

    (component as any).messaging = {
        addChat: vi.fn(),
        addMessageToChat: vi.fn(),
        updateMessageInChat: vi.fn(),
        removeMessageFromChat: vi.fn(),
        getChat: vi.fn().mockReturnValue(mockChat),
        getChatMessages: vi.fn().mockReturnValue([]),
        sendDirectMessage: vi.fn().mockResolvedValue(undefined),
    };

    (component as any).customDialog = {
        open: vi.fn().mockReturnValue({
            afterClosed$: {
                subscribe: vi.fn(),
            },
        }),
    };

    (component as any).notifications = {
        addNotification: vi.fn(),
    };

    (component as any).nostr = {
        signEvent: vi.fn().mockImplementation((event: unknown) => Promise.resolve({ ...(event as object), id: 'signed-id', sig: 'signed-sig' })),
    };

    (component as any).encryption = {
        encryptNip44: vi.fn().mockResolvedValue('encrypted-content'),
        encryptNip44WithKey: vi.fn().mockResolvedValue('giftwrap-content'),
        encryptNip04: vi.fn().mockResolvedValue('nip04-encrypted'),
    };

    (component as any).relayPool = {
        publishWithTracking: vi.fn().mockReturnValue([Promise.resolve('wss://regular.relay/')]),
    };

    (component as any).snackBar = {
        open: vi.fn(),
    };

    (component as any).mediaService = {
        load: vi.fn().mockResolvedValue(undefined),
        mediaServers: vi.fn().mockReturnValue(['https://media.example/']),
        uploadFile: vi.fn().mockResolvedValue({
            status: 'success',
            item: { url: 'https://media.example/encrypted.bin' },
        }),
        getFileBytes: vi.fn(),
        getFileMimeType: vi.fn().mockReturnValue('application/pdf'),
    };

    (component as any).layout = {
        toast: vi.fn(),
        hideMobileNav: signal(false),
    };

    (component as any).router = {
        navigate: vi.fn(),
    };

    // Stub methods not under test
    (component as any).scrollToBottom = vi.fn();
    (component as any).focusMessageInput = vi.fn();
    (component as any).markChatAsRead = vi.fn().mockResolvedValue(undefined);
    (component as any).resolveStalePendingMessages = vi.fn();

    return component;
}

describe('MessagesComponent sendMessage', () => {
    let component: MessagesComponent;

    beforeEach(() => {
        component = createComponent();
    });

    it('should clear isSending before relay publishing completes', async () => {
        // Arrange: make relay publishing slow (never resolves during test)
        let publishResolve: () => void;
        const slowPublish = new Promise<void>(resolve => { publishResolve = resolve; });
        (component as any).userRelayService.publishToDmRelays.mockReturnValue(slowPublish);

        (component as any).newMessageText.set('Hello!');

        // Act
        const sendPromise = component.sendMessage();
        await sendPromise;

        // Assert: isSending should already be false, even though publishing hasn't finished
        expect((component as any).isSending()).toBe(false);

        // Clean up: resolve the publish promise
        publishResolve!();
    });

    it('should add message to pending messages immediately after signing', async () => {
        (component as any).newMessageText.set('Test message');

        await component.sendMessage();

        // pendingMessages should have the sent message
        const pending = (component as any).pendingMessages() as DirectMessage[];
        expect(pending.length).toBe(1);
        expect(pending[0].content).toBe('Test message');
        expect(pending[0].pending).toBe(true);
        expect(pending[0].isOutgoing).toBe(true);
    });

    it('should clear the input text immediately', async () => {
        (component as any).newMessageText.set('Hello there');

        await component.sendMessage();

        expect((component as any).newMessageText()).toBe('');
    });

    it('should add message to messaging service for chat updates', async () => {
        (component as any).newMessageText.set('Chat update test');

        await component.sendMessage();

        const messagingService = (component as any).messaging;
        expect(messagingService.addMessageToChat).toHaveBeenCalledWith(TEST_NIP44_CHAT_ID, expect.objectContaining({
            content: 'Chat update test',
            pending: true,
            received: false,
        }));
    });

    it('should not send when message is empty', async () => {
        (component as any).newMessageText.set('   ');

        await component.sendMessage();

        expect((component as any).isSending()).toBe(false);
        expect((component as any).userRelayService.ensureRelaysForPubkey).not.toHaveBeenCalled();
    });

    it('should not send when already sending', async () => {
        (component as any).isSending.set(true);
        (component as any).newMessageText.set('Hello');

        await component.sendMessage();

        // ensureRelaysForPubkey should not be called since we're already sending
        expect((component as any).userRelayService.ensureRelaysForPubkey).not.toHaveBeenCalled();
    });

    it('should handle send errors gracefully', async () => {
        (component as any).newMessageText.set('Will fail');
        (component as any).encryption.encryptNip44.mockRejectedValue(new Error('Encryption failed'));

        await component.sendMessage();

        // isSending should be cleared
        expect((component as any).isSending()).toBe(false);

        // Error notification should be shown
        expect((component as any).notifications.addNotification).toHaveBeenCalledWith(expect.objectContaining({
            type: expect.any(String),
            title: 'Message Failed',
        }));

        // Pending messages should be cleared on error
        expect((component as any).pendingMessages().length).toBe(0);
    });

    it('should call relay discovery for receiver before creating message', async () => {
        (component as any).newMessageText.set('Check relay discovery');

        await component.sendMessage();

        expect((component as any).userRelayService.ensureRelaysForPubkey)
            .toHaveBeenCalledWith(TEST_RECEIVER_PUBKEY);
    });

    it('should allow sending another message immediately after first completes', async () => {
        // Arrange: slow publishing
        const publishResolves: (() => void)[] = [];
        (component as any).userRelayService.publishToDmRelays.mockImplementation(() => {
            return new Promise<void>(resolve => { publishResolves.push(resolve); });
        });

        // First message
        (component as any).newMessageText.set('First');
        await component.sendMessage();

        expect((component as any).isSending()).toBe(false);

        // Second message should be sendable immediately
        (component as any).newMessageText.set('Second');
        await component.sendMessage();

        expect((component as any).isSending()).toBe(false);

        const pending = (component as any).pendingMessages() as DirectMessage[];
        expect(pending.length).toBe(2);
        expect(pending[0].content).toBe('First');
        expect(pending[1].content).toBe('Second');

        // Clean up
        publishResolves.forEach(r => r());
    });

    it('should not block UI while publishing to relays', async () => {
        // Arrange: track timing
        let publishStarted = false;
        let isSendingWhenPublishStarts = true;

        (component as any).userRelayService.publishToDmRelays.mockImplementation(() => {
            publishStarted = true;
            // By the time publishing starts (in background), isSending should already be false
            isSendingWhenPublishStarts = (component as any).isSending();
            return Promise.resolve();
        });

        (component as any).newMessageText.set('Background test');

        await component.sendMessage();
        // Give microtask queue time to run the background publish
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(publishStarted).toBe(true);
        expect(isSendingWhenPublishStarts).toBe(false);
    });

    it('should log error but not crash when background publishing fails', async () => {
        (component as any).userRelayService.publishToDmRelays.mockRejectedValue(new Error('Relay timeout'));
        (component as any).newMessageText.set('Publish will fail');

        await component.sendMessage();
        // Give microtask queue time to process the rejected promise
        await new Promise(resolve => setTimeout(resolve, 50));

        // isSending should be false (message creation succeeded)
        expect((component as any).isSending()).toBe(false);

        // Failed background publishing should remove the transient pending copy
        // and mark the persisted message as failed for retry.
        const pending = (component as any).pendingMessages() as DirectMessage[];
        expect(pending.length).toBe(0);

        expect((component as any).messaging.updateMessageInChat).toHaveBeenCalledWith(
            TEST_NIP44_CHAT_ID,
            expect.any(String),
            expect.objectContaining({
                pending: false,
                received: false,
                failed: true,
            })
        );
        expect((component as any).logger.error).toHaveBeenCalledWith(
            'Message delivery failed:',
            'Failed to deliver to recipient\'s DM relays'
        );
    });

    it('should p-tag each NIP-17 gift wrap for its recipient and use a fresh wrapper key', async () => {
        const myPubkey = '0'.repeat(64);
        const receiverPubkey = '1'.repeat(64);
        (component as any).userRelayService.getUserDmRelaysForPublishing.mockImplementation(
            async (pubkey: string) => [pubkey === receiverPubkey ? 'wss://receiver.relay/' : 'wss://sender.relay/'],
        );

        const result = await (component as any).createNip44Message('Protocol check', receiverPubkey, myPubkey);
        await result.publish();

        const publishCalls = (component as any).userRelayService.publishToDmRelays.mock.calls;
        expect(publishCalls).toHaveLength(2);

        const [recipientTarget, recipientGiftWrap] = publishCalls[0];
        const [selfTarget, selfGiftWrap] = publishCalls[1];

        expect(recipientTarget).toBe(receiverPubkey);
        expect(recipientGiftWrap.kind).toBe(kinds.GiftWrap);
        expect(recipientGiftWrap.tags).toEqual([['p', receiverPubkey, 'wss://receiver.relay/']]);

        expect(selfTarget).toBe(myPubkey);
        expect(selfGiftWrap.kind).toBe(kinds.GiftWrap);
        expect(selfGiftWrap.tags).toEqual([['p', myPubkey, 'wss://sender.relay/']]);

        expect(recipientGiftWrap.pubkey).not.toBe(selfGiftWrap.pubkey);

        const giftWrapEncryptionCalls = (component as any).encryption.encryptNip44WithKey.mock.calls;
        expect(giftWrapEncryptionCalls).toHaveLength(2);
        expect(giftWrapEncryptionCalls[0][1]).not.toBe(giftWrapEncryptionCalls[1][1]);
    });

    it('should send kind 4 when the selected chat is legacy NIP-04', async () => {
        (component as any).selectedChat.set({
            id: TEST_NIP04_CHAT_ID,
            pubkey: TEST_RECEIVER_PUBKEY,
            unreadCount: 0,
            messages: new Map(),
            encryptionType: 'nip04',
            hasLegacyMessages: true,
        });
        (component as any).replyingToMessage.set({
            id: 'legacy-reply-id',
            pubkey: TEST_RECEIVER_PUBKEY,
            created_at: 1,
            content: 'Earlier legacy message',
            isOutgoing: false,
            tags: [['p', TEST_MY_PUBKEY]],
            encryptionType: 'nip04',
        });
        (component as any).newMessageText.set('Legacy hello');

        await component.sendMessage();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect((component as any).encryption.encryptNip04)
            .toHaveBeenCalledWith('Legacy hello', TEST_RECEIVER_PUBKEY);
        expect((component as any).encryption.encryptNip44WithKey).not.toHaveBeenCalled();
        expect((component as any).userRelayService.ensureDmRelaysForPubkey)
            .not.toHaveBeenCalledWith(TEST_RECEIVER_PUBKEY);
        expect((component as any).nostr.signEvent).toHaveBeenCalledWith(expect.objectContaining({
            kind: kinds.EncryptedDirectMessage,
            tags: [['p', TEST_RECEIVER_PUBKEY], ['e', 'legacy-reply-id']],
            content: 'nip04-encrypted',
        }));
        expect((component as any).relayPool.publishWithTracking).toHaveBeenCalledWith(
            ['wss://regular.relay/'],
            expect.objectContaining({ kind: kinds.EncryptedDirectMessage })
        );
        expect((component as any).messaging.addMessageToChat).toHaveBeenCalledWith(
            TEST_NIP04_CHAT_ID,
            expect.objectContaining({ encryptionType: 'nip04' })
        );
    });

    it('should keep the NIP-04 choice when starting a new legacy chat', async () => {
        (component as any).messaging.getChat.mockReturnValue(null);
        (component as any).selectChat = vi.fn();

        await (component as any).startChatWithUser('legacy-recipient', true);

        expect((component as any).userRelayService.ensureRelaysForPubkey)
            .toHaveBeenCalledWith('legacy-recipient');
        expect((component as any).messaging.addChat).toHaveBeenCalledWith(expect.objectContaining({
            id: 'legacy-recipient-nip04',
            pubkey: 'legacy-recipient',
            encryptionType: 'nip04',
            hasLegacyMessages: true,
        }));
    });

    it('should show encrypted file preview text for file messages', () => {
        const text = component.getChatPreviewText({
            id: 'file-msg',
            rumorKind: 15,
            pubkey: TEST_RECEIVER_PUBKEY,
            created_at: 1,
            content: 'https://example.com/file.bin',
            isOutgoing: true,
            tags: [],
        } as DirectMessage);

        expect(text).toBe('Encrypted file');
    });
});

describe('MessagesComponent forwardMessage', () => {
    let component: MessagesComponent;

    beforeEach(() => {
        component = createComponent();
    });

    it('should preserve media encryption tags when forwarding a file message', async () => {
        const subscribe = vi.fn((callback: ({ result }: { result: { pubkeys: string[] } }) => void) => {
            callback({ result: { pubkeys: ['forward-recipient'] } });
        });
        (component as any).customDialog.open.mockReturnValue({
            afterClosed$: { subscribe },
        });

        await component.forwardMessage({
            id: 'original-message',
            rumorKind: 15,
            pubkey: 'sender-pubkey',
            created_at: 123,
            content: 'https://media.example/encrypted.bin',
            isOutgoing: false,
            tags: [
                ['p', 'old-recipient'],
                ['e', 'reply-id'],
                ['alt', 'secret.pdf'],
                ['file-type', 'application/pdf'],
                ['encryption-algorithm', 'aes-gcm'],
                ['decryption-key', 'key-hex'],
                ['decryption-nonce', 'nonce-hex'],
                ['x', 'encrypted-sha'],
                ['ox', 'original-sha'],
                ['size', '1234'],
            ],
        } as DirectMessage);

        expect((component as any).messaging.sendDirectMessage).toHaveBeenCalledWith(
            'https://media.example/encrypted.bin',
            'forward-recipient',
            {
                rumorKind: 15,
                extraRumorTags: [
                    ['alt', 'secret.pdf'],
                    ['file-type', 'application/pdf'],
                    ['encryption-algorithm', 'aes-gcm'],
                    ['decryption-key', 'key-hex'],
                    ['decryption-nonce', 'nonce-hex'],
                    ['x', 'encrypted-sha'],
                    ['ox', 'original-sha'],
                    ['size', '1234'],
                ],
            },
        );
    });
});

describe('MessagesComponent formatMessageTime', () => {
    let component: MessagesComponent;

    beforeEach(() => {
        component = Object.create(MessagesComponent.prototype) as MessagesComponent;
        (component as any).localSettings = {
            timeFormat: signal('12h'),
        };
    });

    it('should format time in 12-hour format by default', () => {
        // 2024-01-15 14:30:00 UTC
        const timestamp = Math.floor(new Date(2024, 0, 15, 14, 30, 0).getTime() / 1000);
        const result = component.formatMessageTime(timestamp);
        expect(result).toBe('2:30 PM');
    });

    it('should format time in 24-hour format when setting is 24h', () => {
        (component as any).localSettings.timeFormat.set('24h');
        const timestamp = Math.floor(new Date(2024, 0, 15, 14, 30, 0).getTime() / 1000);
        const result = component.formatMessageTime(timestamp);
        expect(result).toBe('14:30');
    });

    it('should handle midnight in 12-hour format', () => {
        const timestamp = Math.floor(new Date(2024, 0, 15, 0, 5, 0).getTime() / 1000);
        const result = component.formatMessageTime(timestamp);
        expect(result).toBe('12:05 AM');
    });

    it('should handle midnight in 24-hour format', () => {
        (component as any).localSettings.timeFormat.set('24h');
        const timestamp = Math.floor(new Date(2024, 0, 15, 0, 5, 0).getTime() / 1000);
        const result = component.formatMessageTime(timestamp);
        expect(result).toBe('00:05');
    });

    it('should handle noon in 12-hour format', () => {
        const timestamp = Math.floor(new Date(2024, 0, 15, 12, 0, 0).getTime() / 1000);
        const result = component.formatMessageTime(timestamp);
        expect(result).toBe('12:00 PM');
    });

    it('should pad minutes with leading zero', () => {
        const timestamp = Math.floor(new Date(2024, 0, 15, 9, 3, 0).getTime() / 1000);
        const result = component.formatMessageTime(timestamp);
        expect(result).toBe('9:03 AM');
    });

    it('should pad hours with leading zero in 24-hour format', () => {
        (component as any).localSettings.timeFormat.set('24h');
        const timestamp = Math.floor(new Date(2024, 0, 15, 9, 3, 0).getTime() / 1000);
        const result = component.formatMessageTime(timestamp);
        expect(result).toBe('09:03');
    });
});

describe('MessagesComponent message input layout', () => {
    let component: MessagesComponent;

    beforeEach(() => {
        component = Object.create(MessagesComponent.prototype) as MessagesComponent;
    });

    it('should not force the textarea to the bottom while editing earlier text', () => {
        const textarea = document.createElement('textarea');
        textarea.value = 'A long message that spans multiple lines\n'.repeat(10);
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(0, 0);

        Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 400 });
        Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 150 });
        textarea.scrollTop = 25;

        (component as any).messageInput = { nativeElement: textarea };
        (component as any).autoResizeTextarea = vi.fn();

        (component as any).syncMessageInputLayout();

        expect((component as any).autoResizeTextarea).toHaveBeenCalled();
        expect(textarea.scrollTop).toBe(25);

        textarea.remove();
    });

    it('should keep the textarea pinned to the bottom when typing at the end', () => {
        const textarea = document.createElement('textarea');
        textarea.value = 'A long message that spans multiple lines\n'.repeat(10);
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 400 });
        Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 150 });
        textarea.scrollTop = 25;

        (component as any).messageInput = { nativeElement: textarea };
        (component as any).autoResizeTextarea = vi.fn();

        (component as any).syncMessageInputLayout();

        expect(textarea.scrollTop).toBe(400);

        textarea.remove();
    });

    it('should preserve the selection while auto-resizing a focused textarea', () => {
        const textarea = document.createElement('textarea');
        textarea.value = 'Hello long direct message';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(5, 5);

        Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 120 });

        (component as any).messageInput = { nativeElement: textarea };

        component.autoResizeTextarea();

        expect(textarea.style.height).toBe('120px');
        expect(textarea.selectionStart).toBe(5);
        expect(textarea.selectionEnd).toBe(5);

        textarea.remove();
    });

    it('should stick to bottom on focus when already near the latest message', () => {
        const wrapper = document.createElement('div');
        Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, value: 1000 });
        Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 500 });
        wrapper.scrollTop = 380;

        (component as any).messagesWrapper = { nativeElement: wrapper };
        (component as any).scrollToBottomIfNotScrolledUp = vi.fn();

        component.onMessageInputFocus();

        expect((component as any).shouldStickToBottomOnKeyboardOpen).toBe(true);
        expect((component as any).scrollToBottomIfNotScrolledUp).toHaveBeenCalled();
    });

    it('should not stick to bottom on focus when user has scrolled up', () => {
        const wrapper = document.createElement('div');
        Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, value: 1000 });
        Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 500 });
        wrapper.scrollTop = 200;

        (component as any).messagesWrapper = { nativeElement: wrapper };
        (component as any).scrollToBottomIfNotScrolledUp = vi.fn();

        component.onMessageInputFocus();

        expect((component as any).shouldStickToBottomOnKeyboardOpen).toBe(false);
        expect((component as any).scrollToBottomIfNotScrolledUp).not.toHaveBeenCalled();
    });
});

describe('MessagesComponent chat drafts', () => {
    let component: MessagesComponent;

    beforeEach(() => {
        component = createComponent();
    });

    it('should restore a saved draft when selecting a chat', async () => {
        const draftChat = {
            id: 'draft-chat',
            pubkey: 'draft-pubkey',
            unreadCount: 0,
            messages: new Map(),
            hasLegacyMessages: false,
        };

        (component as any).accountLocalState.getChatDraft.mockReturnValue('Saved draft');

        await component.selectChat(draftChat as any);

        expect((component as any).newMessageText()).toBe('Saved draft');
        expect((component as any).accountLocalState.getChatDraft).toHaveBeenCalledWith(TEST_MY_PUBKEY, 'draft-chat');
    });

    it('should clear composer text when restoring draft for null chat', () => {
        (component as any).newMessageText.set('Existing draft');

        (component as any).restoreDraftForChat(null);

        expect((component as any).newMessageText()).toBe('');
    });
});

describe('MessagesComponent chat list keyboard navigation', () => {
    function createKeyboardComponent(): {
        component: MessagesComponent;
        chats: Record<string, { id: string; pubkey: string; unreadCount: number; messages: Map<string, DirectMessage> }>;
    } {
        const component = Object.create(MessagesComponent.prototype) as MessagesComponent;
        const chats = {
            note: { id: 'note-nip44', pubkey: TEST_MY_PUBKEY, unreadCount: 0, messages: new Map<string, DirectMessage>() },
            followingA: { id: 'following-a-nip44', pubkey: 'a'.repeat(64), unreadCount: 0, messages: new Map<string, DirectMessage>() },
            followingB: { id: 'following-b-nip44', pubkey: 'b'.repeat(64), unreadCount: 0, messages: new Map<string, DirectMessage>() },
            otherA: { id: 'other-a-nip44', pubkey: 'c'.repeat(64), unreadCount: 0, messages: new Map<string, DirectMessage>() },
            otherB: { id: 'other-b-nip44', pubkey: 'd'.repeat(64), unreadCount: 0, messages: new Map<string, DirectMessage>() },
        };

        (component as any).selectedTabIndex = signal(0);
        (component as any).selectedChatId = signal(chats.followingA.id);
        (component as any).noteToSelfChat = vi.fn(() => ({ chat: chats.note }));
        (component as any).followingChats = vi.fn(() => [{ chat: chats.followingA }, { chat: chats.followingB }]);
        (component as any).otherChats = vi.fn(() => [{ chat: chats.otherA }, { chat: chats.otherB }]);
        (component as any).selectChat = vi.fn().mockResolvedValue(undefined);
        (component as any).focusChatListItem = vi.fn();

        return { component, chats };
    }

    function keyboardEvent(key: string): KeyboardEvent {
        return {
            key,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
        } as unknown as KeyboardEvent;
    }

    it('selects the next visible following chat with ArrowDown', () => {
        const { component, chats } = createKeyboardComponent();
        const event = keyboardEvent('ArrowDown');

        component.onChatListKeydown(event);

        expect((component as any).selectChat).toHaveBeenCalledWith(chats.followingB);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('includes Note to Self when navigating upward in the Following tab', () => {
        const { component, chats } = createKeyboardComponent();
        const event = keyboardEvent('ArrowUp');

        component.onChatListKeydown(event);

        expect((component as any).selectChat).toHaveBeenCalledWith(chats.note);
    });

    it('uses the visible Others tab list when that tab has focus', () => {
        const { component, chats } = createKeyboardComponent();
        (component as any).selectedTabIndex.set(1);
        (component as any).selectedChatId.set(chats.otherA.id);
        const event = keyboardEvent('ArrowDown');

        component.onChatListKeydown(event);

        expect((component as any).selectChat).toHaveBeenCalledWith(chats.otherB);
    });

    it('ignores non-arrow keys', () => {
        const { component } = createKeyboardComponent();
        const event = keyboardEvent('Enter');

        component.onChatListKeydown(event);

        expect((component as any).selectChat).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });
});

describe('MessagesComponent message render batching', () => {
    function createThreadComponent(messageCount: number): MessagesComponent {
        const component = Object.create(MessagesComponent.prototype) as MessagesComponent;

        const messages = Array.from({ length: messageCount }, (_, index) => ({
            id: `msg-${index + 1}`,
            pubkey: TEST_RECEIVER_PUBKEY,
            created_at: index + 1,
            content: `Message ${index + 1}`,
            isOutgoing: index % 2 === 0,
            tags: [],
        }));

        (component as any).MESSAGE_RENDER_BATCH_SIZE = 20;
        (component as any).selectedChatId = signal(TEST_NIP44_CHAT_ID);
        (component as any).messages = signal(messages);
        (component as any).renderedMessageCount = signal(20);
        (component as any).isReactionMessage = vi.fn().mockReturnValue(false);
        (component as any).messagesWrapper = {
            nativeElement: {
                scrollHeight: 1000,
                scrollTop: 0,
            },
        };
        (component as any).selectedChat = vi.fn().mockReturnValue({ id: TEST_NIP44_CHAT_ID });
        const renderableMessages = () => (component as any).messages().filter((message: DirectMessage) => !(component as any).isReactionMessage(message));
        (component as any).renderedThreadMessages = vi.fn(() => {
            const renderable = renderableMessages();
            const renderedCount = (component as any).renderedMessageCount();

            if (renderedCount >= renderable.length) {
                return renderable;
            }

            return renderable.slice(Math.max(0, renderable.length - renderedCount));
        });
        (component as any).expandRenderedMessageWindow = vi.fn(() => {
            const renderableCount = renderableMessages().length;
            const currentCount = (component as any).renderedMessageCount();

            if (currentCount >= renderableCount) {
                return false;
            }

            (component as any).renderedMessageCount.set(
                Math.min(renderableCount, currentCount + (component as any).MESSAGE_RENDER_BATCH_SIZE)
            );
            return true;
        });
        (component as any).hasHiddenRenderedMessages = vi.fn(() => {
            return (component as any).renderedThreadMessages().length < renderableMessages().length;
        });
        (component as any).isLoadingMore = signal(false);
        (component as any).isLoadingMoreMessages = signal(false);
        (component as any).hasMoreMessages = signal(false);
        (component as any).logger = {
            debug: vi.fn(),
            error: vi.fn(),
        };
        (component as any).error = signal(null);
        (component as any).messaging = {
            loadMoreMessages: vi.fn().mockResolvedValue([]),
        };

        return component;
    }

    it('should render only the newest 20 messages initially', () => {
        const component = createThreadComponent(55);

        const rendered = (component as any).renderedThreadMessages();

        expect(rendered).toHaveLength(20);
        expect(rendered[0].id).toBe('msg-36');
        expect(rendered[19].id).toBe('msg-55');
    });

    it('should expand the rendered window by 20 before fetching older messages', async () => {
        const component = createThreadComponent(55);

        await component.loadMoreMessages();

        expect((component as any).renderedMessageCount()).toBe(40);
        expect((component as any).messaging.loadMoreMessages).not.toHaveBeenCalled();
    });

    it('should fetch older messages after all in-memory messages are already rendered', async () => {
        const component = createThreadComponent(20);

        await component.loadMoreMessages();

        expect((component as any).messaging.loadMoreMessages).toHaveBeenCalledWith(TEST_NIP44_CHAT_ID, 0);
    });

    it('should expand the rendered window when the first message appears in a new chat', () => {
        const component = createThreadComponent(0);

        (component as any).lastRenderableMessageChatId = TEST_NIP44_CHAT_ID;
        (component as any).lastRenderableMessageCount = 0;
        (component as any).renderedMessageCount.set(0);

        const totalRenderableCount = (component as any).messages().filter((message: DirectMessage) => !(component as any).isReactionMessage(message)).length;

        if (totalRenderableCount > (component as any).lastRenderableMessageCount) {
            const newMessageCount = totalRenderableCount - (component as any).lastRenderableMessageCount;
            (component as any).renderedMessageCount.update((count: number) => Math.min(totalRenderableCount, count + newMessageCount));
        } else if (totalRenderableCount < (component as any).lastRenderableMessageCount) {
            (component as any).renderedMessageCount.update((count: number) => Math.min(count, totalRenderableCount));
        }

        expect((component as any).renderedMessageCount()).toBe(0);

        const firstMessage = {
            id: 'msg-1',
            pubkey: TEST_RECEIVER_PUBKEY,
            created_at: 1,
            content: 'First message',
            isOutgoing: true,
            tags: [],
        };

        (component as any).messages.set([firstMessage]);

        const updatedRenderableCount = (component as any).messages().filter((message: DirectMessage) => !(component as any).isReactionMessage(message)).length;

        if (updatedRenderableCount > (component as any).lastRenderableMessageCount) {
            const newMessageCount = updatedRenderableCount - (component as any).lastRenderableMessageCount;
            (component as any).renderedMessageCount.update((count: number) => Math.min(updatedRenderableCount, count + newMessageCount));
        } else if (updatedRenderableCount < (component as any).lastRenderableMessageCount) {
            (component as any).renderedMessageCount.update((count: number) => Math.min(count, updatedRenderableCount));
        }

        expect((component as any).renderedMessageCount()).toBe(1);
    });
});

describe('MessagesComponent template structure', () => {
    it('should not reference message-time-side class in template file', () => {
        // Verify old external timestamp class is no longer used
        // The template file should use message-time inside message-inline-meta instead
        const html = readFileSync(join(process.cwd(), 'src/app/pages/messages/messages.component.html'), 'utf8');
        expect(html).not.toContain('message-time-side');
        expect(html).toContain('message-time');
        expect(html).toContain('message-inline-meta');
    });

    it('should show a legacy protocol indicator in the selected chat header', () => {
        const html = readFileSync(join(process.cwd(), 'src/app/pages/messages/messages.component.html'), 'utf8');

        expect(html).toContain('legacy-protocol-indicator');
        expect(html).toContain("selectedChat()?.encryptionType === 'nip04'");
        expect(html).toContain('NIP-04');
    });
});
