import { marked } from 'marked';
import { isImageUrl } from './utils';

// Create a custom renderer for enhanced image handling
const markdownRenderer = new marked.Renderer();

// Custom heading renderer to ensure headers are properly rendered
markdownRenderer.heading = ({ text, depth }: { text: string; depth: number }): string => {
  // Process inline markdown in the heading text (bold, italic, etc.)
  const processedText = marked.parseInline(text) as string;
  const headingId = text
    .replace(/\*\*/g, '') // Remove bold markers for ID generation
    .replace(/\*/g, '') // Remove italic markers for ID generation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `<h${depth} id="${headingId}">${processedText}</h${depth}>`;
};

// Custom image renderer with enhanced attributes and link support
markdownRenderer.image = ({
  href,
  title,
  text,
}: {
  href: string | null;
  title: string | null;
  text: string;
}): string => {
  if (!href) return '';

  // Sanitize the href URL
  const sanitizedHref = href.replace(/[<>"']/g, '');
  const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';
  const sanitizedAlt = text ? text.replace(/[<>"']/g, '') : '';

  return `<img
    src="${sanitizedHref}"
    alt="${sanitizedAlt}"
    ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''}
    class="article-image"
    loading="lazy"
    decoding="async"
    onclick="window.open('${sanitizedHref}', '_blank')"
    style="cursor: pointer;"
  />`;
};

// Custom link renderer that preserves markdown image links and handles standalone image URLs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
markdownRenderer.link = ({ href, title, tokens }: any): string => {
  // Extract text from tokens safely
  const text = tokens && tokens.length > 0 && tokens[0] && tokens[0].raw ? tokens[0].raw : href;

  if (!href) return text || '';

  // Check if this link contains an image (markdown image link syntax: [![alt](image)](link))
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
  const imageMatch = text.match(imageRegex);

  if (imageMatch) {
    // This is a markdown image link: [![alt](image)](link)
    const [, altText, imageSrc] = imageMatch;
    const sanitizedHref = href.replace(/[<>"']/g, '');
    const sanitizedImageSrc = imageSrc.replace(/[<>"']/g, '');
    const sanitizedAlt = altText.replace(/[<>"']/g, '');
    const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';

    return `<a href="${sanitizedHref}" target="_blank" rel="noopener noreferrer" ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''}>
      <img
        src="${sanitizedImageSrc}"
        alt="${sanitizedAlt}"
        class="article-image linked-image"
        loading="lazy"
        decoding="async"
        style="cursor: pointer;"
      />
    </a>`;
  }

  // Check if the link URL itself points to an image (standalone image URLs)
  if (isImageUrl(href)) {
    // Render as image instead of link
    const sanitizedHref = href.replace(/[<>"']/g, '');
    const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';
    const sanitizedAlt = text || 'Image';

    return `<img
      src="${sanitizedHref}"
      alt="${sanitizedAlt}"
      ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''}
      class="article-image"
      loading="lazy"
      decoding="async"
      onclick="window.open('${sanitizedHref}', '_blank')"
      style="cursor: pointer;"
    />`;
  }

  // Regular link rendering with external-link class for interception
  const sanitizedHref = href.replace(/[<>"']/g, '');
  const sanitizedTitle = title ? title.replace(/[<>"']/g, '') : '';
  return `<a href="${sanitizedHref}" ${sanitizedTitle ? `title="${sanitizedTitle}"` : ''} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

export default markdownRenderer;
