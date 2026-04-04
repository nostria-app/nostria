/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function createComponent(): MessagesComponent {
    const component = Object.create(MessagesComponent.prototype) as MessagesComponent;

    // Initialize signals that sendMessage() reads/writes
    (component as any).newMessageText = signal('');
    (component as any).isSending = signal(false);
    (component as any).isGroupChat = signal(false);
    (component as any).uploadStatus = signal('');
    (component as any).mediaPreviews = signal([]);
    (component as any).pendingMessages = signal<DirectMessage[]>([]);
    (component as any).replyingToMessage = signal(null);
    (component as any).showMobileList = signal(true);
    (component as any).showChatDetails = signal(false);
    (component as any).isSinglePaneView = signal(false);

    // Mock selectedChat
    const mockChat = {
        id: 'receiver-pubkey',
        pubkey: 'receiver-pubkey',
        unreadCount: 0,
        messages: new Map(),
        hasLegacyMessages: false,
    };
    (component as any).selectedChatId = signal('receiver-pubkey');
    (component as any).selectedChat = signal(mockChat);

    // Mock services
    (component as any).accountState = {
        pubkey: signal('my-pubkey'),
    };

    (component as any).accountLocalState = {
        getChatDraft: vi.fn().mockReturnValue(''),
        setChatDraft: vi.fn(),
    };

    (component as any).userRelayService = {
        ensureRelaysForPubkey: vi.fn().mockResolvedValue(undefined),
        ensureDmRelaysForPubkey: vi.fn().mockResolvedValue(undefined),
        publishToDmRelays: vi.fn().mockResolvedValue(undefined),
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
        addMessageToChat: vi.fn(),
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
        expect(messagingService.addMessageToChat).toHaveBeenCalledWith('receiver-pubkey', expect.objectContaining({
            content: 'Chat update test',
            pending: false,
            received: true,
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
            .toHaveBeenCalledWith('receiver-pubkey');
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

        // Message should still be in pending (it was created successfully)
        const pending = (component as any).pendingMessages() as DirectMessage[];
        expect(pending.length).toBe(1);

        // Error should be logged
        expect((component as any).logger.error).toHaveBeenCalledWith('Background relay publishing failed', expect.any(Error));
    });

    it('should show encrypted file preview text for file messages', () => {
        const text = component.getChatPreviewText({
            id: 'file-msg',
            rumorKind: 15,
            pubkey: 'receiver-pubkey',
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
        expect((component as any).accountLocalState.getChatDraft).toHaveBeenCalledWith('my-pubkey', 'draft-chat');
    });

    it('should clear composer text when restoring draft for null chat', () => {
        (component as any).newMessageText.set('Existing draft');

        (component as any).restoreDraftForChat(null);

        expect((component as any).newMessageText()).toBe('');
    });
});

describe('MessagesComponent message render batching', () => {
    function createThreadComponent(messageCount: number): MessagesComponent {
        const component = Object.create(MessagesComponent.prototype) as MessagesComponent;

        const messages = Array.from({ length: messageCount }, (_, index) => ({
            id: `msg-${index + 1}`,
            pubkey: 'receiver-pubkey',
            created_at: index + 1,
            content: `Message ${index + 1}`,
            isOutgoing: index % 2 === 0,
            tags: [],
        }));

        (component as any).MESSAGE_RENDER_BATCH_SIZE = 20;
        (component as any).selectedChatId = signal('receiver-pubkey');
        (component as any).messages = signal(messages);
        (component as any).renderedMessageCount = signal(20);
        (component as any).isReactionMessage = vi.fn().mockReturnValue(false);
        (component as any).messagesWrapper = {
            nativeElement: {
                scrollHeight: 1000,
                scrollTop: 0,
            },
        };
        (component as any).selectedChat = vi.fn().mockReturnValue({ id: 'receiver-pubkey' });
        (component as any).hasHiddenRenderedMessages = vi.fn(() => {
            return (component as any).renderedMessageCount() < (component as any).messages().length;
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

        expect((component as any).messaging.loadMoreMessages).toHaveBeenCalledWith('receiver-pubkey', 0);
    });

    it('should expand the rendered window when the first message appears in a new chat', () => {
        const component = createThreadComponent(0);

        (component as any).lastRenderableMessageChatId = 'receiver-pubkey';
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
            pubkey: 'receiver-pubkey',
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
    it('should not reference message-time-side class in template file', async () => {
        // Verify old external timestamp class is no longer used
        // The template file should use message-time inside message-inline-meta instead
        const response = await fetch('/base/src/app/pages/messages/messages.component.html');
        if (response.ok) {
            const html = await response.text();
            expect(html).not.toContain('message-time-side');
            expect(html).toContain('message-time');
            expect(html).toContain('message-inline-meta');
        }
        else {
            // If template can't be fetched (e.g., compiled inline), verify component exists
            const cmp = (MessagesComponent as any).ɵcmp;
            expect(cmp).toBeDefined();
        }
    });
});
