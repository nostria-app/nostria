import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { NostrService } from '../../../services/nostr.service';
import { PublishService } from '../../../services/publish.service';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';
import { StreamingAppsDialogComponent } from './streaming-apps-dialog.component';

describe('StreamingAppsDialogComponent', () => {
  let component: StreamingAppsDialogComponent;
  let fixture: ComponentFixture<StreamingAppsDialogComponent>;

  const pubkey = 'f'.repeat(64);

  const mockDialogRef = {
    close: vi.fn(),
  };

  const mockRouter = {
    navigate: vi.fn().mockResolvedValue(true),
  };

  const mockSnackBar = {
    open: vi.fn(),
  };

  const mockLogger = {
    error: vi.fn(),
  };

  const mockAccountState = {
    pubkey: vi.fn(() => pubkey),
  };

  const mockNostrService = {
    createEvent: vi.fn((kind: number, content: string, tags: string[][]) => ({
      kind,
      content,
      tags,
      created_at: 1,
      pubkey,
    })),
    signEvent: vi.fn(async (event: { kind: number; content: string; tags: string[][]; created_at: number; pubkey: string }) => ({
      ...event,
      id: 'event-id',
      sig: 'signature',
    })),
  };

  const mockPublishService = {
    publish: vi.fn(async (event: unknown) => ({
      success: true,
      relayResults: new Map(),
      event,
    })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [StreamingAppsDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CustomDialogRef, useValue: mockDialogRef },
        { provide: Router, useValue: mockRouter },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: LoggerService, useValue: mockLogger },
        { provide: AccountStateService, useValue: mockAccountState },
        { provide: NostrService, useValue: mockNostrService },
        { provide: PublishService, useValue: mockPublishService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StreamingAppsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should publish a live stream with NIP-53 tags', async () => {
    component.onTitleChange('Friday Night Stream');
    component.onStatusChange('live');
    component.streamingUrl.set('https://cdn.example.com/live/index.m3u8');
    component.platformUrl.set('https://zap.stream/host/friday-night-stream');
    component.summary.set('Streaming from Nostria');
    component.imageUrl.set('https://cdn.example.com/thumb.jpg');
    component.hashtagsInput.set('nostr, gaming');
    component.streamIdentifier.set('friday-night-stream');

    await component.publishStream();

    expect(mockNostrService.createEvent).toHaveBeenCalledWith(
      30311,
      '',
      expect.arrayContaining([
        ['d', 'friday-night-stream'],
        ['title', 'Friday Night Stream'],
        ['status', 'live'],
        ['p', pubkey, '', 'Host'],
        ['summary', 'Streaming from Nostria'],
        ['streaming', 'https://cdn.example.com/live/index.m3u8'],
        ['alt', 'Watch live on https://zap.stream/host/friday-night-stream'],
        ['service', 'https://zap.stream'],
        ['image', 'https://cdn.example.com/thumb.jpg'],
        ['t', 'nostr'],
        ['t', 'gaming'],
      ]),
    );
    expect(mockPublishService.publish).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalled();
    expect(mockDialogRef.close).toHaveBeenCalledWith({
      identifier: 'friday-night-stream',
      naddr: expect.any(String),
    });
  });

  it('should require a playback URL for live streams', async () => {
    component.onTitleChange('No Playback URL');
    component.onStatusChange('live');
    component.streamingUrl.set('');

    await component.publishStream();

    expect(mockSnackBar.open).toHaveBeenCalled();
    expect(mockNostrService.createEvent).not.toHaveBeenCalled();
  });
});
