import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { LiveStreamBroadcastService } from './live-stream-broadcast.service';
import { LoggerService } from './logger.service';

describe('LiveStreamBroadcastService', () => {
  let service: LiveStreamBroadcastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        LiveStreamBroadcastService,
        {
          provide: LoggerService,
          useValue: {
            error: vi.fn(),
            warn: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(LiveStreamBroadcastService);
  });

  it('should strip end-of-candidates from WHIP answers', () => {
    const normalizeWhipAnswerSdp = (service as unknown as {
      normalizeWhipAnswerSdp: (sdp: string) => string;
    }).normalizeWhipAnswerSdp;

    const normalizedSdp = normalizeWhipAnswerSdp([
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=mid:0',
      'a=end-of-candidates',
      '',
    ].join('\n'));

    expect(normalizedSdp).toBe([
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=mid:0',
      '',
    ].join('\r\n'));
  });

  it('should normalize line endings for WHIP answers', () => {
    const normalizeWhipAnswerSdp = (service as unknown as {
      normalizeWhipAnswerSdp: (sdp: string) => string;
    }).normalizeWhipAnswerSdp;

    const normalizedSdp = normalizeWhipAnswerSdp('v=0\no=- 0 0 IN IP4 127.0.0.1\ns=-');

    expect(normalizedSdp).toBe('v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n');
  });
});