const markdownLinkRegex = /\[([^\]]+)\]\((?:(?:https?|wss?):\/\/|(?:web\+)?nostr:)[^)]+\)/gi;
const urlRegex = /\b(?:https?|wss?):\/\/[^\s<>"{}|\\^`[\]]+/gi;
const nostrUriRegex = /\b(?:web\+)?nostr:[^\s<>"{}|\\^`[\]]+/gi;
const nip19ReferenceRegex = /\b(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+\b/gi;
const nostrTagReferenceRegex = /#\[\d+\]/g;

export function extractTextForTts(content: string): string {
  return content
    .replace(markdownLinkRegex, '$1')
    .replace(urlRegex, ' ')
    .replace(nostrUriRegex, ' ')
    .replace(nip19ReferenceRegex, ' ')
    .replace(nostrTagReferenceRegex, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitTtsParagraphs(content: string): string[] {
  const normalized = content
    .replace(markdownLinkRegex, '$1')
    .replace(urlRegex, ' ')
    .replace(nostrUriRegex, ' ')
    .replace(nip19ReferenceRegex, ' ')
    .replace(nostrTagReferenceRegex, ' ')
    .replace(/\r\n/g, '\n')
    .trim();

  const paragraphs = normalized
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return paragraphs.length > 0 ? paragraphs : [extractTextForTts(content)].filter(Boolean);
}
