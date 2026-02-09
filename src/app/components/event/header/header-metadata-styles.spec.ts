/**
 * Tests for note header secondary metadata styling.
 *
 * These tests verify that NIP-05 (alias/npub), timestamp, and edited
 * indicator use reduced visual weight so the display name stands out
 * more in the feed.
 */
import { Component, ViewEncapsulation } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

@Component({
  selector: 'app-header-metadata-style-test',
  encapsulation: ViewEncapsulation.None,
  styles: [`
    .user-profile-npub {
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px;
      opacity: 0.8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      word-break: break-all;
    }
    .date-link {
      cursor: pointer;
      margin-right: 0.4rem;
      font-size: 13px;
      opacity: 0.8;
    }
    .edited-indicator {
      color: var(--mat-sys-outline);
      font-size: 13px;
      opacity: 0.8;
      cursor: default;
      margin-right: 0.4rem;
    }
  `],
  template: `
    <div class="user-profile-npub">@alice&#64;example.com</div>
    <a class="date-link">5 minutes ago</a>
    <span class="edited-indicator">(edited)</span>
  `,
})
class HeaderMetadataStyleTestComponent {}

describe('Note header secondary metadata styles', () => {
  let fixture: ComponentFixture<HeaderMetadataStyleTestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderMetadataStyleTestComponent],
      providers: [
        provideZonelessChangeDetection(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderMetadataStyleTestComponent);
    fixture.detectChanges();
  });

  describe('NIP-05 address (user-profile-npub)', () => {
    it('should have font-size of 13px', () => {
      const el = fixture.nativeElement.querySelector('.user-profile-npub') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.fontSize).toBe('13px');
    });

    it('should have reduced opacity of 0.8', () => {
      const el = fixture.nativeElement.querySelector('.user-profile-npub') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.opacity).toBe('0.8');
    });
  });

  describe('timestamp (date-link)', () => {
    it('should have font-size of 13px', () => {
      const el = fixture.nativeElement.querySelector('.date-link') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.fontSize).toBe('13px');
    });

    it('should have reduced opacity of 0.8', () => {
      const el = fixture.nativeElement.querySelector('.date-link') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.opacity).toBe('0.8');
    });
  });

  describe('edited indicator', () => {
    it('should have font-size of 13px', () => {
      const el = fixture.nativeElement.querySelector('.edited-indicator') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.fontSize).toBe('13px');
    });

    it('should have reduced opacity of 0.8', () => {
      const el = fixture.nativeElement.querySelector('.edited-indicator') as HTMLElement;
      const styles = getComputedStyle(el);
      expect(styles.opacity).toBe('0.8');
    });
  });
});
