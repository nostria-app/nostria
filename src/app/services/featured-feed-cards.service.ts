import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Event, kinds, nip19 } from 'nostr-tools';
import {
  AccountLocalStateService,
  ANONYMOUS_PUBKEY,
  FeaturedFeedCardId,
  FeaturedFeedCardsState,
  FeaturedFeedCardStats,
} from './account-local-state.service';
import { AccountStateService } from './account-state.service';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { UtilitiesService } from './utilities.service';
import { FeedConfig } from './feed.service';

export interface FeaturedProfileSuggestion {
  pubkey: string;
  reactionCount: number;
  repostCount: number;
  replyCount: number;
  score: number;
  scoreLabel: string;
}

export interface FeaturedArticleSuggestion {
  eventId: string;
  naddr: string;
  title: string;
  summary: string;
}

export interface FeaturedFeedCard {
  id: FeaturedFeedCardId;
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  primaryRoute: string[];
  secondaryCtaLabel?: string;
  secondaryRoute?: string[];
  tone: 'primary' | 'secondary' | 'tertiary';
  highlights?: string[];
  profiles?: FeaturedProfileSuggestion[];
  articles?: FeaturedArticleSuggestion[];
}

export interface FeaturedFeedPlacement {
  key: string;
  instanceId: string;
  afterEventId: string;
  card: FeaturedFeedCard;
}

const FEATURED_CARD_START_INDEX = 4;
const FEATURED_CARD_INTERVAL = 11;
const HISTORY_LIMIT = 80;
const PROFILE_NOTE_LIMIT = 420;
const PROFILE_REACTION_LIMIT = 900;
const PROFILE_REPOST_LIMIT = 360;
const PROFILE_REPLY_LIMIT = 360;
const ARTICLE_LIMIT = 3;

@Injectable({
  providedIn: 'root',
})
export class FeaturedFeedCardsService {
  private readonly accountState = inject(AccountStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);

  private readonly popularProfiles = signal<FeaturedProfileSuggestion[]>([]);
  private readonly articleSuggestions = signal<FeaturedArticleSuggestion[]>([]);
  private readonly dismissedInstances = signal<Record<string, true>>({});
  private readonly scoringSnapshot = signal<FeaturedFeedCardsState>({ cards: {} });

  private persistentState: FeaturedFeedCardsState = { cards: {} };
  private loadedStatePubkey: string | null = null;
  private readonly seenImpressions = new Set<string>();
  private refreshPromise: Promise<void> | null = null;

  private readonly cardSignals = computed(() => ({
    profiles: this.popularProfiles(),
    articles: this.articleSuggestions(),
    scoring: this.scoringSnapshot(),
    dismissed: this.dismissedInstances(),
    subscriptionActive: !!this.accountState.hasActiveSubscription(),
    authenticated: !!this.accountState.pubkey(),
  }));

  constructor() {
    effect(() => {
      const storagePubkey = this.getStoragePubkey();
      const followingCount = this.accountState.followingList().length;
      const subscriptionActive = this.accountState.hasActiveSubscription();

      void followingCount;
      void subscriptionActive;

      untracked(() => {
        this.loadPersistentState(storagePubkey);
        void this.refreshRecommendations();
      });
    });
  }

  getPlacements(feed: FeedConfig, events: Event[]): FeaturedFeedPlacement[] {
    const { profiles, articles, scoring, dismissed, subscriptionActive, authenticated } = this.cardSignals();

    if (events.length <= FEATURED_CARD_START_INDEX) {
      return [];
    }

    const eligibleCards = this.buildEligibleCards({
      profiles,
      articles,
      subscriptionActive,
      authenticated,
    });

    if (eligibleCards.length === 0) {
      return [];
    }

    const placements: FeaturedFeedPlacement[] = [];
    const usedCardIds = new Set<FeaturedFeedCardId>();

    for (let noteIndex = FEATURED_CARD_START_INDEX; noteIndex < events.length; noteIndex += FEATURED_CARD_INTERVAL) {
      if (usedCardIds.size >= eligibleCards.length) {
        usedCardIds.clear();
      }

      const anchorEvent = events[noteIndex];
      if (!anchorEvent) {
        continue;
      }

      const card = this.pickCardForSlot(feed.id, noteIndex, eligibleCards, scoring, usedCardIds);
      if (!card) {
        continue;
      }

      const instanceId = `${feed.id}:${card.id}:${anchorEvent.id}`;
      if (dismissed[instanceId]) {
        continue;
      }

      placements.push({
        key: `featured:${instanceId}`,
        instanceId,
        afterEventId: anchorEvent.id,
        card,
      });

      usedCardIds.add(card.id);
    }

    return placements;
  }

  markImpression(instanceId: string, cardId: FeaturedFeedCardId): void {
    if (!instanceId || this.seenImpressions.has(instanceId)) {
      return;
    }

    this.seenImpressions.add(instanceId);
    this.updateCardState(cardId, stats => ({
      ...stats,
      impressions: stats.impressions + 1,
      lastShownAt: Date.now(),
    }), 'shown');
  }

  markClick(cardId: FeaturedFeedCardId): void {
    this.updateCardState(cardId, stats => ({
      ...stats,
      clicks: stats.clicks + 1,
      lastClickedAt: Date.now(),
    }), 'clicked');
  }

  dismiss(instanceId: string, cardId: FeaturedFeedCardId): void {
    if (!instanceId) {
      return;
    }

    this.dismissedInstances.update(current => ({ ...current, [instanceId]: true }));
    this.updateCardState(cardId, stats => ({
      ...stats,
      dismissals: stats.dismissals + 1,
      lastDismissedAt: Date.now(),
    }), 'dismissed');
  }

  private buildEligibleCards(context: {
    profiles: FeaturedProfileSuggestion[];
    articles: FeaturedArticleSuggestion[];
    subscriptionActive: boolean;
    authenticated: boolean;
  }): FeaturedFeedCard[] {
    const cards: FeaturedFeedCard[] = [];

    if (context.profiles.length > 0) {
      cards.push({
        id: 'popular-profiles',
        icon: 'person_search',
        eyebrow: 'Social momentum',
        title: 'Popular profiles you are not following',
        description: 'Picked from locally cached reactions, reposts, and replies already moving through your feed.',
        ctaLabel: 'Discover people',
        primaryRoute: ['/people/discover'],
        tone: 'primary',
        profiles: context.profiles.slice(0, 3),
        highlights: ['Local cache only', 'Reaction-heavy', 'Fresh activity'],
      });
    }

    if (context.authenticated) {
      cards.push({
        id: 'support-nostria',
        icon: 'favorite',
        eyebrow: 'Independent product',
        title: 'Support the development of Nostria, donate now!',
        description: 'Help fund faster releases, more Nostr experiments, and the boring infrastructure work that keeps everything alive.',
        ctaLabel: 'Open donation flow',
        primaryRoute: ['/wallet'],
        tone: 'secondary',
        highlights: ['Lightning ready', 'Wallet built in', 'Direct support'],
      });
    }

    if (!context.subscriptionActive) {
      cards.push({
        id: 'nostria-subscription',
        icon: 'diamond',
        eyebrow: 'Premium access',
        title: 'Sign up for Nostria subscription',
        description: 'Unlock the extra layer of Nostria and keep the project sustainable while you are at it.',
        ctaLabel: 'See plans',
        primaryRoute: ['/premium/upgrade'],
        tone: 'tertiary',
        highlights: ['Premium features', 'Supports development', 'Quick upgrade'],
      });
    }

    if (context.articles.length > 0) {
      cards.push({
        id: 'interesting-articles',
        icon: 'article',
        eyebrow: 'Long-form picks',
        title: 'Here are some articles that might interest you',
        description: 'Recent cached long-form posts surfaced straight from what Nostria already has locally.',
        ctaLabel: 'Open first article',
        primaryRoute: ['/a', context.articles[0].naddr],
        secondaryCtaLabel: 'Browse articles',
        secondaryRoute: ['/articles'],
        tone: 'primary',
        articles: context.articles,
      });
    }

    cards.push({
      id: 'nostria-music',
      icon: 'music_note',
      eyebrow: 'Built in music',
      title: 'Did you know that Nostria has music?',
      description: 'Tracks, albums, playlists, and offline-friendly listening are already inside the app.',
      ctaLabel: 'Open music',
      primaryRoute: ['/music'],
      tone: 'secondary',
      highlights: ['Tracks and albums', 'Playlists', 'Offline playback'],
    });

    cards.push({
      id: 'nostria-ai',
      icon: 'smart_toy',
      eyebrow: 'AI features',
      title: 'Did you know that Nostria has AI?',
      description: 'Use summaries, translation, chat, image generation, and browser-local models without leaving Nostria.',
      ctaLabel: 'Open AI',
      primaryRoute: ['/ai'],
      secondaryCtaLabel: 'AI settings',
      secondaryRoute: ['/ai/settings'],
      tone: 'tertiary',
      highlights: ['Summaries', 'Translation', 'Local and cloud models'],
    });

    return cards;
  }

  private pickCardForSlot(
    feedId: string,
    noteIndex: number,
    cards: FeaturedFeedCard[],
    scoring: FeaturedFeedCardsState,
    usedCardIds: Set<FeaturedFeedCardId>
  ): FeaturedFeedCard | null {
    const rankedCards = [...cards]
      .map(card => ({
        card,
        score: this.getCardScore(feedId, noteIndex, card.id, scoring.cards[card.id], usedCardIds),
      }))
      .sort((left, right) => right.score - left.score);

    return rankedCards[0]?.card ?? null;
  }

  private getCardScore(
    feedId: string,
    noteIndex: number,
    cardId: FeaturedFeedCardId,
    stats: FeaturedFeedCardStats | undefined,
    usedCardIds: Set<FeaturedFeedCardId>
  ): number {
    const basePriority: Record<FeaturedFeedCardId, number> = {
      'popular-profiles': 12,
      'support-nostria': 9,
      'nostria-subscription': 11,
      'interesting-articles': 10,
      'nostria-music': 8,
      'nostria-ai': 8,
    };

    if (usedCardIds.has(cardId)) {
      return Number.NEGATIVE_INFINITY;
    }

    const impressions = stats?.impressions ?? 0;
    const clicks = stats?.clicks ?? 0;
    const dismissals = stats?.dismissals ?? 0;
    const lastShownAt = stats?.lastShownAt ?? 0;
    const staleHours = lastShownAt > 0 ? (Date.now() - lastShownAt) / (1000 * 60 * 60) : 999;
    const staleBoost = Math.min(6, staleHours / 18);
    const freshnessPenalty = staleHours < 12 ? 5 : 0;
    const unseenBoost = impressions === 0 ? 5 : 0;
    const impressionPenalty = impressions * 0.7;
    const clickPenalty = clicks * 0.35;
    const dismissPenalty = dismissals * 1.8;

    return basePriority[cardId]
      + unseenBoost
      + staleBoost
      - freshnessPenalty
      - impressionPenalty
      - clickPenalty
      - dismissPenalty
      + this.getDeterministicJitter(`${feedId}:${noteIndex}:${cardId}`);
  }

  private getDeterministicJitter(seed: string): number {
    let hash = 0;
    for (let index = 0; index < seed.length; index++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(index);
      hash |= 0;
    }

    return (Math.abs(hash) % 1000) / 1000;
  }

  private async refreshRecommendations(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        await this.database.init();

        const [profiles, articles] = await Promise.all([
          this.loadPopularProfilesFromCache(),
          this.loadArticleSuggestionsFromCache(),
        ]);

        this.popularProfiles.set(profiles);
        this.articleSuggestions.set(articles);
      } catch (error) {
        this.logger.warn('[FeaturedFeedCards] Failed to refresh recommendations', error);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async loadPopularProfilesFromCache(): Promise<FeaturedProfileSuggestion[]> {
    const followingSet = new Set(
      this.accountState.followingList()
        .map(pubkey => this.utilities.safeGetHexPubkey(pubkey) ?? '')
        .filter(Boolean)
    );
    const currentPubkey = this.utilities.safeGetHexPubkey(this.accountState.pubkey() ?? '') ?? '';

    const notes = (await this.database.getEventsByKind(kinds.ShortTextNote))
      .sort((left, right) => right.created_at - left.created_at);

    const rootNotes = notes
      .filter(event => this.utilities.isRootPost(event))
      .slice(0, PROFILE_NOTE_LIMIT);

    if (rootNotes.length === 0) {
      return [];
    }

    const trackedNoteIds = new Set(rootNotes.map(event => event.id));
    const noteAuthorById = new Map(rootNotes.map(event => [event.id, event.pubkey]));
    const profileStats = new Map<string, {
      posts: number;
      reactionCount: number;
      repostCount: number;
      replyCount: number;
      latestActivityAt: number;
    }>();

    const ensureProfileStats = (pubkey: string) => {
      if (!profileStats.has(pubkey)) {
        profileStats.set(pubkey, {
          posts: 0,
          reactionCount: 0,
          repostCount: 0,
          replyCount: 0,
          latestActivityAt: 0,
        });
      }

      return profileStats.get(pubkey)!;
    };

    for (const note of rootNotes) {
      const stats = ensureProfileStats(note.pubkey);
      stats.posts += 1;
      stats.latestActivityAt = Math.max(stats.latestActivityAt, note.created_at);
    }

    const reactions = (await this.database.getEventsByKind(7))
      .sort((left, right) => right.created_at - left.created_at)
      .slice(0, PROFILE_REACTION_LIMIT);

    for (const reaction of reactions) {
      const targetEventId = reaction.tags.find(tag => tag[0] === 'e')?.[1];
      if (!targetEventId || !trackedNoteIds.has(targetEventId)) {
        continue;
      }

      const author = noteAuthorById.get(targetEventId);
      if (!author) {
        continue;
      }

      const stats = ensureProfileStats(author);
      stats.reactionCount += 1;
      stats.latestActivityAt = Math.max(stats.latestActivityAt, reaction.created_at);
    }

    const reposts = (await this.database.getEventsByKind(kinds.Repost))
      .sort((left, right) => right.created_at - left.created_at)
      .slice(0, PROFILE_REPOST_LIMIT);

    for (const repost of reposts) {
      const targetEventId = repost.tags.find(tag => tag[0] === 'e')?.[1];
      if (!targetEventId || !trackedNoteIds.has(targetEventId)) {
        continue;
      }

      const author = noteAuthorById.get(targetEventId);
      if (!author) {
        continue;
      }

      const stats = ensureProfileStats(author);
      stats.repostCount += 1;
      stats.latestActivityAt = Math.max(stats.latestActivityAt, repost.created_at);
    }

    const replies = notes
      .filter(event => !this.utilities.isRootPost(event))
      .slice(0, PROFILE_REPLY_LIMIT);

    for (const reply of replies) {
      const targetEventId = reply.tags.find(tag => tag[0] === 'e')?.[1];
      if (!targetEventId || !trackedNoteIds.has(targetEventId)) {
        continue;
      }

      const author = noteAuthorById.get(targetEventId);
      if (!author) {
        continue;
      }

      const stats = ensureProfileStats(author);
      stats.replyCount += 1;
      stats.latestActivityAt = Math.max(stats.latestActivityAt, reply.created_at);
    }

    return Array.from(profileStats.entries())
      .filter(([pubkey, stats]) => pubkey !== currentPubkey && !followingSet.has(pubkey))
      .map(([pubkey, stats]) => {
        const ageHours = Math.max(0, (Date.now() / 1000 - stats.latestActivityAt) / 3600);
        const recencyBoost = Math.max(0, 3 - ageHours / 24);
        const score = (stats.reactionCount * 3.2)
          + (stats.repostCount * 4)
          + (stats.replyCount * 2.2)
          + (stats.posts * 0.75)
          + recencyBoost;

        return {
          pubkey,
          reactionCount: stats.reactionCount,
          repostCount: stats.repostCount,
          replyCount: stats.replyCount,
          score,
          scoreLabel: `${stats.reactionCount} reactions · ${stats.repostCount} reposts`,
        };
      })
      .filter(profile => profile.score >= 4)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }

  private async loadArticleSuggestionsFromCache(): Promise<FeaturedArticleSuggestion[]> {
    const followingSet = new Set(
      this.accountState.followingList()
        .map(pubkey => this.utilities.safeGetHexPubkey(pubkey) ?? '')
        .filter(Boolean)
    );

    const articles = (await this.database.getEventsByKind(30023))
      .filter(event => !!this.utilities.getTagValue(event, 'd'))
      .sort((left, right) => {
        const leftFollowing = followingSet.has(left.pubkey) ? 1 : 0;
        const rightFollowing = followingSet.has(right.pubkey) ? 1 : 0;

        if (leftFollowing !== rightFollowing) {
          return rightFollowing - leftFollowing;
        }

        return right.created_at - left.created_at;
      });

    const uniqueArticles = new Map<string, FeaturedArticleSuggestion>();

    for (const article of articles) {
      const dTag = this.utilities.getTagValue(article, 'd');
      if (!dTag) {
        continue;
      }

      try {
        const naddr = nip19.naddrEncode({
          pubkey: article.pubkey,
          kind: 30023,
          identifier: dTag,
        });

        const title = this.utilities.getTitleTag(article)
          || this.extractTextPreview(article.content, 64)
          || 'Untitled article';

        const summary = this.utilities.getTagValue(article, 'summary')
          || this.extractTextPreview(article.content, 120)
          || 'Open this article in Nostria.';

        uniqueArticles.set(article.id, {
          eventId: article.id,
          naddr,
          title,
          summary,
        });
      } catch (error) {
        this.logger.warn('[FeaturedFeedCards] Failed to encode cached article naddr', error);
      }

      if (uniqueArticles.size >= ARTICLE_LIMIT) {
        break;
      }
    }

    return Array.from(uniqueArticles.values());
  }

  private extractTextPreview(content: string, maxLength: number): string {
    const plainText = content
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!plainText) {
      return '';
    }

    return plainText.length > maxLength
      ? `${plainText.slice(0, maxLength - 1).trim()}…`
      : plainText;
  }

  private updateCardState(
    cardId: FeaturedFeedCardId,
    updater: (stats: FeaturedFeedCardStats) => FeaturedFeedCardStats,
    action: 'shown' | 'clicked' | 'dismissed'
  ): void {
    const currentStats = this.persistentState.cards[cardId] ?? {
      impressions: 0,
      clicks: 0,
      dismissals: 0,
    };

    this.persistentState = {
      cards: {
        ...this.persistentState.cards,
        [cardId]: updater(currentStats),
      },
      history: [
        ...(this.persistentState.history ?? []).slice(-(HISTORY_LIMIT - 1)),
        {
          cardId,
          action,
          timestamp: Date.now(),
        },
      ],
    };

    this.accountLocalState.setFeaturedFeedCards(this.getStoragePubkey(), this.persistentState);
  }

  private loadPersistentState(storagePubkey: string): void {
    if (this.loadedStatePubkey === storagePubkey) {
      return;
    }

    this.loadedStatePubkey = storagePubkey;
    this.seenImpressions.clear();
    this.dismissedInstances.set({});

    this.persistentState = this.accountLocalState.getFeaturedFeedCards(storagePubkey) ?? { cards: {} };
    this.scoringSnapshot.set(this.cloneState(this.persistentState));
  }

  private cloneState(state: FeaturedFeedCardsState): FeaturedFeedCardsState {
    return JSON.parse(JSON.stringify(state)) as FeaturedFeedCardsState;
  }

  private getStoragePubkey(): string {
    return this.accountState.pubkey() || ANONYMOUS_PUBKEY;
  }
}