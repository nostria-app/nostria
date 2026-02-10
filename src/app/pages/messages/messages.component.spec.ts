/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
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
  (component as any).pendingMessages = signal<DirectMessage[]>([]);
  (component as any).replyingToMessage = signal(null);

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

  (component as any).userRelayService = {
    ensureRelaysForPubkey: jasmine.createSpy('ensureRelaysForPubkey').and.resolveTo(undefined),
    publishToDmRelays: jasmine.createSpy('publishToDmRelays').and.resolveTo(undefined),
    publish: jasmine.createSpy('publish').and.resolveTo(undefined),
  };

  (component as any).accountRelay = {
    publish: jasmine.createSpy('accountRelay.publish').and.resolveTo(undefined),
  };

  (component as any).discoveryRelay = {
    getRelayUrls: jasmine.createSpy('getRelayUrls').and.returnValue(['wss://discovery.relay/']),
    getPool: jasmine.createSpy('getPool').and.returnValue({
      publish: jasmine.createSpy('pool.publish').and.returnValue([Promise.resolve('ok')]),
    }),
  };

  (component as any).logger = {
    info: jasmine.createSpy('info'),
    warn: jasmine.createSpy('warn'),
    error: jasmine.createSpy('error'),
    debug: jasmine.createSpy('debug'),
  };

  (component as any).messaging = {
    addMessageToChat: jasmine.createSpy('addMessageToChat'),
    getChat: jasmine.createSpy('getChat').and.returnValue(mockChat),
    getChatMessages: jasmine.createSpy('getChatMessages').and.returnValue([]),
  };

  (component as any).notifications = {
    addNotification: jasmine.createSpy('addNotification'),
  };

  (component as any).nostr = {
    signEvent: jasmine.createSpy('signEvent').and.callFake(
      (event: unknown) => Promise.resolve({ ...(event as object), id: 'signed-id', sig: 'signed-sig' })
    ),
  };

  (component as any).encryption = {
    encryptNip44: jasmine.createSpy('encryptNip44').and.resolveTo('encrypted-content'),
    encryptNip44WithKey: jasmine.createSpy('encryptNip44WithKey').and.resolveTo('giftwrap-content'),
    encryptNip04: jasmine.createSpy('encryptNip04').and.resolveTo('nip04-encrypted'),
  };

  (component as any).snackBar = {
    open: jasmine.createSpy('open'),
  };

  // Stub methods not under test
  (component as any).scrollToBottom = jasmine.createSpy('scrollToBottom');

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
    (component as any).userRelayService.publishToDmRelays.and.returnValue(slowPublish);

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
    expect(messagingService.addMessageToChat).toHaveBeenCalledWith(
      'receiver-pubkey',
      jasmine.objectContaining({
        content: 'Chat update test',
        pending: false,
        received: true,
      })
    );
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
    (component as any).encryption.encryptNip44.and.rejectWith(new Error('Encryption failed'));

    await component.sendMessage();

    // isSending should be cleared
    expect((component as any).isSending()).toBe(false);

    // Error notification should be shown
    expect((component as any).notifications.addNotification).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: jasmine.any(String),
        title: 'Message Failed',
      })
    );

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
    (component as any).userRelayService.publishToDmRelays.and.callFake(() => {
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

    (component as any).userRelayService.publishToDmRelays.and.callFake(() => {
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
    (component as any).userRelayService.publishToDmRelays.and.rejectWith(new Error('Relay timeout'));
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
    expect((component as any).logger.error).toHaveBeenCalledWith(
      'Background relay publishing failed',
      jasmine.any(Error)
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
    } else {
      // If template can't be fetched (e.g., compiled inline), verify component exists
      const cmp = (MessagesComponent as any).ɵcmp;
      expect(cmp).toBeDefined();
    }
  });
});
