import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ContentComponent } from './content.component';
import { SettingsService } from '../../services/settings.service';
import { ParsingService } from '../../services/parsing.service';
import { LayoutService } from '../../services/layout.service';
import { signal } from '@angular/core';

describe('ContentComponent', () => {
  let component: ContentComponent;
  let fixture: ComponentFixture<ContentComponent>;
  let mockSettingsService: jasmine.SpyObj<SettingsService> & { settings: ReturnType<typeof signal> };
  let mockParsingService: jasmine.SpyObj<ParsingService>;
  let mockLayoutService: jasmine.SpyObj<LayoutService>;

  beforeEach(async () => {
    mockParsingService = jasmine.createSpyObj('ParsingService', [
      'parseContent',
      'clearNostrUriCache',
      'extractNostrUriIdentifier',
    ]);
    mockParsingService.parseContent.and.resolveTo({
      tokens: [],
      pendingMentions: [],
    });

    mockLayoutService = jasmine.createSpyObj('LayoutService', [
      'openProfile',
      'openGenericEvent',
      'openArticle',
    ]);

    mockSettingsService = {
      settings: signal({ socialSharingPreview: false }),
    } as unknown as jasmine.SpyObj<SettingsService> & { settings: ReturnType<typeof signal> };

    await TestBed.configureTestingModule({
      imports: [ContentComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: ParsingService, useValue: mockParsingService },
        { provide: LayoutService, useValue: mockLayoutService },
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
    expect(component.hideTaggedReferences()).toBeFalse();
  });

  it('should accept hideTaggedReferences input', () => {
    fixture.componentRef.setInput('hideTaggedReferences', true);
    fixture.detectChanges();
    expect(component.hideTaggedReferences()).toBeTrue();
  });

  it('should default disableExpansion to false', () => {
    expect(component.disableExpansion()).toBeFalse();
  });

  it('should default hideSocialPreviews to false', () => {
    expect(component.hideSocialPreviews()).toBeFalse();
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
});
