import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EmojiPickerDialogComponent } from './emoji-picker-dialog.component';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

describe('EmojiPickerDialogComponent', () => {
  let component: EmojiPickerDialogComponent;
  let fixture: ComponentFixture<EmojiPickerDialogComponent>;
  let mockDialogRef: { close: jasmine.Spy };

  beforeEach(() => {
    mockDialogRef = { close: jasmine.createSpy('close') };

    TestBed.configureTestingModule({
      imports: [EmojiPickerDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CustomDialogRef, useValue: mockDialogRef },
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

    fixture = TestBed.createComponent(EmojiPickerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should close dialog with selected emoji', () => {
    component.onEmojiSelected('🎉');
    expect(mockDialogRef.close).toHaveBeenCalledWith('🎉');
  });

  it('should render the emoji picker inside dialog-content', async () => {
    await fixture.whenStable();
    const content = (fixture.nativeElement as HTMLElement).querySelector('[dialog-content]');
    expect(content).toBeTruthy();

    const picker = content!.querySelector('app-emoji-picker');
    expect(picker).toBeTruthy();
  });
});
