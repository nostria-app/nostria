import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EmojiPickerComponent } from './emoji-picker.component';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

describe('EmojiPickerComponent', () => {
  let component: EmojiPickerComponent;
  let fixture: ComponentFixture<EmojiPickerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EmojiPickerComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AccountLocalStateService,
          useValue: {
            getRecentEmojis: jasmine.createSpy('getRecentEmojis').and.returnValue([]),
            addRecentEmoji: jasmine.createSpy('addRecentEmoji'),
          },
        },
        {
          provide: AccountStateService,
          useValue: {
            pubkey: jasmine.createSpy('pubkey').and.returnValue('test-pubkey'),
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

  it('should emit emojiSelected when an emoji is selected', () => {
    const spy = spyOn(component.emojiSelected, 'emit');
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
});
