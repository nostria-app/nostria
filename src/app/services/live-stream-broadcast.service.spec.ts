import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { LiveStreamBroadcastService } from './live-stream-broadcast.service';
import { LoggerService } from './logger.service';

describe('LiveStreamBroadcastService', () => {
  let service: LiveStreamBroadcastService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should strip end-of-candidates from WHIP answers', () => {
    const normalizeWhipAnswerSdp = (service as unknown as {
      normalizeWhipAnswerSdp: (sdp: string) => { sdp: string; removedLines: string[] };
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

    expect(normalizedSdp.sdp).toBe([
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=mid:0',
      '',
    ].join('\r\n'));
    expect(normalizedSdp.removedLines).toEqual(['a=end-of-candidates']);
  });

  it('should normalize line endings for WHIP answers', () => {
    const normalizeWhipAnswerSdp = (service as unknown as {
      normalizeWhipAnswerSdp: (sdp: string) => { sdp: string; removedLines: string[] };
    }).normalizeWhipAnswerSdp;

    const normalizedSdp = normalizeWhipAnswerSdp('v=0\no=- 0 0 IN IP4 127.0.0.1\ns=-\nt=0 0\nm=audio 9 UDP/TLS/RTP/SAVPF 111');

    expect(normalizedSdp.sdp).toBe('v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n');
  });

  it('should remove invalid non-SDP lines from WHIP answers', () => {
    const normalizeWhipAnswerSdp = (service as unknown as {
      normalizeWhipAnswerSdp: (sdp: string) => { sdp: string; removedLines: string[] };
    }).normalizeWhipAnswerSdp;

    const normalizedSdp = normalizeWhipAnswerSdp([
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      '  a=end-of-candidates  ',
      'HTTP/1.1 201 Created',
      'a=mid:0',
    ].join('\n'));

    expect(normalizedSdp.sdp).toBe([
      'v=0',
      'o=- 0 0 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=mid:0',
      '',
    ].join('\r\n'));
    expect(normalizedSdp.removedLines).toEqual(['a=end-of-candidates', 'HTTP/1.1 201 Created']);
  });

  it('should reject WHIP answers that do not contain the required SDP envelope', () => {
    const normalizeWhipAnswerSdp = (service as unknown as {
      normalizeWhipAnswerSdp: (sdp: string) => { sdp: string; removedLines: string[] };
    }).normalizeWhipAnswerSdp;

    expect(() => normalizeWhipAnswerSdp('a=end-of-candidates\nnot-sdp')).toThrow(
      'WHIP endpoint returned an invalid SDP answer',
    );
  });

  it('should delete the allocated WHIP session if answer setup fails', async () => {
    const previewStream = {
      getTracks: () => [],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(previewStream),
      },
    });

    const peerConnection = {
      iceGatheringState: 'complete',
      localDescription: { sdp: 'v=0\r\n' },
      connectionState: 'new',
      onconnectionstatechange: null,
      addTrack: vi.fn(),
      createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0\r\n' }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      setRemoteDescription: vi.fn().mockRejectedValue(new Error('Invalid SDP answer')),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    };

    vi.stubGlobal('RTCPeerConnection', vi.fn(() => peerConnection));

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue('v=0\na=end-of-candidates\n'),
        headers: new Headers({ location: '/whip/resource/browser-session' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(''),
        headers: new Headers(),
      });

    await expect(service.startBroadcast({
      endpoint: 'https://stream.openresist.com/whip/endpoint/browser',
      token: 'browser-token',
    })).rejects.toThrow('Invalid SDP answer');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://stream.openresist.com/whip/resource/browser-session',
      {
        method: 'DELETE',
        keepalive: true,
        headers: { Authorization: 'Bearer browser-token' },
      },
    );
    expect(service.sessionUrl()).toBeNull();
  });

  it('should map occupied endpoint responses to an actionable error', () => {
    const createWhipResponseError = (service as unknown as {
      createWhipResponseError: (status: number, responseBody: string) => Error;
    }).createWhipResponseError;

    const error = createWhipResponseError(403, 'Endpoint ID already in use');

    expect(error.message).toBe(
      'The browser broadcast endpoint is already in use. Stop the existing browser stream or reset the browser endpoint before trying again.',
    );
  });

  it('should release the tracked WHIP session on pagehide', async () => {
    const closeWhipSession = vi.spyOn(service as unknown as {
      closeWhipSession: (sessionUrl: string, token: string | null) => Promise<void>;
    }, 'closeWhipSession').mockResolvedValue(undefined);

    const peerConnection = {
      onconnectionstatechange: null,
      close: vi.fn(),
    };

    (service as unknown as {
      peerConnection: { onconnectionstatechange: null; close: () => void } | null;
      currentWhipToken: string | null;
    }).peerConnection = peerConnection;
    (service as unknown as {
      currentWhipToken: string | null;
    }).currentWhipToken = 'browser-token';
    service.sessionUrl.set('https://stream.openresist.com/whip/resource/browser-session');

    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();

    expect(closeWhipSession).toHaveBeenCalledWith(
      'https://stream.openresist.com/whip/resource/browser-session',
      'browser-token',
    );
    expect(peerConnection.close).toHaveBeenCalled();
    expect(service.sessionUrl()).toBeNull();
  });
});