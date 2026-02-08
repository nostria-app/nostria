import {
  supportsFullscreenApi,
  supportsWebkitVideoFullscreen,
  isInFullscreen,
  requestFullscreen,
  exitFullscreen,
  toggleFullscreen,
  addFullscreenChangeListener,
} from './fullscreen';

describe('Fullscreen Utilities', () => {
  let originalFullscreenEnabled: boolean;
  let originalFullscreenElement: Element | null;
  let originalExitFullscreen: () => Promise<void>;

  beforeEach(() => {
    // Save original values
    originalFullscreenEnabled = document.fullscreenEnabled;
    originalFullscreenElement = document.fullscreenElement;
    originalExitFullscreen = document.exitFullscreen;
  });

  afterEach(() => {
    // Restore original values
    Object.defineProperty(document, 'fullscreenEnabled', {
      value: originalFullscreenEnabled,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      value: originalFullscreenElement,
      writable: true,
      configurable: true,
    });
    document.exitFullscreen = originalExitFullscreen;
  });

  describe('supportsFullscreenApi', () => {
    it('should return true when fullscreenEnabled is true', () => {
      Object.defineProperty(document, 'fullscreenEnabled', {
        value: true,
        writable: true,
        configurable: true,
      });
      expect(supportsFullscreenApi()).toBe(true);
    });

    it('should return false when fullscreenEnabled is false', () => {
      Object.defineProperty(document, 'fullscreenEnabled', {
        value: false,
        writable: true,
        configurable: true,
      });
      expect(supportsFullscreenApi()).toBe(false);
    });

    it('should return false when fullscreenEnabled is undefined', () => {
      Object.defineProperty(document, 'fullscreenEnabled', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      expect(supportsFullscreenApi()).toBe(false);
    });
  });

  describe('supportsWebkitVideoFullscreen', () => {
    it('should return false for null video', () => {
      expect(supportsWebkitVideoFullscreen(null)).toBe(false);
    });

    it('should return false for undefined video', () => {
      expect(supportsWebkitVideoFullscreen(undefined)).toBe(false);
    });

    it('should return false when webkitEnterFullscreen is not available', () => {
      const video = document.createElement('video');
      expect(supportsWebkitVideoFullscreen(video)).toBe(false);
    });

    it('should return true when webkitEnterFullscreen is a function', () => {
      const video = document.createElement('video') as HTMLVideoElement & {
        webkitEnterFullscreen: () => void;
      };
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      video.webkitEnterFullscreen = () => {};
      expect(supportsWebkitVideoFullscreen(video)).toBe(true);
    });
  });

  describe('isInFullscreen', () => {
    it('should return true when document.fullscreenElement is set', () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      expect(isInFullscreen()).toBe(true);
    });

    it('should return false when no fullscreen element and no video', () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      expect(isInFullscreen()).toBe(false);
    });

    it('should return true when video has webkitDisplayingFullscreen', () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      const video = document.createElement('video') as HTMLVideoElement & {
        webkitDisplayingFullscreen: boolean;
      };
      video.webkitDisplayingFullscreen = true;
      expect(isInFullscreen(video)).toBe(true);
    });

    it('should return false when video does not have webkitDisplayingFullscreen', () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      const video = document.createElement('video');
      expect(isInFullscreen(video)).toBe(false);
    });

    it('should return true for standard fullscreen even with video param', () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      const video = document.createElement('video');
      expect(isInFullscreen(video)).toBe(true);
    });
  });

  describe('requestFullscreen', () => {
    it('should use standard API when available on container', async () => {
      const container = document.createElement('div');
      container.requestFullscreen = jasmine.createSpy('requestFullscreen')
        .and.returnValue(Promise.resolve());
      const result = await requestFullscreen(container, null);
      expect(container.requestFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should fall back to webkit when standard API fails', async () => {
      const container = document.createElement('div');
      container.requestFullscreen = jasmine.createSpy('requestFullscreen')
        .and.returnValue(Promise.reject(new Error('Not supported')));

      const video = document.createElement('video') as HTMLVideoElement & {
        webkitEnterFullscreen: () => void;
      };
      video.webkitEnterFullscreen = jasmine.createSpy('webkitEnterFullscreen');

      const result = await requestFullscreen(container, video);
      expect(container.requestFullscreen).toHaveBeenCalled();
      expect(video.webkitEnterFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should use webkit directly when container is null', async () => {
      const video = document.createElement('video') as HTMLVideoElement & {
        webkitEnterFullscreen: () => void;
      };
      video.webkitEnterFullscreen = jasmine.createSpy('webkitEnterFullscreen');

      const result = await requestFullscreen(null, video);
      expect(video.webkitEnterFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when both APIs fail', async () => {
      const container = document.createElement('div');
      container.requestFullscreen = jasmine.createSpy('requestFullscreen')
        .and.returnValue(Promise.reject(new Error('Not supported')));

      const video = document.createElement('video');
      // No webkit API on this video

      const result = await requestFullscreen(container, video);
      expect(result).toBe(false);
    });

    it('should return false when both container and video are null', async () => {
      const result = await requestFullscreen(null, null);
      expect(result).toBe(false);
    });
  });

  describe('exitFullscreen', () => {
    it('should use standard API when fullscreenElement exists', async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      document.exitFullscreen = jasmine.createSpy('exitFullscreen')
        .and.returnValue(Promise.resolve());

      const result = await exitFullscreen();
      expect(document.exitFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should use webkit exit when video is in webkit fullscreen', async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });

      const video = document.createElement('video') as HTMLVideoElement & {
        webkitDisplayingFullscreen: boolean;
        webkitExitFullscreen: () => void;
      };
      video.webkitDisplayingFullscreen = true;
      video.webkitExitFullscreen = jasmine.createSpy('webkitExitFullscreen');

      const result = await exitFullscreen(video);
      expect(video.webkitExitFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when not in any fullscreen', async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });

      const result = await exitFullscreen();
      expect(result).toBe(false);
    });
  });

  describe('toggleFullscreen', () => {
    it('should request fullscreen when not in fullscreen', async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });

      const container = document.createElement('div');
      container.requestFullscreen = jasmine.createSpy('requestFullscreen')
        .and.returnValue(Promise.resolve());

      const result = await toggleFullscreen(container, null);
      expect(container.requestFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should exit fullscreen when already in fullscreen', async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      document.exitFullscreen = jasmine.createSpy('exitFullscreen')
        .and.returnValue(Promise.resolve());

      const container = document.createElement('div');
      const result = await toggleFullscreen(container, null);
      expect(document.exitFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should exit webkit fullscreen when video is in webkit fullscreen', async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });

      const video = document.createElement('video') as HTMLVideoElement & {
        webkitDisplayingFullscreen: boolean;
        webkitExitFullscreen: () => void;
      };
      video.webkitDisplayingFullscreen = true;
      video.webkitExitFullscreen = jasmine.createSpy('webkitExitFullscreen');

      const result = await toggleFullscreen(null, video);
      expect(video.webkitExitFullscreen).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('addFullscreenChangeListener', () => {
    it('should add standard fullscreenchange listener on document', () => {
      const spy = jasmine.createSpy('onChange');
      const cleanup = addFullscreenChangeListener(null, spy);

      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new window.Event('fullscreenchange'));
      expect(spy).toHaveBeenCalledWith(true);

      spy.calls.reset();
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new window.Event('fullscreenchange'));
      expect(spy).toHaveBeenCalledWith(false);

      cleanup();
    });

    it('should add webkit event listeners on video element', () => {
      const spy = jasmine.createSpy('onChange');
      const video = document.createElement('video');
      const cleanup = addFullscreenChangeListener(video, spy);

      video.dispatchEvent(new window.Event('webkitbeginfullscreen'));
      expect(spy).toHaveBeenCalledWith(true);

      spy.calls.reset();
      video.dispatchEvent(new window.Event('webkitendfullscreen'));
      expect(spy).toHaveBeenCalledWith(false);

      cleanup();
    });

    it('should remove all listeners on cleanup', () => {
      const spy = jasmine.createSpy('onChange');
      const video = document.createElement('video');
      const cleanup = addFullscreenChangeListener(video, spy);

      cleanup();

      // After cleanup, events should not trigger the callback
      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new window.Event('fullscreenchange'));
      video.dispatchEvent(new window.Event('webkitbeginfullscreen'));
      video.dispatchEvent(new window.Event('webkitendfullscreen'));

      expect(spy).not.toHaveBeenCalled();
    });

    it('should work without video element (standard API only)', () => {
      const spy = jasmine.createSpy('onChange');
      const cleanup = addFullscreenChangeListener(undefined, spy);

      Object.defineProperty(document, 'fullscreenElement', {
        value: document.createElement('div'),
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new window.Event('fullscreenchange'));
      expect(spy).toHaveBeenCalledWith(true);

      cleanup();
    });
  });
});
