import { describe, expect, it } from 'vitest';
import { PublicUrlService } from './public-url.service';

describe('PublicUrlService', () => {
  const service = new PublicUrlService();

  it('rewrites tauri localhost URLs to the public Nostria domain', () => {
    expect(
      service.toCanonicalUrl('http://tauri.localhost/e/nevent1abc?foo=bar#reply')
    ).toBe('https://nostria.app/e/nevent1abc?foo=bar#reply');
  });

  it('builds public URLs from relative app paths', () => {
    expect(service.build('/invite/nprofile1abc')).toBe('https://nostria.app/invite/nprofile1abc');
  });

  it('leaves non-tauri absolute URLs unchanged', () => {
    expect(service.toCanonicalUrl('http://localhost:4200/e/nevent1abc')).toBe('http://localhost:4200/e/nevent1abc');
    expect(service.toCanonicalUrl('https://nostria.app/e/nevent1abc')).toBe('https://nostria.app/e/nevent1abc');
  });
});
