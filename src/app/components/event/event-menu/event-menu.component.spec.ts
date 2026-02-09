import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { EventMenuComponent } from './event-menu.component';
import { kinds } from 'nostr-tools';

describe('EventMenuComponent', () => {
  let component: EventMenuComponent;
  let fixture: ComponentFixture<EventMenuComponent>;

  const mockEvent = {
    id: 'test-event-id',
    pubkey: 'test-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind: kinds.ShortTextNote,
    tags: [],
    content: 'Hello, world!',
    sig: 'test-sig',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventMenuComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideAnimationsAsync(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventMenuComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('event', mockEvent);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('menu item ordering', () => {
    it('should render Share before Translate in the menu', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      // Open the menu
      const menuTrigger = fixture.nativeElement.querySelector('[mat-icon-button]') as HTMLElement;
      menuTrigger?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      // Get all menu items from the overlay (mat-menu renders in CDK overlay)
      const overlayContainer = document.querySelector('.cdk-overlay-container');
      if (overlayContainer) {
        const menuItems = Array.from(overlayContainer.querySelectorAll('[mat-menu-item]'));
        const menuTexts = menuItems.map(el => el.textContent?.trim() ?? '');

        const shareIndex = menuTexts.findIndex(text => text.includes('Share'));
        const translateIndex = menuTexts.findIndex(text => text.includes('Translate'));

        // Share should always be present
        expect(shareIndex).toBeGreaterThanOrEqual(0);

        // If Translate is visible (AI enabled), Share should come before it
        if (translateIndex >= 0) {
          expect(shareIndex).toBeLessThan(translateIndex);
        }
      }
    });

    it('should render Share before Bookmark before Advanced', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      const menuTrigger = fixture.nativeElement.querySelector('[mat-icon-button]') as HTMLElement;
      menuTrigger?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const overlayContainer = document.querySelector('.cdk-overlay-container');
      if (overlayContainer) {
        const menuItems = Array.from(overlayContainer.querySelectorAll('[mat-menu-item]'));
        const menuTexts = menuItems.map(el => el.textContent?.trim() ?? '');

        const shareIndex = menuTexts.findIndex(text => text.includes('Share'));
        const bookmarkIndex = menuTexts.findIndex(text => text.includes('Bookmark'));
        const advancedIndex = menuTexts.findIndex(text => text.includes('Advanced'));

        expect(shareIndex).toBeGreaterThanOrEqual(0);
        expect(bookmarkIndex).toBeGreaterThanOrEqual(0);
        expect(advancedIndex).toBeGreaterThanOrEqual(0);

        // Share -> Bookmark -> Advanced
        expect(shareIndex).toBeLessThan(bookmarkIndex);
        expect(bookmarkIndex).toBeLessThan(advancedIndex);
      }
    });

    it('should render Report Content before Read Aloud when AI is enabled', async () => {
      // Enable AI in settings
      component.settings.settings().aiEnabled = true;
      fixture.detectChanges();
      await fixture.whenStable();

      const menuTrigger = fixture.nativeElement.querySelector('[mat-icon-button]') as HTMLElement;
      menuTrigger?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const overlayContainer = document.querySelector('.cdk-overlay-container');
      if (overlayContainer) {
        const menuItems = Array.from(overlayContainer.querySelectorAll('[mat-menu-item]'));
        const menuTexts = menuItems.map(el => el.textContent?.trim() ?? '');

        const reportIndex = menuTexts.findIndex(text => text.includes('Report Content'));
        const readAloudIndex = menuTexts.findIndex(text => text.includes('Read Aloud'));

        expect(reportIndex).toBeGreaterThanOrEqual(0);

        // If Read Aloud is visible, it should be after Report Content (at bottom)
        if (readAloudIndex >= 0) {
          expect(reportIndex).toBeLessThan(readAloudIndex);
        }
      }
    });

    it('should render Copy as first menu item', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      const menuTrigger = fixture.nativeElement.querySelector('[mat-icon-button]') as HTMLElement;
      menuTrigger?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const overlayContainer = document.querySelector('.cdk-overlay-container');
      if (overlayContainer) {
        const menuItems = Array.from(overlayContainer.querySelectorAll('[mat-menu-item]'));
        const menuTexts = menuItems.map(el => el.textContent?.trim() ?? '');

        expect(menuTexts.length).toBeGreaterThan(0);
        expect(menuTexts[0]).toContain('Copy');
      }
    });
  });

  describe('computed signals', () => {
    it('should detect text note kind', () => {
      expect(component.isTextNote()).toBe(true);
    });

    it('should not detect article for text note', () => {
      expect(component.isArticle()).toBe(false);
    });

    it('should show AI options when AI is enabled and event is text note', () => {
      component.settings.settings().aiEnabled = true;
      // showAiOptions checks settings.aiEnabled and isTextNote
      expect(component.showAiOptions()).toBe(true);
    });

    it('should not show AI options when AI is disabled', () => {
      component.settings.settings().aiEnabled = false;
      expect(component.showAiOptions()).toBe(false);
    });

    it('should not show pin options when not on own profile', () => {
      // Default mock event has different pubkey from account
      expect(component.showPinOptions()).toBe(false);
    });
  });
});
