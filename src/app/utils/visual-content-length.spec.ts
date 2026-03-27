import { describe, expect, it } from 'vitest';

import { visualContentLength } from './visual-content-length';

describe('visualContentLength', () => {
  it('excludes urls from the measured length', () => {
    const result = visualContentLength('Listen here https://example.com/very/long/path right now');

    expect(result).toBe('Listen here  right now'.length);
  });

  it('excludes nostr uris and bare nostr identifiers from the measured length', () => {
    const result = visualContentLength(
      'Hey nostr:nevent1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq and naddr1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
    );

    expect(result).toBe('Hey  and '.length);
  });

  it('keeps regular text length unchanged when no excluded tokens exist', () => {
    const content = 'Plain text with emoji ⚡ and line breaks\nthat should still count.';

    expect(visualContentLength(content)).toBe(content.length);
  });

  it('matches the visible text length for posts with only text plus previews', () => {
    const content = [
      'Hand Me Down Heart can now be streamed everywhere in the valueverse',
      '',
      'nostr:nprofile1qyxhwumn8ghj7mn0wvhxcmmvqyg8wumn8ghj7mn0wd68ytnvv9hxgqpqs8l30z2uhy2x0h5xkmg534qjqhhle2qkzn0r7mfkkguqh20x8f0q62lt8k',
      '',
      'https://wavlake.com/track/fef2edb3-b7cf-4f70-a885-e75faba2b9ca',
      '',
      'https://sunami.app/track/naddr1qvzqqqy0kvpzq2x2qxdh3dy5cfdfmgkkgkt44pgpcl5ekyfs9ewtuaywukflevkvqyt8wumn8ghj7un9d3shjtnswf5k6ctv9ehx2aqpz3mhxue69uhhyetvv9ujuerpd46hxtnfduq3samnwvaz7tmjv4kxz7fwwdhx7un59eek7cmfv9kqzxthwden5te0wf5kymewv46jumn0wd68y6tp9eshquqpp4mhxue69uhkummn9ekx7mqpz4mhxue69uhhyetvv9ujuerfw36x7tnsw43qq8t5wfskx6edxymnwdp4xgunyv35xvmnxtf5vych27tz0pjkww5ehln',
      '',
    ].join('\n');

    expect(visualContentLength(content)).toBe('Hand Me Down Heart can now be streamed everywhere in the valueverse\n\n\n\n\n\n'.length);
  });
});
