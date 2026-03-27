import { beforeEach, describe, expect, it, vi, type MockedObject } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ContentComponent } from './content.component';
import { SettingsService } from '../../services/settings.service';
import { ParsingService } from '../../services/parsing.service';
import { LayoutService } from '../../services/layout.service';
import { OpenGraphService } from '../../services/opengraph.service';
import { signal } from '@angular/core';
import type { ContentToken } from '../../services/parsing.service';

describe('ContentComponent', () => {
  let component: ContentComponent;
  let fixture: ComponentFixture<ContentComponent>;
  let mockSettingsService: MockedObject<SettingsService> & {
    settings: ReturnType<typeof signal>;
  };
  let mockParsingService: MockedObject<ParsingService>;
  let mockLayoutService: MockedObject<LayoutService>;
  let mockOpenGraphService: MockedObject<OpenGraphService>;

  beforeEach(async () => {
    mockParsingService = {
      parseContent: vi.fn().mockName("ParsingService.parseContent"),
      clearNostrUriCache: vi.fn().mockName("ParsingService.clearNostrUriCache"),
      extractNostrUriIdentifier: vi.fn().mockName("ParsingService.extractNostrUriIdentifier")
    } as unknown as MockedObject<ParsingService>;
    mockParsingService.parseContent.mockResolvedValue({
      tokens: [],
      pendingMentions: [],
    });

    mockLayoutService = {
      openProfile: vi.fn().mockName("LayoutService.openProfile"),
      openGenericEvent: vi.fn().mockName("LayoutService.openGenericEvent"),
      openArticle: vi.fn().mockName("LayoutService.openArticle")
    } as unknown as MockedObject<LayoutService>;

    mockOpenGraphService = {
      getMultipleOpenGraphData: vi.fn().mockName('OpenGraphService.getMultipleOpenGraphData')
    } as unknown as MockedObject<OpenGraphService>;
    mockOpenGraphService.getMultipleOpenGraphData.mockResolvedValue([]);

    mockSettingsService = {
      settings: signal({ socialSharingPreview: false }),
    } as unknown as MockedObject<SettingsService> & {
      settings: ReturnType<typeof signal>;
    };

    await TestBed.configureTestingModule({
      imports: [ContentComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: ParsingService, useValue: mockParsingService },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: OpenGraphService, useValue: mockOpenGraphService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContentComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have empty content by default', () => {
    expect(component.content()).toBe('');
  });

  it('should accept content via signal input', () => {
    fixture.componentRef.setInput('content', 'Hello world');
    fixture.detectChanges();
    expect(component.content()).toBe('Hello world');
  });

  it('should accept undefined content', () => {
    fixture.componentRef.setInput('content', undefined);
    fixture.detectChanges();
    expect(component.content()).toBeUndefined();
  });

  it('should not show content tokens before visibility', () => {
    fixture.componentRef.setInput('content', 'Test content');
    fixture.detectChanges();
    // Content tokens should be empty when not yet visible
    expect(component.contentTokens()).toEqual([]);
  });

  it('should accept event input', () => {
    expect(component.event()).toBeNull();
  });

  it('should default hideTaggedReferences to false', () => {
    expect(component.hideTaggedReferences()).toBe(false);
  });

  it('should accept hideTaggedReferences input', () => {
    fixture.componentRef.setInput('hideTaggedReferences', true);
    fixture.detectChanges();
    expect(component.hideTaggedReferences()).toBe(true);
  });

  it('should default disableExpansion to false', () => {
    expect(component.disableExpansion()).toBe(false);
  });

  it('should default hideSocialPreviews to false', () => {
    expect(component.hideSocialPreviews()).toBe(false);
  });

  it('should default hideInlineMediaAndLinks to false', () => {
    expect(component.hideInlineMediaAndLinks()).toBe(false);
  });

  it('should hide inline media and links from displayContentTokens when enabled', () => {
    (component as unknown as {
      _hasBeenVisible: {
        set: (value: boolean) => void;
      };
      _cachedTokens: {
        set: (value: {
          id: number;
          type: string;
          content: string;
        }[]) => void;
      };
    })._hasBeenVisible.set(true);

    (component as unknown as {
      _cachedTokens: {
        set: (value: {
          id: number;
          type: string;
          content: string;
        }[]) => void;
      };
    })._cachedTokens.set([
      { id: 1, type: 'text', content: 'hello ' },
      { id: 2, type: 'url', content: 'https://example.com' },
      { id: 3, type: 'image', content: 'https://example.com/a.jpg' },
      { id: 4, type: 'video', content: 'https://example.com/a.mp4' },
    ]);

    fixture.componentRef.setInput('hideInlineMediaAndLinks', true);
    fixture.detectChanges();

    const displayed = component.displayContentTokens();
    expect(displayed.length).toBe(1);
    expect(displayed[0].type).toBe('text');
  });

  it('should preserve linebreaks when hiding media tokens', () => {
    (component as unknown as {
      _hasBeenVisible: {
        set: (value: boolean) => void;
      };
      _cachedTokens: {
        set: (value: {
          id: number;
          type: string;
          content: string;
        }[]) => void;
      };
    })._hasBeenVisible.set(true);

    (component as unknown as {
      _cachedTokens: {
        set: (value: {
          id: number;
          type: string;
          content: string;
        }[]) => void;
      };
    })._cachedTokens.set([
      { id: 1, type: 'text', content: 'Top text' },
      { id: 2, type: 'linebreak', content: '\n' },
      { id: 3, type: 'video', content: 'https://example.com/a.mp4' },
      { id: 4, type: 'linebreak', content: '\n' },
      { id: 5, type: 'text', content: 'Bottom text' },
    ]);

    fixture.componentRef.setInput('hideInlineMediaAndLinks', true);
    fixture.detectChanges();

    const displayed = component.displayContentTokens();
    expect(displayed.map(token => token.type)).toEqual(['text', 'linebreak', 'linebreak', 'text']);
  });

  it('should compute proxyWebUrl as null when no event', () => {
    expect(component.proxyWebUrl()).toBeNull();
  });

  it('should compute proxyWebUrl from event proxy tag', () => {
    const mockEvent = {
      id: 'test',
      pubkey: 'abc',
      created_at: 1000,
      kind: 1,
      tags: [['proxy', 'https://mastodon.social/@user/123', 'web']],
      content: 'test',
      sig: 'sig',
    };
    fixture.componentRef.setInput('event', mockEvent);
    fixture.detectChanges();
    expect(component.proxyWebUrl()).toBe('https://mastodon.social/@user/123');
  });

  it('should return null proxyWebUrl when proxy tag has wrong type', () => {
    const mockEvent = {
      id: 'test',
      pubkey: 'abc',
      created_at: 1000,
      kind: 1,
      tags: [['proxy', 'https://mastodon.social/@user/123', 'activitypub']],
      content: 'test',
      sig: 'sig',
    };
    fixture.componentRef.setInput('event', mockEvent);
    fixture.detectChanges();
    expect(component.proxyWebUrl()).toBeNull();
  });

  it('should update content when input changes', () => {
    fixture.componentRef.setInput('content', 'First');
    fixture.detectChanges();
    expect(component.content()).toBe('First');

    fixture.componentRef.setInput('content', 'Second');
    fixture.detectChanges();
    expect(component.content()).toBe('Second');
  });

  it('should clean up on destroy', () => {
    fixture.componentRef.setInput('content', 'test');
    fixture.detectChanges();
    fixture.destroy();
    expect(mockParsingService.clearNostrUriCache).toHaveBeenCalled();
  });

  it('should replace previewed URLs with inline preview token metadata', () => {
    mockSettingsService.settings.set({ socialSharingPreview: true });

    (component as unknown as {
      _hasBeenVisible: { set: (value: boolean) => void };
      _cachedTokens: { set: (value: ContentToken[]) => void };
    })._hasBeenVisible.set(true);

    (component as unknown as {
      _cachedTokens: { set: (value: ContentToken[]) => void };
    })._cachedTokens.set([
      { id: 1, type: 'text', content: 'Before ' } as ContentToken,
      { id: 2, type: 'url', content: 'https://x.com/user/status/1234567890' } as ContentToken,
      { id: 3, type: 'text', content: ' after' } as ContentToken,
      { id: 4, type: 'url', content: 'https://example.com' } as ContentToken,
    ]);

    component.socialPreviews.set([
      {
        url: 'https://x.com/user/status/1234567890',
        loading: false,
        error: false,
      },
    ]);

    fixture.detectChanges();

    expect(component.displayContentTokens()).toEqual([
      { id: 1, type: 'text', content: 'Before ' },
      {
        id: 2,
        type: 'url',
        content: 'https://x.com/user/status/1234567890',
        previewLoading: false,
        previewError: false,
        previewSiteName: undefined,
        previewTitle: undefined,
      },
      { id: 3, type: 'text', content: ' after' },
      { id: 4, type: 'url', content: 'https://example.com' },
    ]);
  });

  it('should use preview title metadata for generic URLs when available', () => {
    mockSettingsService.settings.set({ socialSharingPreview: true });

    (component as unknown as {
      _hasBeenVisible: { set: (value: boolean) => void };
      _cachedTokens: { set: (value: ContentToken[]) => void };
    })._hasBeenVisible.set(true);

    (component as unknown as {
      _cachedTokens: { set: (value: ContentToken[]) => void };
    })._cachedTokens.set([
      { id: 1, type: 'text', content: 'Song link\n' } as ContentToken,
      { id: 2, type: 'url', content: 'https://lnbeats.com/album/123?utm_source=test' } as ContentToken,
      { id: 3, type: 'linebreak', content: '\n' } as ContentToken,
      { id: 4, type: 'text', content: 'More text' } as ContentToken,
    ]);

    component.socialPreviews.set([
      {
        url: 'https://lnbeats.com/album/123',
        title: 'LN Beats Album',
        siteName: 'LN Beats',
        loading: false,
        error: false,
      },
    ]);

    fixture.detectChanges();

    expect(component.displayContentTokens()).toEqual([
      { id: 1, type: 'text', content: 'Song link\n' },
      {
        id: 2,
        type: 'url',
        content: 'https://lnbeats.com/album/123?utm_source=test',
        previewTitle: 'LN Beats Album',
        previewSiteName: 'LN Beats',
        previewLoading: false,
        previewError: false,
      },
      { id: 3, type: 'linebreak', content: '\n' },
      { id: 4, type: 'text', content: 'More text' },
    ]);
  });

  it('should keep inline X status URLs when social previews are disabled', () => {
    mockSettingsService.settings.set({ socialSharingPreview: false });

    (component as unknown as {
      _hasBeenVisible: { set: (value: boolean) => void };
      _cachedTokens: { set: (value: ContentToken[]) => void };
    })._hasBeenVisible.set(true);

    (component as unknown as {
      _cachedTokens: { set: (value: ContentToken[]) => void };
    })._cachedTokens.set([
      { id: 1, type: 'url', content: 'https://x.com/user/status/1234567890' } as ContentToken,
    ]);

    fixture.detectChanges();

    expect(component.displayContentTokens().map(token => token.content)).toEqual([
      'https://x.com/user/status/1234567890',
    ]);
  });
});
