import { EnvironmentInjector, PLATFORM_ID, createEnvironmentInjector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { deleteDB } from 'idb';
import { Event, finalizeEvent, generateSecretKey } from 'nostr-tools';
import { PublishService } from './publish.service';
import { SCHEDULED_POSTS_DATABASE, ScheduledPostsService } from './scheduled-posts.service';

describe('ScheduledPostsService', () => {
  const databaseName = 'nostria-scheduled-posts-test';
  const secret = generateSecretKey();
  let now: number;
  let service: ScheduledPostsService;
  const publisher = {
    getRelayUrlsForPublish: vi.fn<PublishService['getRelayUrlsForPublish']>(),
    publish: vi.fn<PublishService['publish']>(),
  } satisfies Pick<PublishService, 'publish' | 'getRelayUrlsForPublish'>;

  function setup(platform = 'browser'): ScheduledPostsService {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: SCHEDULED_POSTS_DATABASE, useValue: databaseName },
        { provide: PublishService, useValue: publisher }],
    });
    return TestBed.inject(ScheduledPostsService);
  }

  function event(content = 'Scheduled note', kind = 1): Event {
    return structuredClone(finalizeEvent({ kind, content, tags: [], created_at: now / 1000 + 60 }, secret));
  }

  beforeEach(async () => {
    now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    publisher.getRelayUrlsForPublish.mockReset().mockResolvedValue(['wss://author.example']);
    publisher.publish.mockReset().mockImplementation(async event => ({
      success: true, event, relayResults: new Map([['wss://author.example', { success: true }]]),
    }));
    await deleteDB(databaseName);
    service = setup();
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    await deleteDB(databaseName);
  });

  it('persists signed events without publishing early, then sends the exact payload and destinations', async () => {
    const signed = event();
    await service.add([signed]);
    await service.processDue();
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(service.posts()[0].events[0]).toEqual(signed);
    now += 60_000;
    await service.processDue();
    expect(publisher.publish).toHaveBeenCalledWith(signed, {
      relayUrls: ['wss://author.example'], useOptimizedRelays: false,
    });
    expect(service.posts()).toEqual([]);
  });

  it('delivers overdue posts after restart without an account or signer', async () => {
    const signed = event();
    await service.add([signed]);
    TestBed.resetTestingModule();
    service = setup();
    now += 3_600_000;
    service.start();
    await vi.waitFor(() => expect(publisher.publish).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(service.posts()).toEqual([]));
  });

  it('keeps failed posts and retries with the original timestamp and signature', async () => {
    const signed = event();
    publisher.publish.mockResolvedValueOnce({ success: false, event: signed, relayResults: new Map() });
    await service.add([signed]);
    now += 60_000;
    await service.processDue();
    expect(service.posts()[0].attempts).toBe(1);
    await service.processDue();
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    now += 30_000;
    await service.processDue();
    expect(publisher.publish.mock.calls[1][0]).toEqual(signed);
    expect(service.posts()).toEqual([]);
  });

  it('never sends a canceled post', async () => {
    const signed = event();
    await service.add([signed]);
    await service.cancel(signed.id);
    now += 60_000;
    await service.processDue();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('rejects past dates, invalid signatures, and missing destinations', async () => {
    const signed = event();
    await expect(service.add([{ ...signed, sig: '0'.repeat(128) }])).rejects.toThrow();
    publisher.getRelayUrlsForPublish.mockResolvedValueOnce([]);
    await expect(service.add([signed])).rejects.toThrow();
    now += 60_000;
    await expect(service.add([signed])).rejects.toThrow();
    expect(service.posts()).toEqual([]);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('checkpoints a media story before retrying its companion note', async () => {
    const media = event('Media', 20);
    const note = event('Companion');
    await service.add([media, note]);
    publisher.publish.mockResolvedValueOnce({ success: true, event: media, relayResults: new Map() });
    publisher.publish.mockRejectedValueOnce(new Error('offline'));
    now += 60_000;
    await service.processDue();
    expect(service.posts()[0].nextEvent).toBe(1);
    await service.retry(media.id);
    expect(publisher.publish.mock.calls.map(call => call[0].id)).toEqual([media.id, note.id, note.id]);
  });

  it('does not race overlapping delivery checks or allow cancellation during delivery', async () => {
    const signed = event();
    await service.add([signed]);
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    publisher.publish.mockImplementationOnce(async event => {
      await pending;
      return { success: true, event, relayResults: new Map() };
    });
    now += 60_000;
    const processing = service.processDue();
    await vi.waitFor(() => expect(publisher.publish).toHaveBeenCalledTimes(1));
    await service.processDue();
    await expect(service.cancel(signed.id)).rejects.toThrow();
    finish();
    await processing;
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('does not access browser storage or publish during SSR', async () => {
    TestBed.resetTestingModule();
    service = setup('server');
    service.start();
    await service.processDue();
    expect(service.posts()).toEqual([]);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('claims delivery across independent app instances sharing the same database', async () => {
    const signed = event();
    await service.add([signed]);
    const otherInjector = createEnvironmentInjector([ScheduledPostsService], TestBed.inject(EnvironmentInjector));
    const other = otherInjector.get(ScheduledPostsService);
    now += 60_000;
    try {
      await Promise.all([service.processDue(), other.processDue()]);
      expect(publisher.publish).toHaveBeenCalledTimes(1);
    } finally { otherInjector.destroy(); }
  });

  it('does not restore canceled work when an expired delivery attempt fails later', async () => {
    const signed = event();
    await service.add([signed]);
    let fail!: () => void;
    const pending = new Promise<void>((_, reject) => { fail = () => reject(new Error('offline')); });
    publisher.publish.mockImplementationOnce(async event => {
      await pending;
      return { success: true, event, relayResults: new Map() };
    });
    now += 60_000;
    const processing = service.processDue();
    await vi.waitFor(() => expect(publisher.publish).toHaveBeenCalledTimes(1));
    now += 60_000;
    await service.cancel(signed.id);
    fail();
    await processing;
    expect(service.posts()).toEqual([]);
  });
});
