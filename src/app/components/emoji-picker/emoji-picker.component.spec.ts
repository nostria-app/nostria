import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EmojiPickerComponent } from './emoji-picker.component';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';
import { LocalSettingsService } from '../../services/local-settings.service';

describe('EmojiPickerComponent', () => {
  let component: EmojiPickerComponent;
  let fixture: ComponentFixture<EmojiPickerComponent>;
  let accountLocalState: {
    getRecentEmojis: ReturnType<typeof vi.fn>;
    addRecentEmoji: ReturnType<typeof vi.fn>;
    promoteRecentEmoji: ReturnType<typeof vi.fn>;
    getPreferredReactionEmoji: ReturnType<typeof vi.fn>;
    setPreferredReactionEmoji: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    accountLocalState = {
      getRecentEmojis: vi.fn().mockReturnValue([]),
      addRecentEmoji: vi.fn(),
      promoteRecentEmoji: vi.fn(),
      getPreferredReactionEmoji: vi.fn().mockReturnValue(''),
      setPreferredReactionEmoji: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AccountLocalStateService,
          useValue: accountLocalState,
        },
        {
          provide: AccountStateService,
          useValue: {
            pubkey: vi.fn().mockReturnValue('test-pubkey'),
          },
        },
        {
          provide: LocalSettingsService,
          useValue: {
            defaultReactionEmoji: vi.fn().mockReturnValue('❤️'),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(EmojiPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have emoji categories', () => {
    expect(component.categories.length).toBeGreaterThan(0);
  });

  it('should include the people category from the shared Unicode 17 catalog', () => {
    expect(component.categories.some(category => category.id === 'people')).toBe(true);
  });

  it('should include Unicode 17 additions in the picker catalog', () => {
    const allEmojis = component.categories.flatMap(category => category.emojis);
    expect(allEmojis).toContain('🫩');
    expect(allEmojis).toContain('🪿');
    expect(allEmojis).toContain('🫟');
  });

  it('should emit emojiSelected when an emoji is selected', () => {
    const spy = vi.spyOn(component.emojiSelected, 'emit');
    component.selectEmoji('😀');
    expect(spy).toHaveBeenCalledWith('😀');
  });

  it('should track recent emojis after selection', () => {
    const accountLocalState = TestBed.inject(AccountLocalStateService);
    component.selectEmoji('😀');
    expect(accountLocalState.addRecentEmoji).toHaveBeenCalledWith('test-pubkey', '😀');
  });

  it('should filter emojis by search query', () => {
    component.searchQuery.set('laugh');
    const results = component.filteredEmojis();
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return empty results for non-matching search', () => {
    component.searchQuery.set('zzzznonexistent');
    const results = component.filteredEmojis();
    expect(results.length).toBe(0);
  });

  it('should render the emoji picker container', async () => {
    await fixture.whenStable();
    const el = (fixture.nativeElement as HTMLElement).querySelector('.emoji-picker');
    expect(el).toBeTruthy();
  });

  it('should render the search input', async () => {
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('.emoji-search input');
    expect(input).toBeTruthy();
  });

  it('should render section jump buttons for each visible section', async () => {
    await fixture.whenStable();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('.section-nav-btn');
    expect(buttons.length).toBe(component.categories.length + 1);
  });

  it('should render plus and minus reaction buttons in reaction mode', async () => {
    fixture.componentRef.setInput('mode', 'reaction');
    fixture.detectChanges();
    await fixture.whenStable();

    const reactionSymbols = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.reaction-symbol'))
      .map(element => element.textContent?.trim());

    expect(reactionSymbols).toContain('+');
    expect(reactionSymbols).toContain('-');
  });

  it('should keep make most recent separate from make default', () => {
    component.emojiContextMenuTarget.set({ emoji: '🔥' });

    component.makeEmojiMostRecent();

    expect(accountLocalState.promoteRecentEmoji).toHaveBeenCalledWith('test-pubkey', '🔥', undefined);
    expect(accountLocalState.setPreferredReactionEmoji).not.toHaveBeenCalled();
  });

  it('should set the selected emoji as default from the context menu', () => {
    component.emojiContextMenuTarget.set({ emoji: '🔥' });

    component.makeEmojiDefault();

    expect(accountLocalState.setPreferredReactionEmoji).toHaveBeenCalledWith('test-pubkey', '🔥');
  });
});
