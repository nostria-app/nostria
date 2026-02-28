import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ArticleEventComponent } from './article-event.component';
import { FormatService } from '../../services/format/format.service';
import { LayoutService } from '../../services/layout.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { ChroniaCalendarService } from '../../services/chronia-calendar.service';
import { EthiopianCalendarService } from '../../services/ethiopian-calendar.service';
import { Event } from 'nostr-tools';

describe('ArticleEventComponent', () => {
    let component: ArticleEventComponent;
    let fixture: ComponentFixture<ArticleEventComponent>;

    const createMockArticleEvent = (content: string, tags: string[][] = []): Event => ({
        id: 'test-article-id',
        pubkey: 'test-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 30023, // Article
        tags,
        content,
        sig: 'test-sig',
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ArticleEventComponent],
            providers: [
                provideZonelessChangeDetection(),
                {
                    provide: FormatService,
                    useValue: {
                        markdownToHtmlNonBlocking: vi.fn().mockReturnValue(''),
                    },
                },
                {
                    provide: LayoutService,
                    useValue: {
                        openArticle: vi.fn(),
                    },
                },
                {
                    provide: LocalSettingsService,
                    useValue: {
                        calendarType: vi.fn().mockReturnValue('gregorian'),
                    },
                },
                {
                    provide: ChroniaCalendarService,
                    useValue: {
                        fromDate: vi.fn(),
                        format: vi.fn(),
                    },
                },
                {
                    provide: EthiopianCalendarService,
                    useValue: {
                        fromDate: vi.fn(),
                        format: vi.fn(),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ArticleEventComponent);
        component = fixture.componentInstance;
    });

    describe('Title extraction', () => {
        it('should extract title from tags', () => {
            const event = createMockArticleEvent('Article content', [['title', 'Test Article Title']]);
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.title()).toBe('Test Article Title');
        });

        it('should fallback to first heading when title tag is missing', () => {
            const event = createMockArticleEvent('# Fallback Title\n\nContent here');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.title()).toBe('Fallback Title');
        });

        it('should return null when no title tag or heading', () => {
            const event = createMockArticleEvent('Just plain content without heading');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.title()).toBeNull();
        });
    });

    describe('Image extraction', () => {
        it('should extract image from tags', () => {
            const event = createMockArticleEvent('Article content', [['image', 'https://example.com/image.jpg']]);
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.image()).toBe('https://example.com/image.jpg');
        });

        it('should fallback to markdown image when image tag is missing', () => {
            const event = createMockArticleEvent('![Alt text](https://example.com/fallback.png)\n\nContent');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.image()).toBe('https://example.com/fallback.png');
        });

        it('should fallback to standalone image URL', () => {
            const event = createMockArticleEvent('Here is an image: https://example.com/standalone.jpg');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.image()).toBe('https://example.com/standalone.jpg');
        });

        it('should return null when no image tag or content image', () => {
            const event = createMockArticleEvent('Just text content');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.image()).toBeNull();
        });
    });

    describe('Summary extraction', () => {
        it('should extract summary from tags', () => {
            const event = createMockArticleEvent('Article content', [['summary', 'This is the article summary']]);
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.summary()).toBe('This is the article summary');
        });

        it('should fallback to first paragraph when summary tag is missing', () => {
            const event = createMockArticleEvent('# Title\n\nThis is the first paragraph with enough text to be a good summary.\n\nSecond paragraph.');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.summary()).toBe('This is the first paragraph with enough text to be a good summary.');
        });

        it('should skip short paragraphs', () => {
            const event = createMockArticleEvent('# Title\n\nShort\n\nThis is a longer paragraph that should be used as the summary.');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.summary()).toBe('This is a longer paragraph that should be used as the summary.');
        });

        it('should return null when no summary tag or suitable paragraph', () => {
            const event = createMockArticleEvent('# Title\n\nShort');
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.summary()).toBeNull();
        });
    });

    describe('Truncated summary', () => {
        it('should not truncate short summaries', () => {
            const event = createMockArticleEvent('Content', [['summary', 'Short summary']]);
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            expect(component.truncatedSummary()).toBe('Short summary');
        });

        it('should truncate long summaries', () => {
            const longSummary = 'a'.repeat(250);
            const event = createMockArticleEvent('Content', [['summary', longSummary]]);
            fixture.componentRef.setInput('event', event);
            fixture.detectChanges();

            const truncated = component.truncatedSummary();
            expect(truncated).not.toBeNull();
            expect(truncated!.length).toBeLessThan(longSummary.length);
            expect(truncated!.endsWith('…')).toBe(true);
        });
    });
});
