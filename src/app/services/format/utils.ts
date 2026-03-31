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

export const normalizeMarkdownLinkDestinations = (content: string): string => {
  return content.replace(
    /\[([^\]]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g,
    '[$1]($2)'
  );
};

const unescapeStandaloneMarkdownUrlsAndEmails = (content: string): string => {
  return content
    .replace(/(^|[\s(>])([a-z0-9._%+-]+)\\@([a-z0-9.-]+\.[a-z]{2,})(?=\s|$|[),;!?.])/gim, '$1$2@$3')
    .replace(/(^|[\s(>])(https?)\\:\/\//gim, '$1$2://');
};

const trimMalformedMarkdownLabel = (label: string): string => {
  const trimmedLabel = label.trim();
  const words = trimmedLabel.split(/\s+/).filter(Boolean);

  if (words.length <= 1) {
    return trimmedLabel;
  }

  const titleLikeWord = /^[A-Z0-9][A-Za-z0-9@#:_\-/]*$/;
  const directiveWords = new Set(['See', 'Read', 'Visit', 'Use', 'View', 'Open', 'Check', 'Try', 'Watch', 'Listen']);

  let lastLowercaseWordIndex = -1;
  for (let index = words.length - 1; index >= 0; index--) {
    if (/^[a-z]/.test(words[index])) {
      lastLowercaseWordIndex = index;
      break;
    }
  }
  if (lastLowercaseWordIndex >= 0 && lastLowercaseWordIndex < words.length - 1) {
    return words.slice(lastLowercaseWordIndex + 1).join(' ');
  }

  if (directiveWords.has(words[0])) {
    const candidateWords = words.slice(1);
    const candidate = candidateWords.join(' ');
    if (candidate && (/[0-9-]/.test(candidate) || candidateWords.every(word => titleLikeWord.test(word)))) {
      return candidate;
    }
  }

  return trimmedLabel;
};

export const urlsToMarkdownLinks = (content: string): string => {
  const unescapedContent = unescapeStandaloneMarkdownUrlsAndEmails(content);
  const normalizedMarkdownLinks = normalizeMarkdownLinkDestinations(unescapedContent);

  const repairedContent = normalizedMarkdownLinks.replace(
    /(^|[\s(>])([A-Z0-9][A-Za-z0-9@#:_\-/ ]{0,80}?)\)\]\((https?:\/\/[^\s)]+)\)\)?/g,
    (match, prefix: string, label: string, href: string) => {
      const originalLabel = label.trim();
      const trimmedLabel = trimMalformedMarkdownLabel(originalLabel);
      if (!trimmedLabel || trimmedLabel.includes('](')) {
        return match;
      }

      const leadingText = originalLabel.slice(0, Math.max(0, originalLabel.length - trimmedLabel.length)).trimEnd();
      const preservedLeadIn = leadingText ? `${leadingText} ` : '';

      return `${prefix}${preservedLeadIn}[${trimmedLabel}](${href})`;
    }
  );

  const emailPattern = /(^|[\s(>])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?=\s|$|[),;!?.])/gim;

  const normalizedContent = repairedContent.replace(
    emailPattern,
    (match, prefix: string, email: string, offset: number) => {
      const emailStart = offset + prefix.length;
      const markdownLinkPrefix = repairedContent.slice(Math.max(0, emailStart - 2), emailStart);

      if (markdownLinkPrefix === '](') {
        return match;
      }

      return `${prefix}[${email}](mailto:${email})`;
    }
  );

  const standaloneUrlPattern =
    /(^|[\s(>])((?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>\[\]]*)?)/gim;

  return normalizedContent.replace(standaloneUrlPattern, (match, prefix: string, rawUrl: string, offset: number) => {
    const urlStart = offset + prefix.length;
    const charBeforeUrl = normalizedContent[urlStart - 1] || '';
    const markdownLinkPrefix = normalizedContent.slice(Math.max(0, urlStart - 2), urlStart);

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
