import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Event } from 'nostr-tools';

import { getTaggedXUrl } from './event.component';
import { EventComponent } from './event.component';
import { EventService } from '../../services/event';

function createReplyEvent(id: string): Event {
  return {
    id,
    pubkey: `${id}-pubkey`,
    created_at: 1,
    kind: 1,
    tags: [],
    content: `reply ${id}`,
    sig: `${id}-sig`,
  };
}

describe('getTaggedXUrl', () => {
  const createEvent = (tags: string[][]): Event => ({
    id: 'event-id',
    pubkey: 'pubkey',
    created_at: 1,
    kind: 1,
    tags,
    content: 'hello',
    sig: 'sig',
  });

  it('returns the proxy web URL for x.com posts', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://x.com/nostria/status/123', 'web'],
    ]))).toBe('https://x.com/nostria/status/123');
  });

  it('returns the proxy web URL for twitter.com posts', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://twitter.com/nostria/status/123', 'web'],
    ]))).toBe('https://twitter.com/nostria/status/123');
  });

  it('ignores proxy tags for non-x domains', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://mastodon.social/@nostria/123', 'web'],
    ]))).toBeUndefined();
  });

  it('ignores proxy tags with non-web protocol hints', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'https://x.com/nostria/status/123', 'activitypub'],
    ]))).toBeUndefined();
  });

  it('ignores invalid proxy URLs', () => {
    expect(getTaggedXUrl(createEvent([
      ['proxy', 'not-a-valid-url', 'web'],
    ]))).toBeUndefined();
  });
});

describe('EventComponent reply interaction helpers', () => {
  let publishInteractionSnapshot: ReturnType<typeof vi.fn>;
  let triggerReplyCountAnimation: ReturnType<typeof vi.fn>;
  let componentLike: {
    _replyCountInternal: ReturnType<typeof signal<number>>;
    _replyEventsInternal: ReturnType<typeof signal<Event[]>>;
    hasMoreReplies: ReturnType<typeof signal<boolean>>;
    replyCountFromParent: () => number | undefined;
    replyCount: () => number;
    reactions: () => [];
    reposts: () => [];
    reports: () => { events: []; data: Map<string, number> };
    quotes: () => [];
    hasMoreReactions: () => boolean;
    hasMoreReposts: () => boolean;
    hasMoreQuotes: () => boolean;
    eventService: { publishInteractionSnapshot: ReturnType<typeof vi.fn> };
    triggerReplyCountAnimation: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    publishInteractionSnapshot = vi.fn();
    triggerReplyCountAnimation = vi.fn();
    const replyCountSignal = signal(0);
    const replyEventsSignal = signal<Event[]>([]);
    const hasMoreRepliesSignal = signal(false);

    componentLike = {
      _replyCountInternal: replyCountSignal,
      _replyEventsInternal: replyEventsSignal,
      hasMoreReplies: hasMoreRepliesSignal,
      replyCountFromParent: () => undefined,
      replyCount: () => replyCountSignal(),
      reactions: () => [],
      reposts: () => [],
      reports: () => ({ events: [], data: new Map() }),
      quotes: () => [],
      hasMoreReactions: () => false,
      hasMoreReposts: () => false,
      hasMoreQuotes: () => false,
      eventService: { publishInteractionSnapshot },
      triggerReplyCountAnimation,
    };
  });

  it('optimistically increments reply count and publishes a shared snapshot', () => {
    const applyOptimisticReplyPublished = (
      EventComponent.prototype as unknown as {
        applyOptimisticReplyPublished: (replyEvent: Event, targetEventId: string) => void;
      }
    ).applyOptimisticReplyPublished;

    applyOptimisticReplyPublished.call(componentLike, createReplyEvent('reply-1'), 'root-event');

    expect(componentLike._replyCountInternal()).toBe(1);
    expect(componentLike._replyEventsInternal().map((event) => event.id)).toEqual(['reply-1']);
    expect(componentLike.hasMoreReplies()).toBe(false);
    expect(triggerReplyCountAnimation).toHaveBeenCalledOnce();
    expect(publishInteractionSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'root-event',
      replyCount: 1,
      replyEvents: expect.arrayContaining([expect.objectContaining({ id: 'reply-1' })]),
      hasMoreReplies: false,
    }));
  });

  it('does not double-count duplicate optimistic replies', () => {
    const applyOptimisticReplyPublished = (
      EventComponent.prototype as unknown as {
        applyOptimisticReplyPublished: (replyEvent: Event, targetEventId: string) => void;
      }
    ).applyOptimisticReplyPublished;

    const replyEvent = createReplyEvent('reply-1');
    componentLike._replyCountInternal.set(1);
    componentLike._replyEventsInternal.set([replyEvent]);

    applyOptimisticReplyPublished.call(componentLike, replyEvent, 'root-event');

    expect(componentLike._replyCountInternal()).toBe(1);
    expect(componentLike._replyEventsInternal().map((event) => event.id)).toEqual(['reply-1']);
    expect(triggerReplyCountAnimation).not.toHaveBeenCalled();
    expect(publishInteractionSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      replyCount: 1,
      hasMoreReplies: false,
    }));
  });

  it('preserves overflow state when the reply count is already saturated', () => {
    const applyOptimisticReplyPublished = (
      EventComponent.prototype as unknown as {
        applyOptimisticReplyPublished: (replyEvent: Event, targetEventId: string) => void;
      }
    ).applyOptimisticReplyPublished;

    componentLike._replyCountInternal.set(EventService.INTERACTION_QUERY_LIMIT);
    componentLike.hasMoreReplies.set(true);

    applyOptimisticReplyPublished.call(componentLike, createReplyEvent('reply-overflow'), 'root-event');

    expect(componentLike._replyCountInternal()).toBe(EventService.INTERACTION_QUERY_LIMIT);
    expect(componentLike.hasMoreReplies()).toBe(true);
    expect(triggerReplyCountAnimation).not.toHaveBeenCalled();
    expect(publishInteractionSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      replyCount: EventService.INTERACTION_QUERY_LIMIT,
      hasMoreReplies: true,
    }));
  });
});
