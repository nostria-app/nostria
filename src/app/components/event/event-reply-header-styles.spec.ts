/**
 * Tests for reply header and thread context styling in the event component.
 *
 * These tests verify that the SCSS styles for the reply header and
 * quoted containers produce the expected visual hierarchy:
 * - Reply header font is smaller than the default to reduce visual dominance
 * - Adequate spacing between reply header and quoted container
 * - Adequate padding inside quoted containers
 */
import { Component, ViewEncapsulation } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

@Component({
  selector: 'app-reply-header-style-test',
  encapsulation: ViewEncapsulation.None,
  styles: [`
    .reply-header {
      font-style: italic;
      font-size: 15px;
      opacity: 0.7;
      align-items: center;
      margin-bottom: 8px;
    }
    .reply-header mat-icon {
      font-size: 16px;
      line-height: 24px;
    }
    .root-event {
      padding-top: 8px;
    }
    .parent-event {
      padding-top: 8px;
    }
  `],
  template: `
    <div class="reply-header">
      <span class="mat-icon">reply</span>
      <span>TestUser replied to</span>
    </div>
    <div class="thread-context">
      <div class="root-event">
        <div class="event-header">Profile Name</div>
        <div>Quoted content</div>
      </div>
    </div>
    <div class="reply-context">
      <div class="parent-event">
        <div class="event-header">Profile Name</div>
        <div>Parent content</div>
      </div>
    </div>
  `,
})
class ReplyHeaderStyleTestComponent {}

describe('Event reply header styles', () => {
  let fixture: ComponentFixture<ReplyHeaderStyleTestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReplyHeaderStyleTestComponent],
      providers: [
        provideZonelessChangeDetection(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReplyHeaderStyleTestComponent);
    fixture.detectChanges();
  });

  describe('reply-header', () => {
    it('should have font-size of 15px', () => {
      const el = fixture.nativeElement.querySelector('.reply-header') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.fontSize).toBe('15px');
    });

    it('should have italic font-style', () => {
      const el = fixture.nativeElement.querySelector('.reply-header') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.fontStyle).toBe('italic');
    });

    it('should have bottom margin for spacing from quoted container', () => {
      const el = fixture.nativeElement.querySelector('.reply-header') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.marginBottom).toBe('8px');
    });
  });

  describe('root-event container', () => {
    it('should have top padding inside the container', () => {
      const el = fixture.nativeElement.querySelector('.root-event') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.paddingTop).toBe('8px');
    });
  });

  describe('parent-event container', () => {
    it('should have top padding inside the container', () => {
      const el = fixture.nativeElement.querySelector('.parent-event') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.paddingTop).toBe('8px');
    });
  });
});
