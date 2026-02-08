import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ReactionButtonComponent } from './reaction-button.component';

describe('ReactionButtonComponent', () => {
  let component: ReactionButtonComponent;
  let fixture: ComponentFixture<ReactionButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReactionButtonComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReactionButtonComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('emoji categories', () => {
    it('should have a nature category', () => {
      const natureCategory = component.emojiCategories.find(c => c.id === 'nature');
      expect(natureCategory).toBeTruthy();
    });

    it('should have correct label and icon for nature category', () => {
      const natureCategory = component.emojiCategories.find(c => c.id === 'nature');
      expect(natureCategory!.label).toBe('Nature');
      expect(natureCategory!.icon).toBe('eco');
    });

    it('should have nature emojis in the nature category', () => {
      const natureCategory = component.emojiCategories.find(c => c.id === 'nature');
      expect(natureCategory!.emojis.length).toBeGreaterThan(0);
      // Verify key nature emojis are present
      expect(natureCategory!.emojis).toContain('🌸');
      expect(natureCategory!.emojis).toContain('🌹');
      expect(natureCategory!.emojis).toContain('🌻');
      expect(natureCategory!.emojis).toContain('🌲');
      expect(natureCategory!.emojis).toContain('🌈');
      expect(natureCategory!.emojis).toContain('☀️');
      expect(natureCategory!.emojis).toContain('❄️');
      expect(natureCategory!.emojis).toContain('🌊');
    });

    it('should have nature category positioned after animals', () => {
      const animalsIndex = component.emojiCategories.findIndex(c => c.id === 'animals');
      const natureIndex = component.emojiCategories.findIndex(c => c.id === 'nature');
      expect(natureIndex).toBe(animalsIndex + 1);
    });

    it('should not have duplicate emojis within the nature category', () => {
      const natureCategory = component.emojiCategories.find(c => c.id === 'nature');
      const uniqueEmojis = new Set(natureCategory!.emojis);
      expect(uniqueEmojis.size).toBe(natureCategory!.emojis.length);
    });

    it('should have all expected categories', () => {
      const categoryIds = component.emojiCategories.map(c => c.id);
      expect(categoryIds).toContain('smileys');
      expect(categoryIds).toContain('gestures');
      expect(categoryIds).toContain('hearts');
      expect(categoryIds).toContain('animals');
      expect(categoryIds).toContain('nature');
      expect(categoryIds).toContain('food');
      expect(categoryIds).toContain('activities');
      expect(categoryIds).toContain('travel');
      expect(categoryIds).toContain('objects');
      expect(categoryIds).toContain('symbols');
      expect(categoryIds).toContain('flags');
    });
  });
});
