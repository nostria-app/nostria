import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Event, Filter, kinds, nip19 } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { AccountRelayService } from '../../services/relays/account-relay';
import { RelaysService } from '../../services/relays/relays';
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { LoggerService } from '../../services/logger.service';
import { RunesSettingsService, RuneId, SidebarWidgetId } from '../../services/runes-settings.service';
import { Playlist } from '../../interfaces';
import { UtilitiesService } from '../../services/utilities.service';

interface RuneDefinition {
  id: RuneId;
  title: string;
  icon: string;
  tooltip: string;
}

interface BitcoinPriceState {
  usd: number | null;
  eur: number | null;
  updatedAt: number | null;
  loading: boolean;
  error: string | null;
}

interface SwissKnifeResult {
  type: string;
  primaryValue: string;
  extraValue?: string;
}

interface SidebarWidgetOption {
  id: SidebarWidgetId;
  title: string;
  icon: string;
}

const MUSIC_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;

@Component({
  selector: 'app-runes-sidebar',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './runes-sidebar.component.html',
  styleUrl: './runes-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunesSidebarComponent implements OnDestroy {
  private readonly HOVER_HIDE_DELAY_MS = 220;
  private readonly FLYOUT_TOP_MIN_PX = 72;
  private readonly FLYOUT_VIEWPORT_BOTTOM_MARGIN_PX = 24;
  private readonly RUNE_PREVIEW_ESTIMATED_HEIGHT_PX = 420;
  private readonly SETTINGS_PREVIEW_ESTIMATED_HEIGHT_PX = 520;

  private readonly layout = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly pool = inject(RelayPoolService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly relaysService = inject(RelaysService);
  private readonly accountState = inject(AccountStateService);
  private readonly data = inject(DataService);
  private readonly mediaPlayer = inject(MediaPlayerService);
  private readonly logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private readonly runesSettings = inject(RunesSettingsService);

  protected readonly runes: RuneDefinition[] = [
    {
      id: 'bitcoin-price',
      title: 'Bitcoin Price',
      icon: 'currency_bitcoin',
      tooltip: 'Bitcoin Price',
    },
    {
      id: 'nostr-swiss-knife',
      title: 'Nostr Swizz Knife',
      icon: 'construction',
      tooltip: 'Nostr Swizz Knife',
    },
    {
      id: 'music-favorites',
      title: 'Music Favorites',
      icon: 'library_music',
      tooltip: 'Music Favorites',
    },
  ];

  protected readonly sidebarWidgetOptions: SidebarWidgetOption[] = [
    {
      id: 'favorites',
      title: 'Favorites',
      icon: 'star',
    },
    {
      id: 'runes',
      title: 'Runes',
      icon: 'auto_awesome',
    },
  ];

  protected readonly hoveredRuneId = signal<RuneId | null>(null);
  protected readonly hoveredSettings = signal(false);
  protected readonly isFlyoutHovered = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly swissKnifeInput = signal('');
  protected readonly draggedRuneId = signal<RuneId | null>(null);
  protected readonly dropTargetRuneId = signal<RuneId | null>(null);
  protected readonly draggedWidgetId = signal<SidebarWidgetId | null>(null);
  protected readonly dropTargetWidgetId = signal<SidebarWidgetId | null>(null);
  protected readonly isPlayingLikedSongs = signal(false);
  protected readonly isPlayingLikedPlaylists = signal(false);
  protected readonly hoverPreviewPosition = signal<{ top: number; right: number } | null>(null);
  protected readonly settingsPreviewPosition = signal<{ top: number; right: number } | null>(null);

  private hoverHideTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly bitcoinPrice = signal<BitcoinPriceState>({
    usd: null,
    eur: null,
    updatedAt: null,
    loading: true,
    error: null,
  });

  protected readonly runeOrder = this.runesSettings.runeOrder;
  protected readonly enabledRunes = this.runesSettings.enabledRunes;
  protected readonly openRunes = this.runesSettings.openRunes;
  protected readonly sidebarWidgetOrder = this.runesSettings.sidebarWidgetOrder;
  protected readonly enabledSidebarWidgets = this.runesSettings.enabledSidebarWidgets;

  protected readonly orderedSidebarWidgets = computed(() => {
    const order = this.sidebarWidgetOrder();
    const orderMap = new Map<SidebarWidgetId, number>(order.map((id, index) => [id, index]));
    return [...this.sidebarWidgetOptions].sort((left, right) => (orderMap.get(left.id) ?? 0) - (orderMap.get(right.id) ?? 0));
  });

  protected readonly orderedRunes = computed(() => {
    const order = this.runeOrder();
    const orderMap = new Map<RuneId, number>(order.map((id, index) => [id, index]));
    return [...this.runes].sort((left, right) => (orderMap.get(left.id) ?? 0) - (orderMap.get(right.id) ?? 0));
  });

  protected readonly visibleRunes = computed(() => {
    const enabled = this.enabledRunes();
    return this.orderedRunes().filter(rune => enabled.includes(rune.id));
  });

  protected readonly activeRunes = computed<RuneId[]>(() => {
    const visibleSet = new Set<RuneId>(this.visibleRunes().map(rune => rune.id));
    return this.openRunes().filter(id => visibleSet.has(id));
  });

  protected readonly hoverPreviewRuneId = computed<RuneId | null>(() => {
    const hovered = this.hoveredRuneId();
    if (!hovered || this.settingsOpen()) {
      return null;
    }

    if (this.openRunes().includes(hovered)) {
      return null;
    }

    return this.visibleRunes().some(rune => rune.id === hovered) ? hovered : null;
  });

  protected readonly settingsPreviewVisible = computed(() => this.settingsOpen() || this.hoveredSettings());

  protected readonly bitcoinPriceLabel = computed(() => {
    const price = this.bitcoinPrice();
    if (price.loading) {
      return 'Loading BTC';
    }

    if (price.error || price.usd === null) {
      return 'BTC unavailable';
    }

    return `BTC $${Math.round(price.usd).toLocaleString()}`;
  });

  protected readonly swissKnifeResults = computed<SwissKnifeResult[]>(() => {
    const input = this.swissKnifeInput().trim();
    if (!input) {
      return [];
    }

    const normalized = input.startsWith('nostr:') ? input.slice(6) : input;

    if (/^[a-fA-F0-9]{64}$/.test(normalized)) {
      try {
        const npub = nip19.npubEncode(normalized.toLowerCase());
        const note = nip19.noteEncode(normalized.toLowerCase());
        return [
          { type: 'hex', primaryValue: normalized.toLowerCase() },
          { type: 'npub', primaryValue: npub },
          { type: 'note', primaryValue: note },
        ];
      } catch {
        return [{ type: 'hex', primaryValue: normalized.toLowerCase() }];
      }
    }

    try {
      const decoded = nip19.decode(normalized);

      if (decoded.type === 'npub' || decoded.type === 'note') {
        return [
          { type: decoded.type, primaryValue: normalized },
          { type: 'hex', primaryValue: decoded.data as string },
        ];
      }

      if (decoded.type === 'nprofile') {
        const data = decoded.data as { pubkey: string; relays?: string[] };
        return [
          { type: 'nprofile', primaryValue: normalized },
          { type: 'pubkey', primaryValue: data.pubkey },
          { type: 'relays', primaryValue: (data.relays || []).join(', ') || 'none' },
        ];
      }

      if (decoded.type === 'nevent') {
        const data = decoded.data as { id: string; author?: string; relays?: string[] };
        return [
          { type: 'nevent', primaryValue: normalized },
          { type: 'event id', primaryValue: data.id },
          { type: 'author', primaryValue: data.author || 'unknown' },
          { type: 'relays', primaryValue: (data.relays || []).join(', ') || 'none' },
        ];
      }

      if (decoded.type === 'naddr') {
        const data = decoded.data as { identifier: string; pubkey: string; kind: number; relays?: string[] };
        return [
          { type: 'naddr', primaryValue: normalized },
          { type: 'identifier', primaryValue: data.identifier },
          { type: 'pubkey', primaryValue: data.pubkey },
          { type: 'kind', primaryValue: String(data.kind) },
          { type: 'relays', primaryValue: (data.relays || []).join(', ') || 'none' },
        ];
      }

      return [
        { type: decoded.type, primaryValue: normalized },
        { type: 'decoded', primaryValue: JSON.stringify(decoded.data) },
      ];
    } catch {
      return [{ type: 'invalid', primaryValue: 'Unsupported or invalid Nostr value' }];
    }
  });

  private readonly refreshTimer = setInterval(() => {
    void this.loadBitcoinPrice();
  }, 60_000);

  constructor() {
    void this.loadBitcoinPrice();
  }

  ngOnDestroy(): void {
    this.clearHoverHideTimer();
    clearInterval(this.refreshTimer);
  }

  protected onSidebarEnter(): void {
    this.clearHoverHideTimer();
  }

  protected onSidebarLeave(): void {
    this.scheduleHoverHide();
  }

  protected onRuneEnter(event: MouseEvent, runeId: RuneId): void {
    if (this.settingsOpen()) {
      return;
    }

    this.clearHoverHideTimer();
    this.hoveredSettings.set(false);
    this.settingsPreviewPosition.set(null);

    const target = event.currentTarget as HTMLElement | null;
    if (target) {
      const rect = target.getBoundingClientRect();
      const top = this.clampFlyoutTop(rect.top, this.RUNE_PREVIEW_ESTIMATED_HEIGHT_PX);
      const right = Math.max(72, window.innerWidth - rect.left + 8);
      this.hoverPreviewPosition.set({ top, right });
    }

    this.hoveredRuneId.set(runeId);
  }

  protected onSettingsEnter(event: MouseEvent): void {
    this.clearHoverHideTimer();
    this.hoveredRuneId.set(null);

    const target = event.currentTarget as HTMLElement | null;
    if (target) {
      const rect = target.getBoundingClientRect();
      const top = this.clampFlyoutTop(rect.top, this.SETTINGS_PREVIEW_ESTIMATED_HEIGHT_PX);
      const right = Math.max(72, window.innerWidth - rect.left + 8);
      this.settingsPreviewPosition.set({ top, right });
    }

    this.hoveredSettings.set(true);
  }

  protected onSettingsLeave(): void {
    if (this.settingsOpen()) {
      return;
    }

    this.scheduleHoverHide();
  }

  protected onRuneLeave(runeId: RuneId): void {
    this.scheduleHoverHide(runeId);
  }

  protected onFlyoutEnter(runeId: RuneId): void {
    this.clearHoverHideTimer();
    this.isFlyoutHovered.set(true);
    this.hoveredRuneId.set(runeId);
  }

  protected onFlyoutLeave(runeId: RuneId): void {
    this.isFlyoutHovered.set(false);
    this.scheduleHoverHide(runeId);
  }

  protected onSettingsFlyoutEnter(): void {
    this.clearHoverHideTimer();
    this.isFlyoutHovered.set(true);
    this.hoveredSettings.set(true);
  }

  protected onSettingsFlyoutLeave(): void {
    this.isFlyoutHovered.set(false);
    if (!this.settingsOpen()) {
      this.hoveredSettings.set(false);
      this.scheduleHoverHide();
    }
  }

  protected toggleRuneOpen(runeId: RuneId): void {
    this.runesSettings.toggleRuneOpen(runeId);
    this.hoveredRuneId.set(null);
  }

  protected toggleSettings(): void {
    const nextOpen = !this.settingsOpen();

    this.settingsOpen.set(nextOpen);

    if (nextOpen) {
      this.hoveredRuneId.set(null);
      this.hoveredSettings.set(false);
    } else {
      this.hoveredSettings.set(false);
      this.settingsPreviewPosition.set(null);
    }
  }

  protected closeRune(runeId: RuneId): void {
    this.runesSettings.setRuneOpen(runeId, false);
  }

  protected isRuneActive(runeId: RuneId): boolean {
    return this.activeRunes().includes(runeId) || this.hoverPreviewRuneId() === runeId;
  }

  protected isSidebarWidgetEnabled(widgetId: SidebarWidgetId): boolean {
    return this.runesSettings.isSidebarWidgetEnabled(widgetId);
  }

  protected setSidebarWidgetEnabled(widgetId: SidebarWidgetId, enabled: boolean): void {
    this.runesSettings.setSidebarWidgetEnabled(widgetId, enabled);
  }

  protected setRuneEnabled(runeId: RuneId, enabled: boolean): void {
    this.runesSettings.setRuneEnabled(runeId, enabled);
  }

  protected isRuneEnabled(runeId: RuneId): boolean {
    return this.runesSettings.isRuneEnabled(runeId);
  }

  protected updateSwissKnifeInput(value: string): void {
    this.swissKnifeInput.set(value);
  }

  protected openMusicLiked(): void {
    this.layout.openMusicLiked();
  }

  protected openMusicLikedPlaylists(): void {
    this.layout.openMusicLikedPlaylists();
  }

  protected async quickPlayLikedSongs(): Promise<void> {
    const relayUrls = this.resolveRelayUrls();
    const pubkey = this.accountState.pubkey();

    if (!pubkey || relayUrls.length === 0 || this.isPlayingLikedSongs()) {
      return;
    }

    this.isPlayingLikedSongs.set(true);

    try {
      const reactionsFilter: Filter = {
        kinds: [kinds.Reaction],
        authors: [pubkey],
        '#k': [String(MUSIC_KIND)],
        limit: 500,
      };

      const reactions = await this.collectEvents(relayUrls, reactionsFilter, 2500);
      const positiveReactions = reactions.filter(event => event.content === '+' || event.content === '❤️' || event.content === '🤙' || event.content === '👍');
      const musicRefs = new Set<string>();

      for (const reaction of positiveReactions) {
        const aTag = reaction.tags.find(tag => tag[0] === 'a')?.[1];
        if (aTag && aTag.startsWith(`${MUSIC_KIND}:`)) {
          musicRefs.add(aTag);
        }
      }

      if (musicRefs.size === 0) {
        return;
      }

      const tracks = await this.fetchTracksFromRefs(relayUrls, Array.from(musicRefs).slice(0, 100));
      if (tracks.length === 0) {
        return;
      }

      for (let index = 0; index < tracks.length; index++) {
        const track = tracks[index];
        const item = await this.trackToMediaItem(track);
        if (!item) {
          continue;
        }

        if (index === 0) {
          this.mediaPlayer.play(item);
        } else {
          this.mediaPlayer.enque(item);
        }
      }
    } catch (error) {
      this.logger.error('[Runes] Failed quick play for liked songs', error);
    } finally {
      this.isPlayingLikedSongs.set(false);
    }
  }

  protected async quickPlayLikedPlaylists(): Promise<void> {
    const relayUrls = this.resolveRelayUrls();
    const pubkey = this.accountState.pubkey();

    if (!pubkey || relayUrls.length === 0 || this.isPlayingLikedPlaylists()) {
      return;
    }

    this.isPlayingLikedPlaylists.set(true);

    try {
      const reactionsFilter: Filter = {
        kinds: [kinds.Reaction],
        authors: [pubkey],
        '#k': [String(MUSIC_PLAYLIST_KIND)],
        limit: 200,
      };

      const reactions = await this.collectEvents(relayUrls, reactionsFilter, 2500);
      const playlistRefs = new Set<string>();

      for (const reaction of reactions) {
        if (!(reaction.content === '+' || reaction.content === '❤️' || reaction.content === '🤙' || reaction.content === '👍')) {
          continue;
        }

        const aTag = reaction.tags.find(tag => tag[0] === 'a')?.[1];
        if (aTag && aTag.startsWith(`${MUSIC_PLAYLIST_KIND}:`)) {
          playlistRefs.add(aTag);
        }
      }

      if (playlistRefs.size === 0) {
        return;
      }

      const playlists = await this.fetchPlaylistsFromRefs(relayUrls, Array.from(playlistRefs));
      const firstPlaylist = playlists[0];
      if (!firstPlaylist) {
        return;
      }

      const trackRefs = firstPlaylist.tags
        .filter(tag => tag[0] === 'a' && (tag[1] || '').startsWith(`${MUSIC_KIND}:`))
        .map(tag => tag[1]);

      const playlistTracks = await this.fetchTracksFromRefs(relayUrls, trackRefs);
      if (playlistTracks.length === 0) {
        return;
      }

      const playlist: Playlist = {
        id: firstPlaylist.tags.find(tag => tag[0] === 'd')?.[1] || firstPlaylist.id,
        title: firstPlaylist.tags.find(tag => tag[0] === 'title')?.[1] || 'Liked Playlist',
        description: firstPlaylist.tags.find(tag => tag[0] === 'description')?.[1],
        created_at: firstPlaylist.created_at,
        pubkey: firstPlaylist.pubkey,
        isLocal: false,
        eventId: firstPlaylist.id,
        kind: firstPlaylist.kind,
        tracks: playlistTracks.map(track => ({
          url: track.tags.find(tag => tag[0] === 'url')?.[1] || '',
          title: track.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled Track',
          artist: track.tags.find(tag => tag[0] === 'artist')?.[1] || 'Unknown Artist',
          duration: track.tags.find(tag => tag[0] === 'duration')?.[1],
        })).filter(track => !!track.url),
      };

      if (playlist.tracks.length > 0) {
        this.mediaPlayer.playPlaylist(playlist);
      }
    } catch (error) {
      this.logger.error('[Runes] Failed quick play for liked playlists', error);
    } finally {
      this.isPlayingLikedPlaylists.set(false);
    }
  }

  protected openMusicHome(): void {
    void this.router.navigate(['/music']);
  }

  protected runeById(runeId: RuneId): RuneDefinition | undefined {
    return this.runes.find(rune => rune.id === runeId);
  }

  protected onSettingsDragStart(event: DragEvent, runeId: RuneId): void {
    this.draggedRuneId.set(runeId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', runeId);
    }
  }

  protected onSettingsDragOver(event: DragEvent, targetRuneId: RuneId): void {
    event.preventDefault();
    this.dropTargetRuneId.set(targetRuneId);
  }

  protected onSettingsDrop(event: DragEvent, targetRuneId: RuneId): void {
    event.preventDefault();

    const draggedRuneId = this.draggedRuneId() || (event.dataTransfer?.getData('text/plain') as RuneId | '');
    if (!draggedRuneId || draggedRuneId === targetRuneId) {
      this.clearDragState();
      return;
    }

    const currentOrder = [...this.runeOrder()];
    const draggedIndex = currentOrder.indexOf(draggedRuneId);
    const targetIndex = currentOrder.indexOf(targetRuneId);

    if (draggedIndex < 0 || targetIndex < 0) {
      this.clearDragState();
      return;
    }

    currentOrder.splice(draggedIndex, 1);
    currentOrder.splice(targetIndex, 0, draggedRuneId);
    this.runesSettings.setRuneOrder(currentOrder);
    this.clearDragState();
  }

  protected onSettingsDragEnd(): void {
    this.clearDragState();
  }

  protected onWidgetDragStart(event: DragEvent, widgetId: SidebarWidgetId): void {
    this.draggedWidgetId.set(widgetId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', widgetId);
    }
  }

  protected onWidgetDragOver(event: DragEvent, targetWidgetId: SidebarWidgetId): void {
    event.preventDefault();
    this.dropTargetWidgetId.set(targetWidgetId);
  }

  protected onWidgetDrop(event: DragEvent, targetWidgetId: SidebarWidgetId): void {
    event.preventDefault();

    const draggedWidgetId = this.draggedWidgetId() || (event.dataTransfer?.getData('text/plain') as SidebarWidgetId | '');
    if (!draggedWidgetId || draggedWidgetId === targetWidgetId) {
      this.clearWidgetDragState();
      return;
    }

    const currentOrder = [...this.sidebarWidgetOrder()];
    const draggedIndex = currentOrder.indexOf(draggedWidgetId);
    const targetIndex = currentOrder.indexOf(targetWidgetId);

    if (draggedIndex < 0 || targetIndex < 0) {
      this.clearWidgetDragState();
      return;
    }

    currentOrder.splice(draggedIndex, 1);
    currentOrder.splice(targetIndex, 0, draggedWidgetId);
    this.runesSettings.setSidebarWidgetOrder(currentOrder);
    this.clearWidgetDragState();
  }

  protected onWidgetDragEnd(): void {
    this.clearWidgetDragState();
  }

  protected onWidgetItemKeyDown(event: KeyboardEvent, widgetId: SidebarWidgetId): void {
    if (!event.altKey) {
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.runesSettings.moveSidebarWidgetUp(widgetId);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.runesSettings.moveSidebarWidgetDown(widgetId);
    }
  }

  protected onSettingsItemKeyDown(event: KeyboardEvent, runeId: RuneId): void {
    if (!event.altKey) {
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.runesSettings.moveRuneUp(runeId);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.runesSettings.moveRuneDown(runeId);
    }
  }

  protected formatUpdatedAt(timestampSeconds: number | null): string {
    if (!timestampSeconds) {
      return '—';
    }

    return new Date(timestampSeconds * 1000).toLocaleTimeString();
  }

  protected reloadBitcoinPrice(): void {
    if (this.bitcoinPrice().loading) {
      return;
    }

    void this.loadBitcoinPrice();
  }

  private async loadBitcoinPrice(): Promise<void> {
    this.bitcoinPrice.update(state => ({
      ...state,
      loading: true,
      error: null,
    }));

    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
      if (!response.ok) {
        throw new Error(`Price request failed (${response.status})`);
      }

      const data = await response.json() as { bitcoin?: { usd?: number; eur?: number } };
      const usd = data.bitcoin?.usd ?? null;
      const eur = data.bitcoin?.eur ?? null;

      this.bitcoinPrice.set({
        usd,
        eur,
        updatedAt: Math.floor(Date.now() / 1000),
        loading: false,
        error: usd === null ? 'No price in response' : null,
      });
    } catch {
      this.bitcoinPrice.update(state => ({
        ...state,
        loading: false,
        error: 'Failed to fetch Bitcoin price',
      }));
    }
  }

  private clearDragState(): void {
    this.draggedRuneId.set(null);
    this.dropTargetRuneId.set(null);
  }

  private clearWidgetDragState(): void {
    this.draggedWidgetId.set(null);
    this.dropTargetWidgetId.set(null);
  }

  private scheduleHoverHide(runeId?: RuneId): void {
    this.clearHoverHideTimer();

    this.hoverHideTimer = setTimeout(() => {
      if (this.settingsOpen() || this.isFlyoutHovered()) {
        return;
      }

      const hoveredRuneId = this.hoveredRuneId();

      if (hoveredRuneId) {
        if (runeId && hoveredRuneId !== runeId) {
          return;
        }

        if (this.openRunes().includes(hoveredRuneId)) {
          return;
        }

        this.hoverPreviewPosition.set(null);
        this.hoveredRuneId.set(null);
      }

      if (!this.settingsOpen()) {
        this.hoveredSettings.set(false);
        this.settingsPreviewPosition.set(null);
      }
    }, this.HOVER_HIDE_DELAY_MS);
  }

  private clearHoverHideTimer(): void {
    if (this.hoverHideTimer) {
      clearTimeout(this.hoverHideTimer);
      this.hoverHideTimer = null;
    }
  }

  private clampFlyoutTop(preferredTop: number, estimatedHeight: number): number {
    const minTop = this.FLYOUT_TOP_MIN_PX;
    const maxTop = Math.max(
      minTop,
      window.innerHeight - estimatedHeight - this.FLYOUT_VIEWPORT_BOTTOM_MARGIN_PX,
    );

    return Math.min(Math.max(minTop, preferredTop), maxTop);
  }

  private resolveRelayUrls(): string[] {
    const accountRelays = this.accountRelay.getRelayUrls();
    const optimalRelays = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
    return [...new Set([...accountRelays, ...optimalRelays])];
  }

  private collectEvents(relayUrls: string[], filter: Filter, timeoutMs: number): Promise<Event[]> {
    const events: Event[] = [];

    return new Promise(resolve => {
      const subscription = this.pool.subscribe(relayUrls, filter, event => {
        events.push(event);
      });

      setTimeout(() => {
        subscription.close();
        resolve(events);
      }, timeoutMs);
    });
  }

  private async fetchTracksFromRefs(relayUrls: string[], refs: string[]): Promise<Event[]> {
    const trackMap = new Map<string, Event>();

    const filters: Filter[] = [];
    for (const ref of refs) {
      const parts = ref.split(':');
      if (parts.length < 3) {
        continue;
      }

      filters.push({
        kinds: [MUSIC_KIND],
        authors: [parts[1]],
        '#d': [parts[2]],
      });
    }

    await Promise.all(filters.map(async filter => {
      const events = await this.collectEvents(relayUrls, filter, 1800);
      for (const event of events) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const key = `${event.pubkey}:${dTag}`;
        const existing = trackMap.get(key);

        if (!existing || event.created_at > existing.created_at) {
          trackMap.set(key, event);
        }
      }
    }));

    return Array.from(trackMap.values());
  }

  private async fetchPlaylistsFromRefs(relayUrls: string[], refs: string[]): Promise<Event[]> {
    const playlistMap = new Map<string, Event>();

    const filters: Filter[] = [];
    for (const ref of refs) {
      const parts = ref.split(':');
      if (parts.length < 3) {
        continue;
      }

      filters.push({
        kinds: [MUSIC_PLAYLIST_KIND],
        authors: [parts[1]],
        '#d': [parts[2]],
      });
    }

    await Promise.all(filters.map(async filter => {
      const events = await this.collectEvents(relayUrls, filter, 1800);
      for (const event of events) {
        const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const key = `${event.pubkey}:${dTag}`;
        const existing = playlistMap.get(key);

        if (!existing || event.created_at > existing.created_at) {
          playlistMap.set(key, event);
        }
      }
    }));

    return Array.from(playlistMap.values()).sort((left, right) => right.created_at - left.created_at);
  }

  private async trackToMediaItem(track: Event): Promise<{
    source: string;
    title: string;
    artist: string;
    artwork: string;
    type: 'Music';
    eventPubkey: string;
    eventIdentifier: string;
    lyrics: string;
  } | null> {
    const source = track.tags.find(tag => tag[0] === 'url')?.[1];
    if (!source) {
      return null;
    }

    const title = track.tags.find(tag => tag[0] === 'title')?.[1] || 'Untitled Track';
    const image = track.tags.find(tag => tag[0] === 'image')?.[1] || '';
    const dTag = track.tags.find(tag => tag[0] === 'd')?.[1] || '';

    let artist = track.tags.find(tag => tag[0] === 'artist')?.[1] || 'Unknown Artist';
    if (artist === 'Unknown Artist') {
      try {
        const profile = await this.data.getProfile(track.pubkey);
        artist = profile?.data?.display_name || profile?.data?.name || artist;
      } catch {
        artist = 'Unknown Artist';
      }
    }

    return {
      source,
      title,
      artist,
      artwork: image,
      type: 'Music',
      eventPubkey: track.pubkey,
      eventIdentifier: dTag,
      lyrics: this.utilities.extractLyricsFromEvent(track) || '',
    };
  }
}
