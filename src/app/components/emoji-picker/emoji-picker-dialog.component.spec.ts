import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { EmojiPickerDialogComponent } from './emoji-picker-dialog.component';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

describe('EmojiPickerDialogComponent', () => {
  let component: EmojiPickerDialogComponent;
  let fixture: ComponentFixture<EmojiPickerDialogComponent>;
  let mockDialogRef: {
    close: Mock;
  };

  beforeEach(() => {
    mockDialogRef = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [EmojiPickerDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { mode: 'content', activeTab: 'emoji' } },
        {
          provide: AccountLocalStateService,
          useValue: {
            getRecentEmojis: vi.fn().mockReturnValue([]),
            addRecentEmoji: vi.fn(),
          },
        },
        {
          provide: AccountStateService,
          useValue: {
            pubkey: vi.fn().mockReturnValue('test-pubkey'),
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
