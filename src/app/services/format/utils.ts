export const isImageUrl = (url: string): boolean => {
  if (!url) return false;

  // Remove query parameters and fragments for extension check
  const urlWithoutParams = url.split('?')[0].split('#')[0];

  // Common image extensions
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif|heic|heif)$/i;

  // Check file extension
  if (imageExtensions.test(urlWithoutParams)) {
    return true;
  }

  // Check for common image hosting patterns and CDNs
  const imageHostPatterns = [
    /imgur\.com\/\w+$/i,
    /i\.imgur\.com/i,
    /images\.unsplash\.com/i,
    /unsplash\.com\/photos/i,
    /cdn\.pixabay\.com/i,
    /pexels\.com\/photo/i,
    /flickr\.com\/.*\.(jpg|jpeg|png|gif)/i,
    /githubusercontent\.com.*\.(jpg|jpeg|png|gif|svg|webp)/i,
    /media\.giphy\.com/i,
    /tenor\.com\/view/i,
    /prnt\.sc\/\w+/i,
    /gyazo\.com\/\w+/i,
    /postimg\.cc/i,
    /imgbb\.com/i,
    /imageban\.ru/i,
    /photobucket\.com/i,
    /tinypic\.com/i,
    /imageshack\.us/i,
    /cloud\.githubusercontent\.com/i,
    /avatars\.githubusercontent\.com/i,
    /raw\.githubusercontent\.com.*\.(jpg|jpeg|png|gif|svg|webp)/i,
    /discord\.com\/attachments.*\.(jpg|jpeg|png|gif|webp)/i,
    /cdn\.discordapp\.com.*\.(jpg|jpeg|png|gif|webp)/i,
    /media\.discordapp\.net.*\.(jpg|jpeg|png|gif|webp)/i,
    /.*\.cloudfront\.net.*\.(jpg|jpeg|png|gif|svg|webp)/i,
    /.*\.amazonaws\.com.*\.(jpg|jpeg|png|gif|svg|webp)/i,
  ];

  return imageHostPatterns.some(pattern => pattern.test(url));
};

export const imageUrlsToMarkdown = async (content: string) => {
  // Pattern to match standalone URLs that point to images
  // This will match URLs on their own line or URLs not already in markdown syntax
  // Updated to be more careful about existing markdown syntax
  const standaloneImageUrlPattern = /(?:^|\s)(https?:\/\/[^\s<>"\]]+)(?=\s|$)/gm;

  return content.replace(standaloneImageUrlPattern, (match, url) => {
    // Don't convert if already in markdown image syntax
    const beforeMatch = content.substring(0, content.indexOf(match));

    // Check if it's already part of markdown image syntax ![alt](url) or [![alt](url)](link)
    if (
      beforeMatch.endsWith('](') ||
      beforeMatch.endsWith('![') ||
      beforeMatch.match(/!\[[^\]]*\]$/)
    ) {
      return match;
    }

    // Check if it's already part of markdown link syntax [text](url)
    if (beforeMatch.match(/\[[^\]]*\]$/)) {
      return match;
    }

    // If the URL points to an image, convert it to markdown image syntax
    if (isImageUrl(url.trim())) {
      const filename = url.split('/').pop()?.split('.')[0] || 'Image';
      return match.replace(url, `![${filename}](${url.trim()})`);
    }

    return match;
  });
};

export const urlsToMarkdownLinks = (content: string): string => {
  const standaloneUrlPattern =
    /(^|[\s(>])((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>\[\]]*)?)/gim;

  return content.replace(standaloneUrlPattern, (match, prefix: string, rawUrl: string, offset: number) => {
    const urlStart = offset + prefix.length;
    const charBeforeUrl = content[urlStart - 1] || '';
    const markdownLinkPrefix = content.slice(Math.max(0, urlStart - 2), urlStart);

    if (charBeforeUrl === '@') {
      return match;
    }

    if (markdownLinkPrefix === '](') {
      return match;
    }

    const href = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? rawUrl
      : `https://${rawUrl}`;

    return `${prefix}[${rawUrl}](${href})`;
  });
};
