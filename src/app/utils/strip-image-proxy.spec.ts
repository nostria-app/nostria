import { stripImageProxy } from './strip-image-proxy';

describe('stripImageProxy', () => {
  it('should return empty string for empty input', () => {
    expect(stripImageProxy('')).toBe('');
  });

  it('should return the same URL for a normal image URL', () => {
    const url = 'https://example.com/image.jpg';
    expect(stripImageProxy(url)).toBe(url);
  });

  it('should not strip our own nostria proxy', () => {
    const url = 'https://proxy.eu.nostria.app/api/ImageOptimizeProxy?w=96&h=96&url=https%3A%2F%2Fexample.com%2Fimage.jpg';
    expect(stripImageProxy(url)).toBe(url);
  });

  describe('Startpage proxy', () => {
    it('should extract the original URL from Startpage proxy', () => {
      const proxyUrl = 'https://www.startpage.com/av/proxy-image?piurl=https%3A%2F%2Fc8.alamy.com%2Fcomp%2FP9GKDE%2Fimage.jpg&sp=1770414789T44fa4e6208f1b0ba5b22df7f08ce3d79023a69c4cdffa1f032c2ae6cb3fee8e3';
      expect(stripImageProxy(proxyUrl)).toBe('https://c8.alamy.com/comp/P9GKDE/image.jpg');
    });

    it('should handle Startpage proxy with complex encoded URLs', () => {
      const proxyUrl = 'https://www.startpage.com/av/proxy-image?piurl=https%3A%2F%2Flive.staticflickr.com%2F5300%2F5517451476_4abf3144b4_b.jpg&sp=1770415134Tceaa48cdecde8f8cb57280761e48c0f5e90ffa039370bf30fef0c09abf823992';
      expect(stripImageProxy(proxyUrl)).toBe('https://live.staticflickr.com/5300/5517451476_4abf3144b4_b.jpg');
    });
  });

  describe('wsrv.nl / weserv.nl proxy', () => {
    it('should extract URL from wsrv.nl', () => {
      const proxyUrl = 'https://wsrv.nl/?url=https%3A%2F%2Fexample.com%2Fimage.jpg';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/image.jpg');
    });

    it('should extract URL from images.weserv.nl', () => {
      const proxyUrl = 'https://images.weserv.nl/?url=https%3A%2F%2Fexample.com%2Fphoto.png&w=300';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/photo.png');
    });
  });

  describe('DuckDuckGo proxy', () => {
    it('should extract URL from DuckDuckGo image proxy', () => {
      const proxyUrl = 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fexample.com%2Fimage.jpg&f=1&nofb=1';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/image.jpg');
    });
  });

  describe('Qwant proxy', () => {
    it('should extract URL from Qwant image proxy', () => {
      const proxyUrl = 'https://s2.qwant.com/thumbr/0x0/9/2/abc123?u=https%3A%2F%2Fexample.com%2Fimage.jpg&q=0&b=1&p=0&a=0';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/image.jpg');
    });
  });

  describe('WordPress Photon proxy', () => {
    it('should extract URL from WordPress Photon/Jetpack CDN', () => {
      const proxyUrl = 'https://i0.wp.com/example.com/wp-content/uploads/image.jpg?resize=300,200';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/wp-content/uploads/image.jpg');
    });
  });

  describe('Cloudinary fetch proxy', () => {
    it('should extract URL from Cloudinary fetch', () => {
      const proxyUrl = 'https://res.cloudinary.com/demo/image/fetch/https://example.com/image.jpg';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/image.jpg');
    });
  });

  describe('imageproxy.io', () => {
    it('should extract URL from imageproxy.io', () => {
      const proxyUrl = 'https://imageproxy.io/https://example.com/large-image.jpg';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/large-image.jpg');
    });
  });

  describe('Generic proxy patterns', () => {
    it('should extract URL from unknown proxy with url parameter', () => {
      const proxyUrl = 'https://unknown-proxy.com/resize?url=https%3A%2F%2Fexample.com%2Fimage.jpg&width=300';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/image.jpg');
    });

    it('should extract URL from proxy with src parameter', () => {
      const proxyUrl = 'https://some-proxy.com/optimize?src=https%3A%2F%2Fexample.com%2Fphoto.png';
      expect(stripImageProxy(proxyUrl)).toBe('https://example.com/photo.png');
    });

    it('should not extract from non-proxy URLs with unrelated parameters', () => {
      const normalUrl = 'https://example.com/search?q=cats&page=2';
      expect(stripImageProxy(normalUrl)).toBe(normalUrl);
    });
  });

  describe('Real-world profile scenario', () => {
    it('should correctly extract banner URL from the reported profile', () => {
      const bannerProxy = 'https://www.startpage.com/av/proxy-image?piurl=https%3A%2F%2Fc8.alamy.com%2Fcomp%2FP9GKDE%2Fpelayo-don-737-king-of-asturias-from-718-to-73-battle-of-covadonga-pelayo-kings-troops-d-P9GKDE.jpg&sp=1770414789T44fa4e6208f1b0ba5b22df7f08ce3d79023a69c4cdffa1f032c2ae6cb3fee8e3';
      const expected = 'https://c8.alamy.com/comp/P9GKDE/pelayo-don-737-king-of-asturias-from-718-to-73-battle-of-covadonga-pelayo-kings-troops-d-P9GKDE.jpg';
      expect(stripImageProxy(bannerProxy)).toBe(expected);
    });

    it('should correctly extract picture URL from the reported profile', () => {
      const pictureProxy = 'https://www.startpage.com/av/proxy-image?piurl=https%3A%2F%2Flive.staticflickr.com%2F5300%2F5517451476_4abf3144b4_b.jpg&sp=1770415134Tceaa48cdecde8f8cb57280761e48c0f5e90ffa039370bf30fef0c09abf823992';
      const expected = 'https://live.staticflickr.com/5300/5517451476_4abf3144b4_b.jpg';
      expect(stripImageProxy(pictureProxy)).toBe(expected);
    });
  });
});
