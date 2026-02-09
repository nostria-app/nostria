import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { ArticleDisplayComponent, ArticleData } from './article-display.component';

function makeArticleData(overrides: Partial<ArticleData> = {}): ArticleData {
  return {
    title: 'Test Article',
    summary: 'A test summary',
    image: '',
    parsedContent: '',
    contentLoading: false,
    hashtags: [],
    authorPubkey: 'abc123def456'.padEnd(64, '0'),
    publishedAt: null,
    publishedAtTimestamp: Math.floor(Date.now() / 1000),
    link: '',
    id: '',
    isJsonContent: false,
    jsonData: null,
    ...overrides,
  };
}

describe('ArticleDisplayComponent', () => {
  let component: ArticleDisplayComponent;
  let fixture: ComponentFixture<ArticleDisplayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleDisplayComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArticleDisplayComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('article', makeArticleData());
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('content loading indicator', () => {
    it('should show loading spinner when contentLoading is true', async () => {
      fixture.componentRef.setInput('article', makeArticleData({ contentLoading: true }));
      fixture.detectChanges();
      await fixture.whenStable();

      const el: HTMLElement = fixture.nativeElement;
      const loadingEl = el.querySelector('.content-loading');
      expect(loadingEl).toBeTruthy();
      expect(loadingEl?.textContent).toContain('Loading content...');
      expect(el.querySelector('.content-loading mat-progress-spinner')).toBeTruthy();
    });

    it('should not show loading spinner when contentLoading is false', async () => {
      fixture.componentRef.setInput('article', makeArticleData({ contentLoading: false }));
      fixture.detectChanges();
      await fixture.whenStable();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.content-loading')).toBeNull();
    });

    it('should show markdown content when not loading', async () => {
      const sanitizer = TestBed.inject(DomSanitizer);
      const htmlContent = sanitizer.bypassSecurityTrustHtml('<p>Hello world</p>');
      fixture.componentRef.setInput('article', makeArticleData({
        contentLoading: false,
        parsedContent: htmlContent,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.content-loading')).toBeNull();
      const markdownEl = el.querySelector('.markdown-content');
      expect(markdownEl).toBeTruthy();
      expect(markdownEl?.innerHTML).toContain('Hello world');
    });

    it('should show loading instead of content when loading is true even with parsedContent', async () => {
      const sanitizer = TestBed.inject(DomSanitizer);
      const htmlContent = sanitizer.bypassSecurityTrustHtml('<p>Hello world</p>');
      fixture.componentRef.setInput('article', makeArticleData({
        contentLoading: true,
        parsedContent: htmlContent,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.content-loading')).toBeTruthy();
      expect(el.querySelector('.markdown-content')).toBeNull();
    });
  });

  describe('long link word breaking', () => {
    it('should apply word-break styles to markdown content container', async () => {
      const sanitizer = TestBed.inject(DomSanitizer);
      const longLink = 'https://plektos.app/event/naddr1qvzqqqrukvpzqejwqu87yhnkmh8054yjnsx7gtk26zqspy6s0cjdu33zqagumda2qqvrvwfcx3nrvep5xdskydps8p3xvdrz8yursc35xv05yd6s';
      const htmlContent = sanitizer.bypassSecurityTrustHtml(
        `<p>Check this link: <a href="${longLink}">${longLink}</a></p>`
      );
      fixture.componentRef.setInput('article', makeArticleData({
        contentLoading: false,
        parsedContent: htmlContent,
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      const markdownEl = fixture.nativeElement.querySelector('.markdown-content') as HTMLElement;
      expect(markdownEl).toBeTruthy();

      const computedStyle = getComputedStyle(markdownEl);
      expect(computedStyle.overflowWrap).toBe('break-word');
    });
  });
});
