import { describe, expect, it } from 'vitest';

import { sanitizeProfileNameInput } from './profile-name';

describe('sanitizeProfileNameInput', () => {
  it('replaces spaces with underscores', () => {
    expect(sanitizeProfileNameInput('John Doe')).toBe('John_Doe');
  });

  it('preserves nickname-safe punctuation', () => {
    expect(sanitizeProfileNameInput('user.name-123_test')).toBe('user.name-123_test');
  });

  it('removes unsupported punctuation', () => {
    expect(sanitizeProfileNameInput(' user/@name!? ')).toBe('username');
  });

  it('preserves unicode letters', () => {
    expect(sanitizeProfileNameInput('café')).toBe('café');
  });

  it('returns empty string when nothing valid remains', () => {
    expect(sanitizeProfileNameInput('   !!!   ')).toBe('');
  });
});