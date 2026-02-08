/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { AddYouTubeChannelDialogComponent } from './add-youtube-channel-dialog.component';

function createComponent(): AddYouTubeChannelDialogComponent {
  const component = Object.create(AddYouTubeChannelDialogComponent.prototype) as AddYouTubeChannelDialogComponent;

  // Initialize signals
  (component as any).loading = signal(false);
  (component as any).error = signal('');
  (component as any).channelId = signal('');
  (component as any).channelTitle = signal('');
  (component as any).channelImage = signal('');
  (component as any).feedUrl = signal('');

  // Initialize properties
  component.channelInput = '';
  component.title = '';
  component.description = '';
  component.image = '';

  // Mock services
  (component as any).dialogRef = {
    close: jasmine.createSpy('close'),
  };
  (component as any).corsProxy = {
    fetchText: jasmine.createSpy('fetchText').and.resolveTo(''),
  };

  return component;
}

const sampleChannelHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta itemprop="channelId" content="UCxxxxNASAchannelIDxxxx">
  <meta property="og:image" content="https://yt3.googleusercontent.com/nasa-avatar.jpg">
  <meta property="og:url" content="https://www.youtube.com/channel/UCxxxxNASAchannelIDxxxx">
  <link rel="canonical" href="https://www.youtube.com/channel/UCxxxxNASAchannelIDxxxx">
</head>
<body></body>
</html>
`;

const sampleRssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>NASA</title>
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Test Video</title>
  </entry>
</feed>`;

describe('AddYouTubeChannelDialogComponent', () => {
  describe('extractChannelIdFromHtml', () => {
    it('should extract channel ID from meta itemprop="channelId"', () => {
      const component = createComponent();
      const html = '<meta itemprop="channelId" content="UC1XvxnHFtWruS9egyFasP1Q">';
      expect(component.extractChannelIdFromHtml(html)).toBe('UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should extract channel ID from canonical link', () => {
      const component = createComponent();
      const html = '<link rel="canonical" href="https://www.youtube.com/channel/UC1XvxnHFtWruS9egyFasP1Q">';
      expect(component.extractChannelIdFromHtml(html)).toBe('UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should extract channel ID from og:url meta tag', () => {
      const component = createComponent();
      const html = '<meta property="og:url" content="https://www.youtube.com/channel/UC1XvxnHFtWruS9egyFasP1Q">';
      expect(component.extractChannelIdFromHtml(html)).toBe('UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should extract channel ID from JSON data', () => {
      const component = createComponent();
      const html = '<script>var data = {"channelId":"UC1XvxnHFtWruS9egyFasP1Q"};</script>';
      expect(component.extractChannelIdFromHtml(html)).toBe('UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should extract channel ID from externalId', () => {
      const component = createComponent();
      const html = '<script>var data = {"externalId":"UC1XvxnHFtWruS9egyFasP1Q"};</script>';
      expect(component.extractChannelIdFromHtml(html)).toBe('UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should return empty string when no channel ID is found', () => {
      const component = createComponent();
      const html = '<html><body>No channel ID here</body></html>';
      expect(component.extractChannelIdFromHtml(html)).toBe('');
    });
  });

  describe('extractThumbnailFromHtml', () => {
    it('should extract thumbnail from og:image meta tag', () => {
      const component = createComponent();
      const html = '<meta property="og:image" content="https://yt3.googleusercontent.com/avatar.jpg">';
      expect(component.extractThumbnailFromHtml(html)).toBe('https://yt3.googleusercontent.com/avatar.jpg');
    });

    it('should extract thumbnail from name="og:image" variant', () => {
      const component = createComponent();
      const html = '<meta name="og:image" content="https://yt3.googleusercontent.com/avatar.jpg">';
      expect(component.extractThumbnailFromHtml(html)).toBe('https://yt3.googleusercontent.com/avatar.jpg');
    });

    it('should extract thumbnail from twitter:image', () => {
      const component = createComponent();
      const html = '<meta name="twitter:image" content="https://yt3.googleusercontent.com/avatar.jpg">';
      expect(component.extractThumbnailFromHtml(html)).toBe('https://yt3.googleusercontent.com/avatar.jpg');
    });

    it('should return empty string when no thumbnail is found', () => {
      const component = createComponent();
      const html = '<html><body>No image here</body></html>';
      expect(component.extractThumbnailFromHtml(html)).toBe('');
    });
  });

  describe('parseChannelFeed', () => {
    it('should parse channel title from RSS feed', () => {
      const component = createComponent();
      const result = component.parseChannelFeed(sampleRssFeed);
      expect(result.title).toBe('NASA');
    });

    it('should throw error for invalid XML', () => {
      const component = createComponent();
      expect(() => component.parseChannelFeed('not xml at all <>')).toThrowError('Invalid RSS feed');
    });

    it('should throw error when title is missing', () => {
      const component = createComponent();
      const xml = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';
      expect(() => component.parseChannelFeed(xml)).toThrowError('Could not find channel title in feed');
    });
  });

  describe('resolveChannelInput', () => {
    it('should handle a full feed URL', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo(sampleChannelHtml);

      const result = await component.resolveChannelInput(
        'https://www.youtube.com/feeds/videos.xml?channel_id=UC1XvxnHFtWruS9egyFasP1Q'
      );

      expect(result).toBeTruthy();
      expect(result!.channelId).toBe('UC1XvxnHFtWruS9egyFasP1Q');
      expect(result!.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should handle a channel page URL', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo(sampleChannelHtml);

      const result = await component.resolveChannelInput(
        'https://www.youtube.com/channel/UC1XvxnHFtWruS9egyFasP1Q'
      );

      expect(result).toBeTruthy();
      expect(result!.channelId).toBe('UC1XvxnHFtWruS9egyFasP1Q');
      expect(result!.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should handle a handle URL (youtube.com/@handle)', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo(sampleChannelHtml);

      const result = await component.resolveChannelInput('https://www.youtube.com/@NASA');

      expect(result).toBeTruthy();
      expect(result!.channelId).toBe('UCxxxxNASAchannelIDxxxx');
      expect(result!.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxNASAchannelIDxxxx');
      expect(result!.thumbnailUrl).toBe('https://yt3.googleusercontent.com/nasa-avatar.jpg');
    });

    it('should handle a bare @handle', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo(sampleChannelHtml);

      const result = await component.resolveChannelInput('@NASA');

      expect(result).toBeTruthy();
      expect(result!.channelId).toBe('UCxxxxNASAchannelIDxxxx');
      expect(result!.thumbnailUrl).toBe('https://yt3.googleusercontent.com/nasa-avatar.jpg');
    });

    it('should handle a plain channel ID', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo(sampleChannelHtml);

      const result = await component.resolveChannelInput('UC1XvxnHFtWruS9egyFasP1Q');

      expect(result).toBeTruthy();
      expect(result!.channelId).toBe('UC1XvxnHFtWruS9egyFasP1Q');
      expect(result!.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UC1XvxnHFtWruS9egyFasP1Q');
    });

    it('should return null and set error when handle URL cannot be resolved', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo('<html><body>Not found</body></html>');

      const result = await component.resolveChannelInput('https://www.youtube.com/@nonexistent');

      expect(result).toBeNull();
      expect(component.error()).toContain('Could not resolve YouTube handle');
    });

    it('should return null when handle URL fetch throws', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.rejectWith(new Error('Network error'));

      const result = await component.resolveChannelInput('https://www.youtube.com/@NASA');

      expect(result).toBeNull();
    });
  });

  describe('resolveHandleUrl', () => {
    it('should fetch the channel page and extract channel ID and thumbnail', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo(sampleChannelHtml);

      const result = await component.resolveHandleUrl('https://www.youtube.com/@NASA');

      expect(result).toBeTruthy();
      expect(result!.channelId).toBe('UCxxxxNASAchannelIDxxxx');
      expect(result!.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxNASAchannelIDxxxx');
      expect(result!.thumbnailUrl).toBe('https://yt3.googleusercontent.com/nasa-avatar.jpg');
      expect((component as any).corsProxy.fetchText).toHaveBeenCalledWith('https://www.youtube.com/@NASA');
    });

    it('should return null when channel ID cannot be extracted', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo('<html><body>No metadata</body></html>');

      const result = await component.resolveHandleUrl('https://www.youtube.com/@unknown');

      expect(result).toBeNull();
    });

    it('should return null on fetch error', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.rejectWith(new Error('Failed'));

      const result = await component.resolveHandleUrl('https://www.youtube.com/@NASA');

      expect(result).toBeNull();
    });
  });

  describe('fetchChannelThumbnail', () => {
    it('should fetch the channel page and extract thumbnail', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.resolveTo(sampleChannelHtml);

      const result = await component.fetchChannelThumbnail('UCxxxxNASAchannelIDxxxx');

      expect(result).toBe('https://yt3.googleusercontent.com/nasa-avatar.jpg');
      expect((component as any).corsProxy.fetchText).toHaveBeenCalledWith(
        'https://www.youtube.com/channel/UCxxxxNASAchannelIDxxxx'
      );
    });

    it('should return empty string on error', async () => {
      const component = createComponent();
      (component as any).corsProxy.fetchText.and.rejectWith(new Error('Failed'));

      const result = await component.fetchChannelThumbnail('UCxxxxNASAchannelIDxxxx');

      expect(result).toBe('');
    });
  });

  describe('fetchAndValidate', () => {
    it('should resolve handle URL and populate channel info', async () => {
      const component = createComponent();
      component.channelInput = 'https://www.youtube.com/@NASA';

      // First call returns channel page HTML, second returns RSS feed
      (component as any).corsProxy.fetchText.and.callFake((url: string) => {
        if (url.includes('@NASA')) {
          return Promise.resolve(sampleChannelHtml);
        }
        return Promise.resolve(sampleRssFeed);
      });

      await component.fetchAndValidate();

      expect(component.channelTitle()).toBe('NASA');
      expect(component.channelId()).toBe('UCxxxxNASAchannelIDxxxx');
      expect(component.channelImage()).toBe('https://yt3.googleusercontent.com/nasa-avatar.jpg');
      expect(component.title).toBe('NASA');
      expect(component.image).toBe('https://yt3.googleusercontent.com/nasa-avatar.jpg');
    });

    it('should not overwrite user-provided title', async () => {
      const component = createComponent();
      component.channelInput = '@NASA';
      component.title = 'My Custom Title';

      (component as any).corsProxy.fetchText.and.callFake((url: string) => {
        if (url.includes('@NASA')) {
          return Promise.resolve(sampleChannelHtml);
        }
        return Promise.resolve(sampleRssFeed);
      });

      await component.fetchAndValidate();

      expect(component.title).toBe('My Custom Title');
    });

    it('should not overwrite user-provided image', async () => {
      const component = createComponent();
      component.channelInput = '@NASA';
      component.image = 'https://custom-image.com/avatar.jpg';

      (component as any).corsProxy.fetchText.and.callFake((url: string) => {
        if (url.includes('@NASA')) {
          return Promise.resolve(sampleChannelHtml);
        }
        return Promise.resolve(sampleRssFeed);
      });

      await component.fetchAndValidate();

      expect(component.image).toBe('https://custom-image.com/avatar.jpg');
    });

    it('should save and close when channel title is already set', async () => {
      const component = createComponent();
      component.channelInput = '@NASA';
      component.channelTitle.set('NASA');
      component.feedUrl.set('https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxNASAchannelIDxxxx');
      component.channelId.set('UCxxxxNASAchannelIDxxxx');
      component.title = 'NASA';

      await component.fetchAndValidate();

      expect((component as any).dialogRef.close).toHaveBeenCalled();
    });

    it('should set error when resolve fails', async () => {
      const component = createComponent();
      component.channelInput = 'https://www.youtube.com/@nonexistent';

      (component as any).corsProxy.fetchText.and.resolveTo('<html><body>Not found</body></html>');

      await component.fetchAndValidate();

      expect(component.channelTitle()).toBe('');
      expect(component.error()).toBeTruthy();
    });

    it('should do nothing when input is empty', async () => {
      const component = createComponent();
      component.channelInput = '   ';

      await component.fetchAndValidate();

      expect((component as any).corsProxy.fetchText).not.toHaveBeenCalled();
    });
  });

  describe('onInputChange', () => {
    it('should reset preview and error', () => {
      const component = createComponent();
      component.channelTitle.set('Test');
      component.channelImage.set('https://example.com/img.jpg');
      component.error.set('some error');

      component.onInputChange();

      expect(component.channelTitle()).toBe('');
      expect(component.channelImage()).toBe('');
      expect(component.error()).toBe('');
    });
  });

  describe('save', () => {
    it('should close dialog with channel data', () => {
      const component = createComponent();
      component.channelTitle.set('NASA');
      component.channelId.set('UCxxxxNASAchannelIDxxxx');
      component.feedUrl.set('https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxNASAchannelIDxxxx');
      component.title = 'NASA';
      component.description = 'Space agency';
      component.image = 'https://yt3.googleusercontent.com/nasa-avatar.jpg';

      component.save();

      expect((component as any).dialogRef.close).toHaveBeenCalledWith({
        channelId: 'UCxxxxNASAchannelIDxxxx',
        feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxNASAchannelIDxxxx',
        title: 'NASA',
        description: 'Space agency',
        image: 'https://yt3.googleusercontent.com/nasa-avatar.jpg',
      });
    });

    it('should use channelTitle as fallback when title is empty', () => {
      const component = createComponent();
      component.channelTitle.set('NASA');
      component.channelId.set('UCxxxxNASAchannelIDxxxx');
      component.feedUrl.set('https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxNASAchannelIDxxxx');
      component.title = '';

      component.save();

      expect((component as any).dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ title: 'NASA' })
      );
    });

    it('should not close when channelTitle is empty', () => {
      const component = createComponent();
      component.channelTitle.set('');

      component.save();

      expect((component as any).dialogRef.close).not.toHaveBeenCalled();
    });

    it('should not close when feedUrl is empty', () => {
      const component = createComponent();
      component.channelTitle.set('NASA');
      component.feedUrl.set('');

      component.save();

      expect((component as any).dialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should close dialog without data', () => {
      const component = createComponent();
      component.cancel();
      expect((component as any).dialogRef.close).toHaveBeenCalledWith();
    });
  });
});
