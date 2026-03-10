import type { MockedObject } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { SocialPreviewComponent } from './social-preview.component';
import { OpenGraphService } from '../../services/opengraph.service';
import { ThemeService } from '../../services/theme.service';

describe('SocialPreviewComponent', () => {
  let component: SocialPreviewComponent;
  let fixture: ComponentFixture<SocialPreviewComponent>;
  let mockOpenGraphService: MockedObject<OpenGraphService>;
  let mockThemeService: Pick<ThemeService, 'darkMode'> & {
    darkMode: ReturnType<typeof signal>;
  };

  beforeEach(async () => {
    mockOpenGraphService = {
      getOpenGraphData: vi.fn().mockName("OpenGraphService.getOpenGraphData"),
      clearCache: vi.fn().mockName("OpenGraphService.clearCache")
    } as unknown as MockedObject<OpenGraphService>;
    mockOpenGraphService.getOpenGraphData.mockResolvedValue({
      url: 'https://example.com',
      title: 'Example Title',
      description: 'Example description text',
      image: 'https://example.com/image.jpg',
      loading: false,
      error: false,
    });
    mockThemeService = {
      darkMode: signal(false),
    };

    await TestBed.configureTestingModule({
      imports: [SocialPreviewComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: OpenGraphService, useValue: mockOpenGraphService },
        { provide: ThemeService, useValue: mockThemeService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SocialPreviewComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default compact to false', () => {
    expect(component.compact()).toBe(false);
  });

  it('should accept compact input', () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    expect(component.compact()).toBe(true);
  });

  it('should load preview when url is set', async () => {
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockOpenGraphService.getOpenGraphData).toHaveBeenCalledWith('https://example.com');
    expect(component.preview().title).toBe('Example Title');
    expect(component.preview().description).toBe('Example description text');
    expect(component.preview().image).toBe('https://example.com/image.jpg');
  });

  it('should apply compact-preview class when compact input is true', async () => {
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('mat-card');
    expect(card.classList.contains('compact-preview')).toBe(true);
  });

  it('should not apply compact-preview class when compact is false and preview has title and image', async () => {
    fixture.componentRef.setInput('compact', false);
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('mat-card');
    expect(card.classList.contains('compact-preview')).toBe(false);
  });

  it('should hide description in compact mode', async () => {
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const description = fixture.nativeElement.querySelector('.preview-description');
    expect(description).toBeNull();
  });

  it('should show description in full mode', async () => {
    fixture.componentRef.setInput('compact', false);
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const description = fixture.nativeElement.querySelector('.preview-description');
    expect(description).toBeTruthy();
    expect(description.textContent).toContain('Example description text');
  });

  it('should show title in both compact and full modes', async () => {
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const title = fixture.nativeElement.querySelector('.preview-title');
    expect(title).toBeTruthy();
    expect(title.textContent).toContain('Example Title');

    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const compactTitle = fixture.nativeElement.querySelector('.preview-title');
    expect(compactTitle).toBeTruthy();
    expect(compactTitle.textContent).toContain('Example Title');
  });

  it('should show URL in both compact and full modes', async () => {
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const url = fixture.nativeElement.querySelector('.preview-url');
    expect(url).toBeTruthy();
    expect(url.textContent).toContain('https://example.com');

    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const compactUrl = fixture.nativeElement.querySelector('.preview-url');
    expect(compactUrl).toBeTruthy();
    expect(compactUrl.textContent).toContain('https://example.com');
  });

  it('should hide description loading placeholder in compact mode', async () => {
    // Set up a pending promise to keep loading state
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    mockOpenGraphService.getOpenGraphData.mockReturnValue(new Promise(() => { }));

    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('url', 'https://example.com/slow');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const descPlaceholder = fixture.nativeElement.querySelector('.description-placeholder');
    expect(descPlaceholder).toBeNull();
  });

  it('should show description loading placeholder in full mode', async () => {
    // Set up a pending promise to keep loading state
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    mockOpenGraphService.getOpenGraphData.mockReturnValue(new Promise(() => { }));

    fixture.componentRef.setInput('compact', false);
    fixture.componentRef.setInput('url', 'https://example.com/slow');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const descPlaceholder = fixture.nativeElement.querySelector('.description-placeholder');
    expect(descPlaceholder).toBeTruthy();
  });

  it('should apply compact-preview class when no title and no image (auto-compact)', async () => {
    mockOpenGraphService.getOpenGraphData.mockResolvedValue({
      url: 'https://example.com',
      title: '',
      description: '',
      image: '',
      loading: false,
      error: false,
    });

    fixture.componentRef.setInput('compact', false);
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('mat-card');
    expect(card.classList.contains('compact-preview')).toBe(true);
  });

  it('should handle error state', async () => {
    mockOpenGraphService.getOpenGraphData.mockRejectedValue(new Error('Network error'));

    fixture.componentRef.setInput('url', 'https://example.com/error');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    expect(component.preview().error).toBe(true);
  });

  it('should default url to empty string', () => {
    expect(component.url()).toBe('');
  });

  it('should reset preview when url is set to empty', async () => {
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.preview().title).toBe('Example Title');

    fixture.componentRef.setInput('url', '');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.preview().url).toBe('');
    expect(component.preview().loading).toBe(false);
    expect(component.preview().error).toBe(false);
  });

  it('should reload preview when url changes', async () => {
    fixture.componentRef.setInput('url', 'https://example.com');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockOpenGraphService.getOpenGraphData).toHaveBeenCalledWith('https://example.com');

    mockOpenGraphService.getOpenGraphData.mockResolvedValue({
      url: 'https://other.com',
      title: 'Other Title',
      description: 'Other description',
      image: '',
      loading: false,
      error: false,
    });

    fixture.componentRef.setInput('url', 'https://other.com');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockOpenGraphService.getOpenGraphData).toHaveBeenCalledWith('https://other.com');
    expect(component.preview().title).toBe('Other Title');
  });

  it('should render an X embed card when the preview type is x-post', async () => {
    mockOpenGraphService.getOpenGraphData.mockResolvedValue({
      url: 'https://x.com/user/status/1234567890',
      title: 'User on X',
      providerName: 'Twitter',
      authorName: 'User',
      authorUrl: 'https://x.com/user',
      embedHtml: '<blockquote class="twitter-tweet"><p>Hello from X</p></blockquote>',
      previewType: 'x-post',
      loading: false,
      error: false,
    });

    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('url', 'https://x.com/user/status/1234567890');
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.detectChanges();
    const xPreview = fixture.nativeElement.querySelector('.x-preview-card');
    const embedHost = fixture.nativeElement.querySelector('.x-embed-host');

    expect(xPreview).toBeTruthy();
    expect(embedHost.innerHTML).toContain('twitter-tweet');
    expect(fixture.nativeElement.querySelector('.compact-preview')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Open post');
    expect(fixture.nativeElement.textContent).not.toContain('TWITTER');
  });

  it('should reload X embeds when the app theme changes', async () => {
    mockOpenGraphService.getOpenGraphData.mockResolvedValue({
      url: 'https://x.com/user/status/1234567890',
      embedHtml: '<blockquote class="twitter-tweet" data-theme="light"><p>Hello</p></blockquote>',
      previewType: 'x-post',
      loading: false,
      error: false,
    });

    fixture.componentRef.setInput('url', 'https://x.com/user/status/1234567890');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockOpenGraphService.getOpenGraphData).toHaveBeenCalledTimes(1);
    expect(mockOpenGraphService.clearCache).toHaveBeenCalledWith('https://x.com/user/status/1234567890');

    mockThemeService.darkMode.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockOpenGraphService.getOpenGraphData).toHaveBeenCalledTimes(2);
  });
});
