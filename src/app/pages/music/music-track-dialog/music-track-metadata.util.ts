interface AudioMetadataTagValueObject {
  text?: unknown;
  description?: unknown;
  value?: unknown;
}

export interface AudioMetadataTag {
  id: string;
  value: unknown;
}

export type AudioNativeMetadata = Record<string, AudioMetadataTag[] | undefined>;

const EXPLICIT_AI_METADATA_IDS = new Set([
  'ai_generated',
  'ai-generated',
  'aigenerated',
  'txxx:ai_generated',
  'txxx:ai-generated',
  'txxx:aigenerated',
  '----:com.apple.itunes:ai_generated',
  '----:com.apple.itunes:ai-generated',
  '----:com.apple.itunes:aigenerated',
]);

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y']);

function normalizeMetadataId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function readMetadataText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => readMetadataText(item)).find(text => text.length > 0) || '';
  }

  if (value && typeof value === 'object') {
    const objectValue = value as AudioMetadataTagValueObject;
    return readMetadataText(objectValue.text)
      || readMetadataText(objectValue.description)
      || readMetadataText(objectValue.value);
  }

  return '';
}

/**
 * Only auto-mark AI when the audio file exposes an explicit AI metadata field.
 * Generic website/comment heuristics are intentionally ignored because they caused false positives.
 */
export function shouldAutoMarkTrackAsAiGenerated(nativeTags?: AudioNativeMetadata): boolean {
  if (!nativeTags) {
    return false;
  }

  for (const tags of Object.values(nativeTags)) {
    if (!tags) {
      continue;
    }

    for (const tag of tags) {
      if (!EXPLICIT_AI_METADATA_IDS.has(normalizeMetadataId(tag.id))) {
        continue;
      }

      const normalizedValue = readMetadataText(tag.value).trim().toLowerCase();
      if (TRUE_VALUES.has(normalizedValue)) {
        return true;
      }
    }
  }

  return false;
}