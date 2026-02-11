/**
 * Utility to strip known third-party image proxy/optimization services from URLs,
 * extracting the original image URL. This ensures we load images directly or through
 * our own proxy rather than through defunct or untrusted third-party services.
 */

/**
 * Known image proxy services and how to extract the original URL from them.
 * Each entry has a pattern to match the proxy URL and an extractor function.
 */
interface ProxyPattern {
  /** Test if a URL belongs to this proxy service */
  match: (url: string) => boolean;
  /** Extract the original image URL from the proxy URL */
  extract: (url: string) => string | null;
}

const PROXY_PATTERNS: ProxyPattern[] = [
  // Startpage image proxy
  // Example: https://www.startpage.com/av/proxy-image?piurl=https%3A%2F%2Fexample.com%2Fimage.jpg&sp=...
  {
    match: (url) => url.includes('startpage.com/av/proxy-image'),
    extract: (url) => extractQueryParam(url, 'piurl'),
  },

  // Google Image proxy (various forms)
  // Example: https://images.google.com/proxy?url=https%3A%2F%2Fexample.com%2Fimage.jpg
  {
    match: (url) => url.includes('google.com/proxy') || url.includes('googleusercontent.com/proxy'),
    extract: (url) => extractQueryParam(url, 'url'),
  },

  // Imageproxy.io
  // Example: https://imageproxy.io/https://example.com/image.jpg
  {
    match: (url) => url.includes('imageproxy.io/'),
    extract: (url) => extractPathUrl(url, 'imageproxy.io/'),
  },

  // wsrv.nl (formerly images.weserv.nl)
  // Example: https://wsrv.nl/?url=https%3A%2F%2Fexample.com%2Fimage.jpg
  // Example: https://images.weserv.nl/?url=https%3A%2F%2Fexample.com%2Fimage.jpg
  {
    match: (url) => url.includes('wsrv.nl') || url.includes('weserv.nl'),
    extract: (url) => extractQueryParam(url, 'url'),
  },

  // Cloudinary fetch
  // Example: https://res.cloudinary.com/demo/image/fetch/https://example.com/image.jpg
  {
    match: (url) => url.includes('cloudinary.com') && url.includes('/image/fetch/'),
    extract: (url) => {
      const fetchIndex = url.indexOf('/image/fetch/');
      if (fetchIndex === -1) return null;
      return url.substring(fetchIndex + '/image/fetch/'.length);
    },
  },

  // Imgproxy
  // Example: https://imgproxy.example.com/unsafe/plain/https://example.com/image.jpg
  {
    match: (url) => url.includes('/unsafe/') && url.includes('/plain/'),
    extract: (url) => {
      const plainIndex = url.indexOf('/plain/');
      if (plainIndex === -1) return null;
      const afterPlain = url.substring(plainIndex + '/plain/'.length);
      // Remove any processing options after @
      const atIndex = afterPlain.indexOf('@');
      return atIndex === -1 ? afterPlain : afterPlain.substring(0, atIndex);
    },
  },

  // DuckDuckGo image proxy
  // Example: https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fexample.com%2Fimage.jpg
  {
    match: (url) => url.includes('duckduckgo.com/iu/'),
    extract: (url) => extractQueryParam(url, 'u'),
  },

  // Qwant image proxy
  // Example: https://s2.qwant.com/thumbr/...?u=https%3A%2F%2Fexample.com%2Fimage.jpg
  {
    match: (url) => url.includes('qwant.com/thumbr'),
    extract: (url) => extractQueryParam(url, 'u'),
  },

  // WordPress Photon / Jetpack CDN
  // Example: https://i0.wp.com/example.com/image.jpg
  {
    match: (url) => /i\d\.wp\.com\//.test(url),
    extract: (url) => {
      const wpMatch = url.match(/https?:\/\/i\d\.wp\.com\/(.*?)(?:\?.*)?$/);
      if (!wpMatch) return null;
      const path = wpMatch[1];
      // The path after wp.com is the original domain + path
      return `https://${path}`;
    },
  },

  // Nitter / Invidious image proxies (generic pattern)
  // Example: https://nitter.net/pic/media%2Fimage.jpg
  {
    match: (url) => url.includes('nitter.') && url.includes('/pic/'),
    extract: (url) => {
      const picIndex = url.indexOf('/pic/');
      if (picIndex === -1) return null;
      const encoded = url.substring(picIndex + '/pic/'.length);
      try {
        return decodeURIComponent(encoded);
      } catch {
        return null;
      }
    },
  },

  // Generic proxy pattern: any URL with a 'url' or 'src' or 'image' query parameter
  // containing an encoded http(s) URL. This is a catch-all for unknown proxies.
  {
    match: (url) => {
      try {
        const urlObj = new URL(url);
        for (const [, value] of urlObj.searchParams) {
          if (value.startsWith('http://') || value.startsWith('https://')) {
            return true;
          }
        }
        // Check for encoded URLs in common proxy params
        for (const param of ['url', 'src', 'image', 'img', 'source']) {
          const val = urlObj.searchParams.get(param);
          if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
            return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    },
    extract: (url) => {
      try {
        const urlObj = new URL(url);
        // Try common parameter names first
        for (const param of ['url', 'src', 'image', 'img', 'source']) {
          const val = urlObj.searchParams.get(param);
          if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
            return val;
          }
        }
        // Fall back to any parameter with an HTTP URL value
        for (const [, value] of urlObj.searchParams) {
          if (value.startsWith('http://') || value.startsWith('https://')) {
            return value;
          }
        }
        return null;
      } catch {
        return null;
      }
    },
  },
];

/**
 * Helper: extract a query parameter value from a URL and decode it
 */
function extractQueryParam(url: string, param: string): string | null {
  try {
    const urlObj = new URL(url);
    const value = urlObj.searchParams.get(param);
    if (!value) return null;
    // The value is already decoded by URLSearchParams
    return value;
  } catch {
    return null;
  }
}

/**
 * Helper: extract a URL embedded in the path after a known prefix
 */
function extractPathUrl(url: string, prefix: string): string | null {
  const idx = url.indexOf(prefix);
  if (idx === -1) return null;
  const afterPrefix = url.substring(idx + prefix.length);
  // The remaining path should be the original URL
  if (afterPrefix.startsWith('http://') || afterPrefix.startsWith('https://')) {
    return afterPrefix;
  }
  return null;
}

/**
 * Strip known third-party image proxy services from a URL.
 * Returns the original image URL if a proxy was detected, or the input URL unchanged.
 *
 * @param url The image URL that may be wrapped in a proxy service
 * @returns The unwrapped original image URL
 */
export function stripImageProxy(url: string): string {
  if (!url) return url;

  // Don't strip our own proxy
  if (url.includes('nostria.app/api/')) {
    return url;
  }

  for (const pattern of PROXY_PATTERNS) {
    if (pattern.match(url)) {
      const extracted = pattern.extract(url);
      if (extracted && (extracted.startsWith('http://') || extracted.startsWith('https://'))) {
        return extracted;
      }
    }
  }

  return url;
}
