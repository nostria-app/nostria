import type { MockedObject } from "vitest";
import { TestBed } from '@angular/core/testing';
import { ResolveNostrPipe } from './resolve-nostr.pipe';
import { DataService } from '../services/data.service';
import { UtilitiesService } from '../services/utilities.service';

describe('ResolveNostrPipe', () => {
  let pipe: ResolveNostrPipe;
  let dataService: MockedObject<DataService>;
  let utilitiesService: MockedObject<UtilitiesService>;

  beforeEach(() => {
    const dataServiceSpy = {
      getCachedProfile: vi.fn().mockName("DataService.getCachedProfile"),
      getProfile: vi.fn().mockName("DataService.getProfile")
    };
    const utilitiesServiceSpy = {
      getTruncatedNpub: vi.fn().mockName("UtilitiesService.getTruncatedNpub")
    };

    TestBed.configureTestingModule({
      providers: [
        ResolveNostrPipe,
        { provide: DataService, useValue: dataServiceSpy },
        { provide: UtilitiesService, useValue: utilitiesServiceSpy },
      ],
    });

    pipe = TestBed.inject(ResolveNostrPipe);
    dataService = TestBed.inject(DataService) as MockedObject<DataService>;
    utilitiesService = TestBed.inject(UtilitiesService) as MockedObject<UtilitiesService>;
  });

  it('should create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('should return empty string for empty input', () => {
    expect(pipe.transform('')).toBe('');
  });

  it('should return unchanged text when no nostr identifiers present', () => {
    const text = 'This is a normal message without any nostr identifiers';
    expect(pipe.transform(text)).toBe(text);
  });

  it('should resolve nostr:npub to display name when profile is cached', () => {
    // Use a valid npub identifier
    const npub = 'npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
    const text = `Check out nostr:${npub}`;
    const mockProfile = {
      data: {
        display_name: 'Test User',
        name: 'testuser',
      },
    };

    dataService.getCachedProfile.mockReturnValue(mockProfile as any);

    const result = pipe.transform(text);
    expect(result).toContain('@Test User');
    expect(result).not.toContain(npub);
  });

  it('should resolve nostr:npub to truncated npub when profile not cached', () => {
    const npub = 'npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
    const text = `Check out nostr:${npub}`;

    dataService.getCachedProfile.mockReturnValue(undefined);
    utilitiesService.getTruncatedNpub.mockReturnValue('npub10jvs...');

    const result = pipe.transform(text);
    expect(result).toContain('@npub10jvs...');
  });

  it('should resolve nostr:nprofile to display name when profile is cached', () => {
    // Use a valid nprofile identifier  
    const nprofile = 'nprofile1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpcag4mn';
    const text = `Mentioned by nostr:${nprofile}`;
    const mockProfile = {
      data: {
        display_name: 'Alice',
      },
    };

    dataService.getCachedProfile.mockReturnValue(mockProfile as any);

    const result = pipe.transform(text);
    expect(result).toContain('@Alice');
  });

  it('should resolve nostr:note to shortened event ID', () => {
    // Use a valid note identifier
    const noteId = 'note1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3yv97v';
    const text = `Reacted to nostr:${noteId}`;

    const result = pipe.transform(text);
    // Should contain "note:" followed by truncated ID
    expect(result).toMatch(/note:[a-fA-F0-9]{8}\.\.\./);
  });

  it('should resolve nostr:nevent to shortened event ID', () => {
    // Use a valid nevent identifier
    const nevent = 'nevent1qvzqqqqqqypzqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqy9ev3d';
    const text = `Replied to nostr:${nevent}`;

    const result = pipe.transform(text);
    // Should contain "note:" followed by truncated ID
    expect(result).toMatch(/note:[a-fA-F0-9]{8}\.\.\./);
  });

  it('should handle multiple nostr identifiers in the same text', () => {
    const text = 'nostr:npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8 mentioned you in nostr:note1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3yv97v';

    dataService.getCachedProfile.mockReturnValue(undefined);
    utilitiesService.getTruncatedNpub.mockReturnValue('npub10jvs...');

    const result = pipe.transform(text);
    expect(result).toContain('@npub10jvs...');
    expect(result).toMatch(/note:[a-fA-F0-9]{8}\.\.\./);
  });

  it('should handle invalid nostr identifiers gracefully', () => {
    const text = 'nostr:invalid123 is not a valid identifier';

    const result = pipe.transform(text);
    // Should return original text when parsing fails
    expect(result).toContain('nostr:invalid123');
  });

  it('should prefer display_name over name when both are available', () => {
    const npub = 'npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
    const text = `nostr:${npub}`;
    const mockProfile = {
      data: {
        display_name: 'Display Name',
        name: 'username',
      },
    };

    dataService.getCachedProfile.mockReturnValue(mockProfile as any);

    const result = pipe.transform(text);
    expect(result).toContain('@Display Name');
    expect(result).not.toContain('@username');
  });

  it('should use name as fallback when display_name is not available', () => {
    const npub = 'npub10jvs984jmel09egmvuxndhtjnqhtlyp3wyqdgjnmucdvvd7q5cvq7pmas8';
    const text = `nostr:${npub}`;
    const mockProfile = {
      data: {
        name: 'username',
      },
    };

    dataService.getCachedProfile.mockReturnValue(mockProfile as any);

    const result = pipe.transform(text);
    expect(result).toContain('@username');
  });
});
