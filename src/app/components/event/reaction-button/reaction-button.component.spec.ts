import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
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

  describe('signing error handling', () => {
    it('should initially have showSigningErrorDialog as false', () => {
      expect(component.showSigningErrorDialog()).toBe(false);
    });

    it('should initially have empty signingErrorMessage', () => {
      expect(component.signingErrorMessage()).toBe('');
    });

    it('should detect extension not found error as extension error', () => {
      const result = component.isExtensionError(
        'Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension, or re-login with your nsec key.'
      );
      expect(result).toBe(true);
    });

    it('should detect NIP-07 error as extension error', () => {
      const result = component.isExtensionError(
        'NIP-07 extension is not available'
      );
      expect(result).toBe(true);
    });

    it('should detect generic extension error', () => {
      const result = component.isExtensionError(
        'The extension did not respond'
      );
      expect(result).toBe(true);
    });

    it('should not treat undefined error as extension error', () => {
      const result = component.isExtensionError(undefined);
      expect(result).toBe(false);
    });

    it('should not treat generic publish error as extension error', () => {
      const result = component.isExtensionError(
        'Failed to publish to relays'
      );
      expect(result).toBe(false);
    });

    it('should show dialog for extension errors', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const snackBarSpy = spyOn(snackBar, 'open');

      component.handleReactionError(
        'Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension, or re-login with your nsec key.',
        'Failed to add reaction. Please try again.'
      );

      expect(component.showSigningErrorDialog()).toBe(true);
      expect(component.signingErrorMessage()).toContain('Nostr extension not found');
      expect(snackBarSpy).not.toHaveBeenCalled();
    });

    it('should show snackbar for non-extension errors', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const snackBarSpy = spyOn(snackBar, 'open');

      component.handleReactionError(
        undefined,
        'Failed to add reaction. Please try again.'
      );

      expect(component.showSigningErrorDialog()).toBe(false);
      expect(snackBarSpy).toHaveBeenCalledWith(
        'Failed to add reaction. Please try again.',
        'Dismiss',
        { duration: 3000 }
      );
    });

    it('should show snackbar for generic errors', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const snackBarSpy = spyOn(snackBar, 'open');

      component.handleReactionError(
        'Some network error',
        'Failed to add reaction. Please try again.'
      );

      expect(component.showSigningErrorDialog()).toBe(false);
      expect(snackBarSpy).toHaveBeenCalledWith(
        'Failed to add reaction. Please try again.',
        'Dismiss',
        { duration: 3000 }
      );
    });

    it('should close signing error dialog and clear message', () => {
      component.showSigningErrorDialog.set(true);
      component.signingErrorMessage.set('Some error');

      component.closeSigningErrorDialog();

      expect(component.showSigningErrorDialog()).toBe(false);
      expect(component.signingErrorMessage()).toBe('');
    });
  });
});
