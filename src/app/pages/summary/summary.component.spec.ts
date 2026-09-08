import { Location } from '@angular/common';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';
import { FollowingDataService } from '../../services/following-data.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { OnDemandUserDataService } from '../../services/on-demand-user-data.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { AiService } from '../../services/ai.service';
import { AiPromptActionService } from '../../services/ai-prompt-action.service';
import { AiPromptModelService } from '../../services/ai-prompt-model.service';
import { FormatService } from '../../services/format/format.service';
import { ApplicationService } from '../../services/application.service';
import { LayoutService } from '../../services/layout.service';
import { DEFAULT_CONTENT_FILTER, LocalSettingsService } from '../../services/local-settings.service';
import { SummaryComponent } from './summary.component';

function note(id: string, pubkey = 'alice', tags: string[][] = [], content = 'A post') {
  return { id, pubkey, kind: 1, created_at: 100, content, tags };
}

describe('SummaryComponent poster counters', () => {
  const contentFilter = signal({ ...DEFAULT_CONTENT_FILTER });
  let component: SummaryComponent;

  beforeEach(() => {
    contentFilter.set({ ...DEFAULT_CONTENT_FILTER });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        SummaryComponent,
        {
          provide: LocalSettingsService,
          useValue: { contentFilter } satisfies Pick<LocalSettingsService, 'contentFilter'>,
        },
        {
          provide: AccountStateService,
          useValue: { pubkey: signal('') } satisfies Pick<AccountStateService, 'pubkey'>,
        },
        {
          provide: FollowSetsService,
          useValue: {
            followSets: signal([]),
            isLoading: signal(false),
          } satisfies Pick<FollowSetsService, 'followSets' | 'isLoading'>,
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        {
          provide: AiPromptActionService,
          useValue: {
            unregisterHandler: vi.fn(),
          } satisfies Pick<AiPromptActionService, 'unregisterHandler'>,
        },
        ...[
          AccountLocalStateService, DatabaseService, LoggerService, FollowingDataService,
          CustomDialogService, Location, OnDemandUserDataService, MatDialog, AiService,
          AiPromptModelService, FormatService, ApplicationService,
          Router, LayoutService,
        ].map(provide => ({ provide, useValue: {} })),
      ],
    });
    component = TestBed.inject(SummaryComponent);
  });

  it('excludes hidden replies from note counts and updates when replies are enabled', () => {
    component.noteEvents.set([
      note('post'),
      note('reply', 'alice', [['e', 'parent', '', 'reply']]),
      note('reply-only', 'bob', [['e', 'parent']]),
    ]);

    expect(component.activePosters()).toEqual([
      expect.objectContaining({ pubkey: 'alice', notesCount: 1, totalCount: 1 }),
    ]);
    component.togglePosterSelection('alice');
    expect(component.totalTimelineCount()).toBe(1);

    contentFilter.update(filter => ({ ...filter, showReplies: true }));
    expect(component.activePosters()).toEqual([
      expect.objectContaining({ pubkey: 'alice', notesCount: 2, totalCount: 2 }),
      expect.objectContaining({ pubkey: 'bob', notesCount: 1, totalCount: 1 }),
    ]);
    expect(component.totalTimelineCount()).toBe(2);
  });

  it('excludes both repost kinds when reposts are hidden', () => {
    component.noteEvents.set([note('post')]);
    component.repostEvents.set([
      { ...note('repost'), kind: 6 },
      { ...note('generic-repost'), kind: 16 },
    ]);
    expect(component.activePosters()[0].repostsCount).toBe(2);

    contentFilter.update(filter => ({ ...filter, showReposts: false }));
    expect(component.activePosters()[0]).toMatchObject({ repostsCount: 0, totalCount: 1 });
    expect(component.showRepostsStats()).toBe(false);
    expect(component.totalTimelineCount()).toBe(1);
  });

  it('counts only selected kinds within a shared stat category', () => {
    component.mediaEventsRaw.set([
      { ...note('photo'), kind: 20 },
      { ...note('video'), kind: 21 },
      { ...note('video-only', 'bob'), kind: 22 },
    ]);
    contentFilter.update(filter => ({ ...filter, kinds: [20] }));

    expect(component.activePosters()).toEqual([
      expect.objectContaining({ pubkey: 'alice', mediaCount: 1, totalCount: 1 }),
    ]);
    expect(component.allTimelineEvents().map(event => event.id)).toEqual(['photo']);
  });

  it('applies list and GM filters to counts without hiding unselected posters', () => {
    component.noteEvents.set([
      note('gm-alice', 'alice', [], 'GM'),
      note('post-alice'),
      note('gm-bob', 'bob', [], 'GM'),
      note('gm-carol', 'carol', [], 'GM'),
    ]);
    component.onFollowSetChanged({
      id: 'list', dTag: 'friends', title: 'Friends', pubkeys: ['alice', 'bob'],
      createdAt: 100, isPrivate: false,
    });
    component.gmFilterMode.set('only');
    component.togglePosterSelection('alice');

    expect(component.activePosters()).toEqual([
      expect.objectContaining({ pubkey: 'alice', notesCount: 1, totalCount: 1 }),
      expect.objectContaining({ pubkey: 'bob', notesCount: 1, totalCount: 1 }),
    ]);
    expect(component.allTimelineEvents().map(event => event.id)).toEqual(['gm-alice']);

    component.gmFilterMode.set('exclude');
    expect(component.activePosters()).toEqual([
      expect.objectContaining({ pubkey: 'alice', notesCount: 1, totalCount: 1 }),
    ]);
    expect(component.allTimelineEvents().map(event => event.id)).toEqual(['post-alice']);
  });

  it('keeps the full matching count when the timeline is paginated', () => {
    component.noteEvents.set(Array.from({ length: 25 }, (_, index) => note(`post-${index}`)));
    component.togglePosterSelection('alice');

    expect(component.activePosters()[0].notesCount).toBe(25);
    expect(component.totalTimelineCount()).toBe(25);
    expect(component.timelineEvents()).toHaveLength(20);
    expect(component.hasMoreTimelineEvents()).toBe(true);

    component.loadMoreTimelineEvents();
    expect(component.timelineEvents()).toHaveLength(25);
    expect(component.hasMoreTimelineEvents()).toBe(false);
    expect(component.activePosters()[0].notesCount).toBe(25);
  });

  it('shows no counters or timeline events when no content kinds are selected', () => {
    component.noteEvents.set([note('post')]);
    contentFilter.update(filter => ({ ...filter, kinds: [] }));

    expect(component.activePosters()).toEqual([]);
    expect(component.totalTimelineCount()).toBe(0);
  });
});
