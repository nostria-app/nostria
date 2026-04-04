import '@angular/compiler';
import { Injector } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParsingService } from './parsing.service';
import { DataService } from './data.service';
import { NostrService } from './nostr.service';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';
import { MediaPlayerService } from './media-player.service';
import { EmojiSetService } from './emoji-set.service';

describe('ParsingService', () => {
  let injector: Injector;
  let service: ParsingService;

  const mockDataService = {
    getProfile: vi.fn().mockName('DataService.getProfile'),
  } as unknown as Pick<DataService, 'getProfile'>;

  const mockNostrService = {} as NostrService;

  const mockUtilitiesService = {
    getTruncatedNpub: vi.fn().mockName('UtilitiesService.getTruncatedNpub'),
    normalizeRenderedEventContent: vi.fn().mockName('UtilitiesService.normalizeRenderedEventContent'),
  } as unknown as Pick<UtilitiesService, 'getTruncatedNpub' | 'normalizeRenderedEventContent'>;

  const mockLoggerService = {
    debug: vi.fn().mockName('LoggerService.debug'),
    info: vi.fn().mockName('LoggerService.info'),
    warn: vi.fn().mockName('LoggerService.warn'),
    error: vi.fn().mockName('LoggerService.error'),
  } as unknown as Pick<LoggerService, 'debug' | 'info' | 'warn' | 'error'>;

  const mockMediaPlayerService = {
    getYouTubeEmbedUrl: vi.fn().mockReturnValue((url: string) => url).mockName('MediaPlayerService.getYouTubeEmbedUrl'),
    getTidalEmbedUrl: vi.fn().mockReturnValue((url: string) => url).mockName('MediaPlayerService.getTidalEmbedUrl'),
    getSpotifyEmbedUrl: vi.fn().mockReturnValue((url: string) => url).mockName('MediaPlayerService.getSpotifyEmbedUrl'),
  } as unknown as Pick<MediaPlayerService, 'getYouTubeEmbedUrl' | 'getTidalEmbedUrl' | 'getSpotifyEmbedUrl'>;

  const mockEmojiSetService = {
    getUserEmojiSets: vi.fn().mockName('EmojiSetService.getUserEmojiSets'),
  } as unknown as Pick<EmojiSetService, 'getUserEmojiSets'>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockUtilitiesService.getTruncatedNpub).mockReturnValue('npub1test...');
    vi.mocked(mockUtilitiesService.normalizeRenderedEventContent).mockImplementation(content => content);
    vi.mocked(mockEmojiSetService.getUserEmojiSets).mockResolvedValue(new Map());

    injector = Injector.create({
      providers: [
        { provide: ParsingService, useClass: ParsingService },
        { provide: DataService, useValue: mockDataService },
        { provide: NostrService, useValue: mockNostrService },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: MediaPlayerService, useValue: mockMediaPlayerService },
        { provide: EmojiSetService, useValue: mockEmojiSetService },
      ],
    });

    service = injector.get(ParsingService);
  });

  afterEach(() => {
    service?.ngOnDestroy();
  });

  it('parses hyphenated custom emoji shortcodes from event tags', async () => {
    const result = await service.parseContent(
      'Hello :wisp-cute: world',
      [['emoji', 'wisp-cute', 'https://i.nostr.build/JMiOdsfo4CwsZo3d.png']]
    );

    expect(result.pendingMentions).toEqual([]);
    expect(result.tokens.map(token => token.type)).toEqual(['text', 'emoji', 'text']);
    expect(result.tokens[1]).toMatchObject({
      type: 'emoji',
      content: ':wisp-cute:',
      customEmoji: 'https://i.nostr.build/JMiOdsfo4CwsZo3d.png',
    });
  });

  it('resolves hyphenated custom emoji shortcodes from author emoji sets', async () => {
    vi.mocked(mockEmojiSetService.getUserEmojiSets).mockResolvedValue(
      new Map([['wisp-master', 'https://i.nostr.build/HSalALZf2ftAUOxP.png']])
    );

    const result = await service.parseContent('Ship it :wisp-master:', [], 'author-pubkey');

    expect(mockEmojiSetService.getUserEmojiSets).toHaveBeenCalledWith('author-pubkey');
    expect(result.tokens.map(token => token.type)).toEqual(['text', 'emoji']);
    expect(result.tokens[1]).toMatchObject({
      type: 'emoji',
      content: ':wisp-master:',
      customEmoji: 'https://i.nostr.build/HSalALZf2ftAUOxP.png',
    });
  });

  it('does not link ignored bare domains', async () => {
    const result = await service.parseContent('Talk to andrzej.btc about it');

    expect(result.pendingMentions).toEqual([]);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({
      type: 'text',
      content: 'Talk to andrzej.btc about it',
    });
  });
});
