import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event, kinds } from 'nostr-tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactionButtonComponent } from './reaction-button.component';
import { LayoutService } from '../../../services/layout.service';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ReactionService } from '../../../services/reaction.service';
import { EventService } from '../../../services/event';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { EmojiSetService } from '../../../services/emoji-set.service';
import { DataService } from '../../../services/data.service';
import { DatabaseService } from '../../../services/database.service';
import { LoggerService } from '../../../services/logger.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';

describe('ReactionButtonComponent', () => {
  let component: ReactionButtonComponent;
  let fixture: ComponentFixture<ReactionButtonComponent>;
  const isHandset = signal(false);
  const defaultReactionEmoji = signal('❤️');
  const account = signal({ pubkey: 'test-pubkey', source: 'private-key' } as any);
  const pubkey = signal('test-pubkey');
  const reactionService = {
    addLike: vi.fn(),
    deleteReaction: vi.fn(),
    addReaction: vi.fn(),
  };

  const targetEvent: Event = {
    id: 'event-1',
    pubkey: 'author-pubkey',
    created_at: 1,
    kind: kinds.ShortTextNote,
    content: 'hello',
    tags: [],
    sig: 'sig',
  };

  function setRequiredInputs(): void {
    fixture.componentRef.setInput('event', targetEvent);
    fixture.componentRef.setInput('reactionsFromParent', { events: [], data: new Map() });
    fixture.detectChanges();
  }

  function createPointerEvent(type: string, init: PointerEventInit = {}): PointerEvent {
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      ...init,
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReactionButtonComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: LayoutService,
          useValue: {
            isHandset,
            showLoginDialog: vi.fn(),
          },
        },
        {
          provide: AccountStateService,
          useValue: {
            pubkey,
            account,
          },
        },
        {
          provide: ReactionService,
          useValue: reactionService,
        },
        {
          provide: EventService,
          useValue: {
            loadReactions: vi.fn().mockResolvedValue({ events: [], data: new Map() }),
          },
        },
        {
          provide: AccountLocalStateService,
          useValue: {
            getRecentEmojis: vi.fn().mockReturnValue([]),
            addRecentEmoji: vi.fn(),
          },
        },
        {
          provide: EmojiSetService,
          useValue: {
            preferencesChanged: signal(0),
            getUserEmojiSets: vi.fn().mockResolvedValue(new Map()),
            getUserEmojiSetsGrouped: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: DataService,
          useValue: {},
        },
        {
          provide: DatabaseService,
          useValue: {},
        },
        {
          provide: LoggerService,
          useValue: {
            error: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
          },
        },
        {
          provide: CustomDialogService,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: LocalSettingsService,
          useValue: {
            defaultReactionEmoji,
            setDefaultReactionEmoji: (value: string) => defaultReactionEmoji.set(value),
          },
        },
        {
          provide: MatSnackBar,
          useValue: {
            open: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReactionButtonComponent);
    component = fixture.componentInstance;
    isHandset.set(false);
    defaultReactionEmoji.set('❤️');
    pubkey.set('test-pubkey');
    account.set({ pubkey: 'test-pubkey', source: 'private-key' } as any);
    reactionService.addLike.mockReset();
    reactionService.deleteReaction.mockReset();
    reactionService.addReaction.mockReset();
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
      expect(natureCategory!.icon).toBe('🌿');
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
      expect(categoryIds).toContain('people');
      expect(categoryIds).toContain('animals');
      expect(categoryIds).toContain('nature');
      expect(categoryIds).toContain('food');
      expect(categoryIds).toContain('activities');
      expect(categoryIds).toContain('travel');
      expect(categoryIds).toContain('objects');
      expect(categoryIds).toContain('symbols');
      expect(categoryIds).toContain('flags');
    });

    it('should include Unicode 17 additions across the shared catalog', () => {
      const allEmojis = component.emojiCategories.flatMap(category => category.emojis);
      expect(allEmojis).toContain('🫩');
      expect(allEmojis).toContain('🪿');
      expect(allEmojis).toContain('🫟');
    });
  });

  describe('sendDefaultReaction', () => {
    it('should call addReaction with default emoji from settings', () => {
      const addReactionSpy = vi.spyOn(component, 'addReaction');
      const localSettings = TestBed.inject(LocalSettingsService);
      localSettings.setDefaultReactionEmoji('🔥');

      component.sendDefaultReaction();

      expect(addReactionSpy).toHaveBeenCalledWith('🔥', false);
    });

    it('should call addReaction with heart emoji when using default settings', () => {
      const addReactionSpy = vi.spyOn(component, 'addReaction');

      component.sendDefaultReaction();

      expect(addReactionSpy).toHaveBeenCalledWith('❤️', false);
    });

    it('should toggle the existing reaction off instead of adding another one', () => {
      const toggleLikeSpy = vi.spyOn(component, 'toggleLike').mockResolvedValue(undefined);
      component.reactions.set({
        events: [{
          event: {
            id: 'reaction-1',
            pubkey: 'test-pubkey',
            created_at: 1,
            kind: kinds.Reaction,
            content: '+',
            tags: [],
            sig: 'sig',
          },
          data: '+',
        }],
        data: new Map([['+', 1]]),
      });

      component.sendDefaultReaction();

      expect(toggleLikeSpy).toHaveBeenCalled();
    });

    it('should open menu when default emoji is empty string', () => {
      const openMenuSpy = vi.spyOn(component, 'openMenu');
      const addReactionSpy = vi.spyOn(component, 'addReaction');
      const localSettings = TestBed.inject(LocalSettingsService);
      localSettings.setDefaultReactionEmoji('');

      component.sendDefaultReaction();

      expect(openMenuSpy).toHaveBeenCalled();
      expect(addReactionSpy).not.toHaveBeenCalled();
    });

    it('should open the shared mobile picker dialog on handset screens', () => {
      isHandset.set(true);
      const openDialogSpy = vi.spyOn(component as any, 'openReactionPickerDialog')
        .mockResolvedValue(undefined);

      component.openMenu();

      expect(openDialogSpy).toHaveBeenCalled();
    });
  });

  describe('long-press detection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should send default reaction on quick pointer up (no long press)', () => {
      const sendDefaultReactionSpy = vi.spyOn(component, 'sendDefaultReaction');
      const pointerEvent = new PointerEvent('pointerup', { cancelable: true });

      // Simulate pointer down then quick pointer up
      component.onPointerDown(createPointerEvent('pointerdown'));
      component.onPointerUp(pointerEvent);

      expect(sendDefaultReactionSpy).toHaveBeenCalled();
    });

    it('should open menu on long press', () => {
      const openMenuSpy = vi.spyOn(component, 'openMenu');

      component.onPointerDown(createPointerEvent('pointerdown'));

      vi.advanceTimersByTime(600);

      expect(openMenuSpy).toHaveBeenCalled();
    });

    it('should not send default reaction after long press completes', () => {
      const sendDefaultReactionSpy = vi.spyOn(component, 'sendDefaultReaction');
      vi.spyOn(component, 'openMenu');

      component.onPointerDown(createPointerEvent('pointerdown'));

      vi.advanceTimersByTime(600);

      const pointerEvent = new PointerEvent('pointerup', { cancelable: true });
      component.onPointerUp(pointerEvent);

      expect(sendDefaultReactionSpy).not.toHaveBeenCalled();
    });

    it('should cancel long press on pointer leave', () => {
      const openMenuSpy = vi.spyOn(component, 'openMenu');

      component.onPointerDown(createPointerEvent('pointerdown'));
      // Cancel immediately
      component.onPointerLeave();

      vi.advanceTimersByTime(600);

      expect(openMenuSpy).not.toHaveBeenCalled();
    });

    it('should reset longPressTriggered after pointer up', () => {
      const sendDefaultReactionSpy = vi.spyOn(component, 'sendDefaultReaction');

      // First interaction: quick tap
      component.onPointerDown(createPointerEvent('pointerdown'));
      component.onPointerUp(new PointerEvent('pointerup', { cancelable: true }));
      expect(sendDefaultReactionSpy).toHaveBeenCalledTimes(1);

      // Second interaction: quick tap should also work
      component.onPointerDown(createPointerEvent('pointerdown'));
      component.onPointerUp(new PointerEvent('pointerup', { cancelable: true }));
      expect(sendDefaultReactionSpy).toHaveBeenCalledTimes(2);
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
      const result = component.isExtensionError('Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension, or re-login with your nsec key.');
      expect(result).toBe(true);
    });

    it('should detect NIP-07 error as extension error', () => {
      const result = component.isExtensionError('NIP-07 extension is not available');
      expect(result).toBe(true);
    });

    it('should detect generic extension error', () => {
      const result = component.isExtensionError('The extension did not respond');
      expect(result).toBe(true);
    });

    it('should not treat undefined error as extension error', () => {
      const result = component.isExtensionError(undefined);
      expect(result).toBe(false);
    });

    it('should not treat generic publish error as extension error', () => {
      const result = component.isExtensionError('Failed to publish to relays');
      expect(result).toBe(false);
    });

    it('should show dialog for extension errors', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const snackBarSpy = vi.spyOn(snackBar, 'open');

      component.handleReactionError('Nostr extension not found. Please install Alby, nos2x, or another NIP-07 compatible extension, or re-login with your nsec key.', 'Failed to add reaction. Please try again.');

      expect(component.showSigningErrorDialog()).toBe(true);
      expect(component.signingErrorMessage()).toContain('Nostr extension not found');
      expect(snackBarSpy).not.toHaveBeenCalled();
    });

    it('should show snackbar for non-extension errors', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const snackBarSpy = vi.spyOn(snackBar, 'open');

      component.handleReactionError(undefined, 'Failed to add reaction. Please try again.');

      expect(component.showSigningErrorDialog()).toBe(false);
      expect(snackBarSpy).toHaveBeenCalledWith('Failed to add reaction. Please try again.', 'Dismiss', { duration: 3000 });
    });

    it('should show snackbar for generic errors', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const snackBarSpy = vi.spyOn(snackBar, 'open');

      component.handleReactionError('Some network error', 'Failed to add reaction. Please try again.');

      expect(component.showSigningErrorDialog()).toBe(false);
      expect(snackBarSpy).toHaveBeenCalledWith('Failed to add reaction. Please try again.', 'Dismiss', { duration: 3000 });
    });

    it('should close signing error dialog and clear message', () => {
      component.showSigningErrorDialog.set(true);
      component.signingErrorMessage.set('Some error');

      component.closeSigningErrorDialog();

      expect(component.showSigningErrorDialog()).toBe(false);
      expect(component.signingErrorMessage()).toBe('');
    });
  });

  describe('desktop hover picker', () => {
    beforeEach(() => {
      setRequiredInputs();
    });

    it('should open the quick reaction menu on hover enter', async () => {
      fixture.componentRef.setInput('enableDesktopHoverPicker', true);
      fixture.detectChanges();

      component.onDesktopMouseEnter();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('.desktop-quick-reaction-menu')).toBeTruthy();
    });

    it('should close the quick reaction menu after hover leave timeout', async () => {
      vi.useFakeTimers();

      fixture.componentRef.setInput('enableDesktopHoverPicker', true);
      fixture.detectChanges();

      component.onDesktopMouseEnter();
      fixture.detectChanges();
      await fixture.whenStable();

      component.onDesktopMouseLeave();
      vi.advanceTimersByTime(200);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('.desktop-quick-reaction-menu')).toBeFalsy();

      vi.useRealTimers();
    });
  });

  describe('toggleLike', () => {
    beforeEach(() => {
      setRequiredInputs();
    });

    it('should emit reactionChanged after deleting an existing reaction', async () => {
      reactionService.deleteReaction.mockResolvedValue({ success: true });
      const emitSpy = vi.spyOn(component.reactionChanged, 'emit');

      component.reactions.set({
        events: [{
          event: {
            id: 'reaction-1',
            pubkey: 'test-pubkey',
            created_at: 1,
            kind: kinds.Reaction,
            content: '+',
            tags: [],
            sig: 'sig',
          },
          data: '+',
        }],
        data: new Map([['+', 1]]),
      });

      await component.toggleLike();

      expect(reactionService.deleteReaction).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalled();
    });

    it('should emit reactionChanged after adding a new like', async () => {
      reactionService.addLike.mockResolvedValue({
        success: true,
        event: {
          id: 'reaction-2',
          pubkey: 'test-pubkey',
          created_at: 2,
          kind: kinds.Reaction,
          content: '+',
          tags: [],
          sig: 'sig',
        },
      });
      const emitSpy = vi.spyOn(component.reactionChanged, 'emit');

      component.reactions.set({ events: [], data: new Map() });

      await component.toggleLike();

      expect(reactionService.addLike).toHaveBeenCalledWith(targetEvent);
      expect(emitSpy).toHaveBeenCalled();
    });
  });
});
