/**
 * Cross-browser fullscreen utilities with iOS Safari fallback.
 *
 * iOS Safari does NOT support the standard Fullscreen API (`Element.requestFullscreen()`)
 * for arbitrary elements. On iOS, only `HTMLVideoElement.webkitEnterFullscreen()` works.
 *
 * These utilities detect when the standard API is unavailable and fall back to the
 * webkit video-specific API so that fullscreen works on iOS Safari / iOS WebViews.
 */

/** Extended HTMLVideoElement with webkit fullscreen API (iOS Safari) */
interface WebkitHTMLVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
}

/**
 * Whether the standard Fullscreen API is available.
 * On iOS Safari this is false for arbitrary elements.
 */
export function supportsFullscreenApi(): boolean {
  return typeof document.fullscreenEnabled !== 'undefined' && document.fullscreenEnabled;
}

/**
 * Whether iOS webkit video fullscreen is available on a given video element.
 */
export function supportsWebkitVideoFullscreen(video: HTMLVideoElement | undefined | null): boolean {
  if (!video) return false;
  const webkitVideo = video as WebkitHTMLVideoElement;
  return typeof webkitVideo.webkitEnterFullscreen === 'function';
}

/**
 * Check if something is currently in fullscreen (standard or webkit).
 */
export function isInFullscreen(video?: HTMLVideoElement | null): boolean {
  if (document.fullscreenElement) {
    return true;
  }
  if (video) {
    const webkitVideo = video as WebkitHTMLVideoElement;
    return !!webkitVideo.webkitDisplayingFullscreen;
  }
  return false;
}

/**
 * Request fullscreen on a container element, falling back to webkit video
 * fullscreen on iOS Safari.
 *
 * @param container The element to make fullscreen (standard API)
 * @param video The video element to use as fallback (iOS webkit API)
 * @returns true if fullscreen was requested successfully
 */
export async function requestFullscreen(
  container: Element | null | undefined,
  video: HTMLVideoElement | null | undefined
): Promise<boolean> {
  // Try standard API first
  if (container && typeof container.requestFullscreen === 'function') {
    try {
      await container.requestFullscreen();
      return true;
    } catch {
      // Standard API failed, try webkit fallback
    }
  }

  // Fallback: iOS webkit video fullscreen
  if (video && supportsWebkitVideoFullscreen(video)) {
    const webkitVideo = video as WebkitHTMLVideoElement;
    try {
      webkitVideo.webkitEnterFullscreen!();
      return true;
    } catch {
      // Webkit fullscreen also failed
    }
  }

  return false;
}

/**
 * Exit fullscreen (standard or webkit).
 */
export async function exitFullscreen(video?: HTMLVideoElement | null): Promise<boolean> {
  // Try standard API
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
      return true;
    } catch {
      // Failed to exit
    }
  }

  // Try webkit exit
  if (video) {
    const webkitVideo = video as WebkitHTMLVideoElement;
    if (webkitVideo.webkitDisplayingFullscreen && typeof webkitVideo.webkitExitFullscreen === 'function') {
      try {
        webkitVideo.webkitExitFullscreen();
        return true;
      } catch {
        // Failed to exit
      }
    }
  }

  return false;
}

/**
 * Toggle fullscreen state.
 *
 * @param container The element to make fullscreen (standard API)
 * @param video The video element (used for iOS fallback and state check)
 * @returns true if the toggle was handled
 */
export async function toggleFullscreen(
  container: Element | null | undefined,
  video: HTMLVideoElement | null | undefined
): Promise<boolean> {
  if (isInFullscreen(video)) {
    return exitFullscreen(video);
  }
  return requestFullscreen(container, video);
}

/**
 * Add fullscreen change event listeners that work across browsers.
 * On iOS Safari, listens for `webkitbeginfullscreen` and `webkitendfullscreen`
 * on the video element since the standard `fullscreenchange` event doesn't fire.
 *
 * @param video The video element to listen on (for webkit events)
 * @param onChange Callback with the current fullscreen state
 * @returns Cleanup function to remove all listeners
 */
export function addFullscreenChangeListener(
  video: HTMLVideoElement | null | undefined,
  onChange: (isFullscreen: boolean) => void
): () => void {
  const cleanups: (() => void)[] = [];

  // Standard fullscreenchange on document (works on desktop, Android)
  const standardHandler = () => {
    onChange(!!document.fullscreenElement);
  };
  document.addEventListener('fullscreenchange', standardHandler);
  cleanups.push(() => document.removeEventListener('fullscreenchange', standardHandler));

  // iOS webkit events on video element
  if (video) {
    const beginHandler = () => onChange(true);
    const endHandler = () => onChange(false);

    video.addEventListener('webkitbeginfullscreen', beginHandler);
    video.addEventListener('webkitendfullscreen', endHandler);
    cleanups.push(() => {
      video.removeEventListener('webkitbeginfullscreen', beginHandler);
      video.removeEventListener('webkitendfullscreen', endHandler);
    });
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
