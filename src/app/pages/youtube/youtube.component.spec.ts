/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { YouTubeComponent } from './youtube.component';
import { Event } from 'nostr-tools';

// Re-declare interfaces locally since they're not exported
interface YouTubeChannelEntry {
  channelId: string;
  title: string;
  description: string;
  image: string;
  feedUrl: string;
}

interface YouTubeChannel extends YouTubeChannelEntry {
  videos: unknown[];
  loading: boolean;
  error?: string;
}

function createComponent(): YouTubeComponent {
  const component = Object.create(YouTubeComponent.prototype) as YouTubeComponent;

  // Initialize signals
  (component as any).loading = signal(true);
  (component as any).channels = signal<YouTubeChannel[]>([]);
  (component as any).channelEntries = signal<YouTubeChannelEntry[]>([]);
  (component as any).currentVideo = signal(null);
  (component as any).collapsedChannels = signal(new Set<string>());

  // Mock services
  (component as any).accountState = {
    pubkey: signal('test-pubkey'),
    subscription: signal({ expires: Date.now() + 100000 }),
  };
  (component as any).accountRelay = {
    getMany: jasmine.createSpy('getMany').and.resolveTo([]),
    publish: jasmine.createSpy('publish').and.resolveTo([]),
  };
  (component as any).corsProxy = {
    fetchText: jasmine.createSpy('fetchText').and.resolveTo(''),
  };
  (component as any).nostrService = {
    createEvent: jasmine.createSpy('createEvent').and.callFake(
      (kind: number, content: string, tags: string[][]) => ({
        kind,
        content,
        tags,
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
      })
    ),
    signEvent: jasmine.createSpy('signEvent').and.callFake(
      (event: unknown) => Promise.resolve({ ...(event as object), id: 'signed-id', sig: 'signed-sig' })
    ),
  };
  (component as any).mediaPlayer = {
    play: jasmine.createSpy('play'),
    enque: jasmine.createSpy('enque'),
  };
  (component as any).layout = {
    scrollToTop: jasmine.createSpy('scrollToTop'),
  };
  (component as any).dialog = {
    open: jasmine.createSpy('open'),
  };
  (component as any).snackBar = {
    open: jasmine.createSpy('open'),
  };
  (component as any).sanitizer = {
    bypassSecurityTrustResourceUrl: jasmine.createSpy('bypassSecurityTrustResourceUrl')
      .and.callFake((url: string) => url),
  };
  (component as any).app = {
    authenticated: signal(true),
  };

  return component;
}

function makeYouTubeEvent(entries: YouTubeChannelEntry[]): Event {
  return {
    id: 'event-id',
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: 'test-pubkey',
    content: JSON.stringify(entries),
    tags: [['d', 'youtube-channels']],
    sig: 'sig',
  };
}

const sampleEntry: YouTubeChannelEntry = {
  channelId: 'UC1XvxnHFtWruS9egyFasP1Q',
  title: 'Test Channel',
  description: 'A test channel',
  image: 'https://example.com/avatar.jpg',
  feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1XvxnHFtWruS9egyFasP1Q',
};

const secondEntry: YouTubeChannelEntry = {
  channelId: 'UC2YvxnHFtWruS9egyFasP2R',
  title: 'Second Channel',
  description: 'Another channel',
  image: 'https://example.com/avatar2.jpg',
  feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC2YvxnHFtWruS9egyFasP2R',
};

describe('YouTubeComponent', () => {
  describe('loadYouTubeBookmarks', () => {
    it('should load channels from a kind 30078 event', async () => {
      const component = createComponent();
      const event = makeYouTubeEvent([sampleEntry, secondEntry]);

      (component as any).accountRelay.getMany.and.resolveTo([event]);
      (component as any).corsProxy.fetchText.and.resolveTo('<feed></feed>');

      await component.loadYouTubeBookmarks();

      expect((component as any).accountRelay.getMany).toHaveBeenCalledWith({
        kinds: [30078],
        authors: ['test-pubkey'],
        '#d': ['youtube-channels'],
      });
      expect(component.channels().length).toBe(2);
      expect(component.channels()[0].channelId).toBe('UC1XvxnHFtWruS9egyFasP1Q');
      expect(component.channels()[0].title).toBe('Test Channel');
      expect(component.channels()[1].channelId).toBe('UC2YvxnHFtWruS9egyFasP2R');
      expect(component.channels()[1].title).toBe('Second Channel');
    });

    it('should set empty channels when no events are found', async () => {
      const component = createComponent();

      (component as any).accountRelay.getMany.and.resolveTo([]);

      await component.loadYouTubeBookmarks();

      expect(component.channels().length).toBe(0);
      expect((component as any).channelEntries().length).toBe(0);
    });

    it('should use the most recent event when multiple exist', async () => {
      const component = createComponent();

      const olderEvent = makeYouTubeEvent([sampleEntry]);
      olderEvent.created_at = 1000;

      const newerEvent = makeYouTubeEvent([sampleEntry, secondEntry]);
      newerEvent.created_at = 2000;

      (component as any).accountRelay.getMany.and.resolveTo([olderEvent, newerEvent]);
      (component as any).corsProxy.fetchText.and.resolveTo('<feed></feed>');

      await component.loadYouTubeBookmarks();

      expect(component.channels().length).toBe(2);
    });

    it('should handle invalid JSON content gracefully', async () => {
      const component = createComponent();

      const event: Event = {
        id: 'event-id',
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: 'test-pubkey',
        content: 'not valid json',
        tags: [['d', 'youtube-channels']],
        sig: 'sig',
      };

      (component as any).accountRelay.getMany.and.resolveTo([event]);

      await component.loadYouTubeBookmarks();

      expect(component.channels().length).toBe(0);
    });
  });

  describe('removeChannel', () => {
    it('should remove a channel from the list', async () => {
      const component = createComponent();
      (component as any).channelEntries.set([sampleEntry, secondEntry]);
      (component as any).channels.set([
        { ...sampleEntry, videos: [], loading: false },
        { ...secondEntry, videos: [], loading: false },
      ]);

      await component.removeChannel('UC1XvxnHFtWruS9egyFasP1Q');

      expect(component.channels().length).toBe(1);
      expect(component.channels()[0].channelId).toBe('UC2YvxnHFtWruS9egyFasP2R');
      expect((component as any).channelEntries().length).toBe(1);
    });

    it('should publish a kind 30078 event when removing a channel', async () => {
      const component = createComponent();
      (component as any).channelEntries.set([sampleEntry, secondEntry]);
      (component as any).channels.set([
        { ...sampleEntry, videos: [], loading: false },
        { ...secondEntry, videos: [], loading: false },
      ]);

      await component.removeChannel('UC1XvxnHFtWruS9egyFasP1Q');

      expect((component as any).nostrService.createEvent).toHaveBeenCalledWith(
        30078,
        JSON.stringify([secondEntry]),
        [['d', 'youtube-channels']]
      );
      expect((component as any).nostrService.signEvent).toHaveBeenCalled();
      expect((component as any).accountRelay.publish).toHaveBeenCalled();
    });

    it('should show snackbar message on successful removal', async () => {
      const component = createComponent();
      (component as any).channelEntries.set([sampleEntry]);
      (component as any).channels.set([
        { ...sampleEntry, videos: [], loading: false },
      ]);

      await component.removeChannel('UC1XvxnHFtWruS9egyFasP1Q');

      expect((component as any).snackBar.open).toHaveBeenCalledWith(
        'YouTube channel removed.', 'Close', { duration: 3000 }
      );
    });

    it('should show error snackbar when removal fails', async () => {
      const component = createComponent();
      (component as any).channelEntries.set([sampleEntry]);
      (component as any).channels.set([
        { ...sampleEntry, videos: [], loading: false },
      ]);
      (component as any).nostrService.signEvent.and.rejectWith(new Error('Sign failed'));

      await component.removeChannel('UC1XvxnHFtWruS9egyFasP1Q');

      expect((component as any).snackBar.open).toHaveBeenCalledWith(
        'Failed to remove channel. Please try again.', 'Close', { duration: 3000 }
      );
    });
  });

  describe('publishYouTubeEvent', () => {
    it('should create a kind 30078 event with d-tag youtube-channels', async () => {
      const component = createComponent();

      await (component as any).publishYouTubeEvent([sampleEntry]);

      expect((component as any).nostrService.createEvent).toHaveBeenCalledWith(
        30078,
        JSON.stringify([sampleEntry]),
        [['d', 'youtube-channels']]
      );
    });

    it('should sign and publish the event', async () => {
      const component = createComponent();

      await (component as any).publishYouTubeEvent([sampleEntry]);

      expect((component as any).nostrService.signEvent).toHaveBeenCalled();
      expect((component as any).accountRelay.publish).toHaveBeenCalled();
    });

    it('should throw when signing fails', async () => {
      const component = createComponent();
      (component as any).nostrService.signEvent.and.resolveTo(null);

      await expectAsync(
        (component as any).publishYouTubeEvent([sampleEntry])
      ).toBeRejectedWithError('Failed to sign event');
    });
  });

  describe('toggleChannel', () => {
    it('should collapse a channel', () => {
      const component = createComponent();

      component.toggleChannel('channel-1');

      expect(component.isChannelCollapsed('channel-1')).toBe(true);
    });

    it('should expand a collapsed channel', () => {
      const component = createComponent();

      component.toggleChannel('channel-1');
      component.toggleChannel('channel-1');

      expect(component.isChannelCollapsed('channel-1')).toBe(false);
    });
  });

  describe('formatViews', () => {
    it('should format millions', () => {
      const component = createComponent();
      expect(component.formatViews(1500000)).toBe('1.5M');
    });

    it('should format thousands', () => {
      const component = createComponent();
      expect(component.formatViews(1500)).toBe('1.5K');
    });

    it('should return raw number for small values', () => {
      const component = createComponent();
      expect(component.formatViews(999)).toBe('999');
    });
  });

  describe('createYouTubeBookmarkSet (add channel)', () => {
    it('should add a new channel to existing entries', async () => {
      const component = createComponent();
      (component as any).channelEntries.set([sampleEntry]);
      (component as any).accountRelay.getMany.and.resolveTo([
        makeYouTubeEvent([sampleEntry, secondEntry]),
      ]);
      (component as any).corsProxy.fetchText.and.resolveTo('<feed></feed>');

      await (component as any).createYouTubeBookmarkSet({
        channelId: secondEntry.channelId,
        feedUrl: secondEntry.feedUrl,
        title: secondEntry.title,
        description: secondEntry.description,
        image: secondEntry.image,
      });

      // Verify the event was published with both entries
      expect((component as any).nostrService.createEvent).toHaveBeenCalledWith(
        30078,
        JSON.stringify([sampleEntry, secondEntry]),
        [['d', 'youtube-channels']]
      );
      expect((component as any).snackBar.open).toHaveBeenCalledWith(
        'YouTube channel added!', 'Close', { duration: 3000 }
      );
    });
  });
});
