/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { YouTubeChannelVideosComponent } from './youtube-channel-videos.component';

function createComponent(): YouTubeChannelVideosComponent {
  const component = Object.create(YouTubeChannelVideosComponent.prototype) as YouTubeChannelVideosComponent;

  // Initialize signals
  (component as any).channelTitle = signal('Test Channel');
  (component as any).videos = signal<any[]>([]);
  (component as any).loading = signal(false);
  (component as any).error = signal<string | null>(null);

  // Initialize private fields
  (component as any).channelId = 'UC123';
  (component as any).feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UC123';

  // Mock services
  (component as any).route = {
    snapshot: {
      paramMap: {
        get: jasmine.createSpy('get').and.returnValue('UC123'),
      },
    },
  };
  (component as any).corsProxy = {
    fetchText: jasmine.createSpy('fetchText').and.resolveTo(''),
  };
  (component as any).mediaPlayer = {
    play: jasmine.createSpy('play'),
    enque: jasmine.createSpy('enque'),
  };
  (component as any).logger = {
    error: jasmine.createSpy('error'),
  };
  (component as any).snackBar = {
    open: jasmine.createSpy('open'),
  };
  (component as any).panelNav = {
    goBackRight: jasmine.createSpy('goBackRight'),
  };

  return component;
}

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <title>Test Video 1</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <published>2024-01-15T12:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"/>
      <media:description>A test video</media:description>
      <media:community>
        <media:statistics views="1234567"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Test Video 2</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <published>2024-02-20T08:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg"/>
      <media:description>Another test video</media:description>
      <media:community>
        <media:statistics views="500"/>
      </media:community>
    </media:group>
  </entry>
</feed>`;

describe('YouTubeChannelVideosComponent', () => {
  describe('formatViews', () => {
    it('should format millions', () => {
      const component = createComponent();
      expect(component.formatViews(1_234_567)).toBe('1.2M');
    });

    it('should format thousands', () => {
      const component = createComponent();
      expect(component.formatViews(45_600)).toBe('45.6K');
    });

    it('should show exact count for small numbers', () => {
      const component = createComponent();
      expect(component.formatViews(999)).toBe('999');
    });

    it('should handle zero', () => {
      const component = createComponent();
      expect(component.formatViews(0)).toBe('0');
    });

    it('should format exactly 1000 as K', () => {
      const component = createComponent();
      expect(component.formatViews(1000)).toBe('1.0K');
    });

    it('should format exactly 1 million as M', () => {
      const component = createComponent();
      expect(component.formatViews(1_000_000)).toBe('1.0M');
    });
  });

  describe('playNow', () => {
    it('should create a media item and call mediaPlayer.play', () => {
      const component = createComponent();

      const video = {
        videoId: 'dQw4w9WgXcQ',
        title: 'Test Video',
        link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        published: new Date('2024-01-15'),
        thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        description: 'A test video',
        views: 1000,
        channelTitle: 'Test Channel',
        channelId: 'UC123',
      };

      component.playNow(video);

      expect((component as any).mediaPlayer.play).toHaveBeenCalledWith({
        artwork: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        title: 'Test Video',
        artist: 'Test Channel',
        source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        type: 'YouTube',
      });
      expect((component as any).snackBar.open).toHaveBeenCalledWith(
        'Playing in media player', 'Close', { duration: 2000 }
      );
    });
  });

  describe('addToQueue', () => {
    it('should create a media item and call mediaPlayer.enque', () => {
      const component = createComponent();

      const video = {
        videoId: 'abc123',
        title: 'Queue Video',
        link: 'https://www.youtube.com/watch?v=abc123',
        published: new Date('2024-02-20'),
        thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
        description: 'Queue test',
        views: 500,
        channelTitle: 'Test Channel',
        channelId: 'UC123',
      };

      component.addToQueue(video);

      expect((component as any).mediaPlayer.enque).toHaveBeenCalledWith({
        artwork: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
        title: 'Queue Video',
        artist: 'Test Channel',
        source: 'https://www.youtube.com/watch?v=abc123',
        type: 'YouTube',
      });
      expect((component as any).snackBar.open).toHaveBeenCalledWith(
        'Added to queue', 'Close', { duration: 2000 }
      );
    });
  });

  describe('goBack', () => {
    it('should call panelNav.goBackRight', () => {
      const component = createComponent();

      component.goBack();

      expect((component as any).panelNav.goBackRight).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should call fetchVideos when feedUrl is set', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo('<feed></feed>');

      component.refresh();

      expect((component as any).corsProxy.fetchText).toHaveBeenCalledWith(
        'https://www.youtube.com/feeds/videos.xml?channel_id=UC123'
      );
    });

    it('should not call fetchVideos when feedUrl is empty', () => {
      const component = createComponent();
      (component as any).feedUrl = '';

      component.refresh();

      expect((component as any).corsProxy.fetchText).not.toHaveBeenCalled();
    });
  });

  describe('parseRssFeed', () => {
    it('should parse entries from YouTube RSS feed XML', () => {
      const component = createComponent();

      const videos = (component as any).parseRssFeed(sampleXml, 'Test Channel', 'UC123');

      expect(videos.length).toBe(2);
      expect(videos[0].videoId).toBe('dQw4w9WgXcQ');
      expect(videos[0].title).toBe('Test Video 1');
      expect(videos[0].channelTitle).toBe('Test Channel');
      expect(videos[0].channelId).toBe('UC123');
      expect(videos[1].videoId).toBe('abc123');
      expect(videos[1].title).toBe('Test Video 2');
    });

    it('should skip entries without videoId', () => {
      const component = createComponent();

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <title>No ID Video</title>
  </entry>
</feed>`;

      const videos = (component as any).parseRssFeed(xml, 'Test', 'UC1');

      expect(videos.length).toBe(0);
    });

    it('should handle empty feed', () => {
      const component = createComponent();

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed></feed>`;

      const videos = (component as any).parseRssFeed(xml, 'Test', 'UC1');

      expect(videos.length).toBe(0);
    });

    it('should fallback to ytimg thumbnail when none in feed', () => {
      const component = createComponent();

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <yt:videoId>xyz789</yt:videoId>
    <title>No Thumb Video</title>
  </entry>
</feed>`;

      const videos = (component as any).parseRssFeed(xml, 'Test', 'UC1');

      expect(videos.length).toBe(1);
      expect(videos[0].thumbnail).toBe('https://i.ytimg.com/vi/xyz789/hqdefault.jpg');
    });
  });
});
