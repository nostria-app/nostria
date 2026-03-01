import { Component, inject, signal, computed, ElementRef, ViewChild, ViewChildren, QueryList, AfterViewInit, OnDestroy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatInputModule } from '@angular/material/input';
import { CustomDialogRef, CustomDialogService } from '../../services/custom-dialog.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventService } from '../../services/event';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';
import { SettingsService } from '../../services/settings.service';
import { SpeechService } from '../../services/speech.service';
import { DebugPanelComponent } from '../debug-panel/debug-panel.component';
import { MetricsDialogComponent } from '../metrics-dialog/metrics-dialog.component';
import { DebugLogsDialogComponent } from '../debug-logs-dialog/debug-logs-dialog.component';
import { RunesSettingsService } from '../../services/runes-settings.service';
import { MediaPlayerService } from '../../services/media-player.service';

export interface Command {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  keywords?: string[];
  description?: string;
}

@Component({
  selector: 'app-command-palette-dialog',
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatInputModule
  ],
  templateUrl: './command-palette-dialog.component.html',
  styleUrls: ['./command-palette-dialog.component.scss']
})
export class CommandPaletteDialogComponent implements AfterViewInit, OnDestroy {
  dialogRef = inject(CustomDialogRef<CommandPaletteDialogComponent>);
  private router = inject(Router);
  private eventService = inject(EventService);
  private layoutService = inject(LayoutService);
  private speechService = inject(SpeechService);
  private settings = inject(SettingsService);
  private snackBar = inject(MatSnackBar);
  private accountState = inject(AccountStateService);
  private customDialog = inject(CustomDialogService);
  private runesSettings = inject(RunesSettingsService);
  private mediaPlayer = inject(MediaPlayerService);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @ViewChildren('listItem', { read: ElementRef }) listItems!: QueryList<ElementRef>;

  searchQuery = signal('');
  selectedIndex = signal(0);
  isListening = signal(false);
  isTranscribing = signal(false);

  commands: Command[] = [
    // Navigation - Core Features
    {
      id: 'nav-home',
      label: 'Go to Home',
      icon: 'home',
      action: () => this.router.navigate(['/']),
      keywords: ['home', 'main', 'start', 'feeds', 'timeline']
    },
    {
      id: 'nav-feeds',
      label: 'Open Feeds',
      icon: 'dynamic_feed',
      action: () => this.router.navigate(['/']),
      keywords: ['feeds', 'timeline', 'posts', 'notes']
    },
    {
      id: 'nav-messages',
      label: 'Open Messages',
      icon: 'mail',
      action: () => this.router.navigate(['/messages']),
      keywords: ['messages', 'inbox', 'dm', 'chat', 'direct']
    },
    {
      id: 'nav-notifications',
      label: 'Open Notifications',
      icon: 'notifications',
      action: () => this.router.navigate(['/notifications']),
      keywords: ['notifications', 'alerts', 'mentions', 'replies', 'activity']
    },
    {
      id: 'nav-discover',
      label: 'Open Discover',
      icon: 'explore',
      action: () => this.router.navigate(['/discover']),
      keywords: ['discover', 'explore', 'browse', 'trending']
    },
    {
      id: 'nav-summary',
      label: 'Open Summary',
      icon: 'summarize',
      action: () => this.router.navigate(['/summary']),
      keywords: ['summary', 'overview', 'dashboard', 'ai']
    },
    {
      id: 'nav-search',
      label: 'Open Advanced Search',
      icon: 'manage_search',
      action: () => this.router.navigate(['/search']),
      keywords: ['search', 'advanced search', 'find', 'lookup', 'query']
    },

    // Navigation - Content
    {
      id: 'nav-articles',
      label: 'Open Articles',
      icon: 'article',
      action: () => this.router.navigate(['/articles']),
      keywords: ['articles', 'blogs', 'long-form', 'reads', 'posts']
    },
    {
      id: 'nav-clips',
      label: 'Open Clips',
      icon: 'smart_display',
      action: () => this.router.navigate(['/clips']),
      keywords: ['clips', 'shorts', 'reels', 'videos', 'vertical']
    },
    {
      id: 'nav-music',
      label: 'Open Music',
      icon: 'music_note',
      action: () => this.router.navigate(['/music']),
      keywords: ['music', 'songs', 'audio', 'tracks', 'artists', 'albums']
    },
    {
      id: 'nav-streams',
      label: 'Open Streams',
      icon: 'live_tv',
      action: () => this.router.navigate(['/streams']),
      keywords: ['streams', 'live', 'video', 'tv', 'broadcast']
    },
    {
      id: 'nav-media',
      label: 'Open Media',
      icon: 'photo_library',
      action: () => this.router.navigate(['/collections/media']),
      keywords: ['media', 'photos', 'images', 'gallery', 'videos']
    },

    // Navigation - Collections & Organization
    {
      id: 'nav-collections',
      label: 'Open Collections',
      icon: 'folder_special',
      action: () => this.router.navigate(['/collections']),
      keywords: ['collections', 'organize', 'sets', 'groups']
    },
    {
      id: 'nav-bookmarks',
      label: 'Open Bookmarks',
      icon: 'bookmarks',
      action: () => this.router.navigate(['/collections/bookmarks']),
      keywords: ['bookmarks', 'saved', 'favorites', 'later']
    },
    {
      id: 'nav-people',
      label: 'Open People',
      icon: 'people',
      action: () => this.router.navigate(['/people']),
      keywords: ['people', 'following', 'followers', 'contacts', 'friends']
    },
    {
      id: 'nav-lists',
      label: 'Open Lists',
      icon: 'list',
      action: () => this.router.navigate(['/lists']),
      keywords: ['lists', 'people lists', 'groups', 'follow sets']
    },
    {
      id: 'nav-emojis',
      label: 'Open Emoji Sets',
      icon: 'emoji_emotions',
      action: () => this.router.navigate(['/collections/emojis']),
      keywords: ['emojis', 'emoji sets', 'custom emojis', 'reactions']
    },
    {
      id: 'nav-interests',
      label: 'Open Interests',
      icon: 'interests',
      action: () => this.router.navigate(['/collections/interests']),
      keywords: ['interests', 'topics', 'hashtags', 'tags']
    },

    // Navigation - Media & Entertainment
    {
      id: 'nav-playlists',
      label: 'Open Playlists',
      icon: 'playlist_play',
      action: () => this.router.navigate(['/playlists']),
      keywords: ['playlists', 'music playlists', 'queue']
    },
    {
      id: 'nav-media-queue',
      label: 'Open Media Queue',
      icon: 'queue_music',
      action: () => this.router.navigate(['/queue']),
      keywords: ['queue', 'media queue', 'watch later', 'play queue']
    },
    {
      id: 'nav-media-player',
      label: 'Open Media Player',
      icon: 'play_circle',
      action: () => {
        if (!this.mediaPlayer.hasQueue()) {
          this.snackBar.open($localize`:@@commandPalette.mediaPlayer.emptyQueue:Media queue is empty`, 'Close', {
            duration: 2500,
          });
          return;
        }

        this.layoutService.showMediaPlayer.set(true);
        void this.mediaPlayer.resume();
      },
      keywords: ['media player', 'music player', 'now playing', 'resume queue']
    },
    {
      id: 'nav-youtube',
      label: 'Open YouTube',
      icon: 'smart_display',
      action: () => this.router.navigate(['/youtube']),
      keywords: ['youtube', 'videos', 'watch']
    },
    {
      id: 'nav-meetings',
      label: 'Open Meetings',
      icon: 'meeting_room',
      action: () => this.router.navigate(['/meetings']),
      keywords: ['meetings', 'calls', 'video chat', 'conference']
    },

    // Navigation - Tools & Utilities
    {
      id: 'nav-memos',
      label: 'Open Memos',
      icon: 'sticky_note_2',
      action: () => this.router.navigate(['/memos']),
      keywords: ['memos', 'private notes', 'reminders', 'personal']
    },
    {
      id: 'nav-calendar',
      label: 'Open Calendar',
      icon: 'calendar_month',
      action: () => this.router.navigate(['/calendar']),
      keywords: ['calendar', 'events', 'schedule', 'dates']
    },
    {
      id: 'nav-polls',
      label: 'Open Polls',
      icon: 'poll',
      action: () => this.router.navigate(['/polls']),
      keywords: ['polls', 'voting', 'survey', 'questions']
    },
    {
      id: 'nav-badges',
      label: 'Open Badges',
      icon: 'badge',
      action: () => this.router.navigate(['/badges']),
      keywords: ['badges', 'achievements', 'awards', 'credentials']
    },
    {
      id: 'nav-zaps',
      label: 'Open Zap History',
      icon: 'bolt',
      action: () => this.router.navigate(['/zaps']),
      keywords: ['zaps', 'payments', 'lightning', 'bitcoin', 'tips', 'history']
    },
    {
      id: 'nav-analytics',
      label: 'Open Analytics',
      icon: 'analytics',
      action: () => this.router.navigate(['/analytics']),
      keywords: ['analytics', 'stats', 'statistics', 'insights', 'metrics']
    },

    // Navigation - Account & Settings
    {
      id: 'nav-profile',
      label: 'Open My Profile',
      icon: 'person',
      action: () => this.router.navigate(['/p', this.accountState.pubkey()]),
      keywords: ['profile', 'me', 'account', 'user', 'my profile']
    },
    {
      id: 'nav-profile-followers',
      label: 'Open My Followers',
      icon: 'group',
      action: () => this.layoutService.openFollowersPage(this.accountState.pubkey()),
      keywords: ['followers', 'my followers', 'people who follow me']
    },
    {
      id: 'nav-profile-edit',
      label: 'Edit Profile',
      icon: 'edit',
      action: () => this.layoutService.openProfileEdit(),
      keywords: ['edit profile', 'update profile', 'change profile']
    },
    {
      id: 'nav-accounts',
      label: 'Open Accounts',
      icon: 'manage_accounts',
      action: () => this.router.navigate(['/accounts']),
      keywords: ['accounts', 'switch account', 'identities', 'login']
    },
    {
      id: 'nav-settings',
      label: 'Open Settings',
      icon: 'settings',
      action: () => this.router.navigate(['/settings']),
      keywords: ['settings', 'config', 'preferences', 'options']
    },
    {
      id: 'nav-settings-general',
      label: 'Settings: General',
      icon: 'settings',
      action: () => this.router.navigate(['/settings/general']),
      keywords: ['general settings', 'language', 'theme', 'dark mode', 'media']
    },
    {
      id: 'nav-settings-media-servers',
      label: 'Settings: Media Servers',
      icon: 'cloud_upload',
      action: () => this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } }),
      keywords: ['media servers', 'upload server', 'fallback server', 'nip-96', 'blossom', 'media upload', 'file hosting']
    },
    {
      id: 'nav-settings-algorithm',
      label: 'Settings: Algorithm',
      icon: 'model_training',
      action: () => this.router.navigate(['/settings/algorithm']),
      keywords: ['algorithm', 'metrics', 'engagement', 'favorites']
    },
    {
      id: 'nav-relays',
      label: 'Settings: Relays',
      icon: 'dns',
      action: () => this.router.navigate(['/settings/relays']),
      keywords: ['relays', 'servers', 'connections', 'network']
    },
    {
      id: 'nav-settings-search',
      label: 'Settings: Search',
      icon: 'search',
      action: () => this.router.navigate(['/settings/search']),
      keywords: ['search settings', 'search relays']
    },
    {
      id: 'nav-settings-privacy',
      label: 'Settings: Privacy & Safety',
      icon: 'security',
      action: () => this.router.navigate(['/settings/privacy']),
      keywords: ['privacy', 'safety', 'mute', 'block', 'content warning']
    },
    {
      id: 'nav-settings-trust',
      label: 'Settings: Trust',
      icon: 'verified_user',
      action: () => this.router.navigate(['/settings/trust']),
      keywords: ['trust', 'verify', 'web of trust', 'reputation', 'nip-85', 'providers', 'brainstorm']
    },
    {
      id: 'nav-wallet',
      label: 'Settings: Wallet',
      icon: 'account_balance_wallet',
      action: () => this.router.navigate(['/settings/wallet']),
      keywords: ['wallet', 'nwc', 'lightning', 'bitcoin', 'payments', 'zap']
    },
    {
      id: 'nav-settings-logs',
      label: 'Settings: Logs',
      icon: 'article',
      action: () => this.router.navigate(['/settings/logs']),
      keywords: ['logs', 'debug', 'console', 'errors']
    },
    {
      id: 'nav-settings-about',
      label: 'Settings: About',
      icon: 'info',
      action: () => this.router.navigate(['/settings/about']),
      keywords: ['about', 'version', 'info', 'credits']
    },
    {
      id: 'nav-backup',
      label: 'Open Backup',
      icon: 'backup',
      action: () => this.router.navigate(['/settings/backup']),
      keywords: ['backup', 'export', 'save', 'restore', 'keys']
    },
    {
      id: 'nav-premium',
      label: 'Open Premium',
      icon: 'workspace_premium',
      action: () => this.router.navigate(['/accounts'], { queryParams: { tab: 'premium' } }),
      keywords: ['premium', 'subscription', 'upgrade', 'pro']
    },

    // Navigation - AI Features
    {
      id: 'nav-ai',
      label: 'Open AI Features',
      icon: 'psychology',
      action: () => this.router.navigate(['/ai']),
      keywords: ['ai', 'artificial intelligence', 'models', 'machine learning']
    },
    {
      id: 'nav-ai-settings',
      label: 'Open AI Settings',
      icon: 'psychology_alt',
      action: () => this.router.navigate(['/ai/settings']),
      keywords: ['ai settings', 'ai config', 'models', 'transformers']
    },

    // Runes
    {
      id: 'runes-toggle-bitcoin-price',
      label: 'Toggle Rune: Bitcoin Price',
      icon: 'currency_bitcoin',
      action: () => this.runesSettings.toggleRuneEnabled('bitcoin-price'),
      keywords: ['runes', 'bitcoin', 'price', 'widget', 'mini app']
    },
    {
      id: 'runes-toggle-weather',
      label: 'Toggle Rune: Weather',
      icon: 'partly_cloudy_day',
      action: () => this.runesSettings.toggleRuneEnabled('weather'),
      keywords: ['runes', 'weather', 'forecast', 'temperature', 'climate']
    },
    {
      id: 'runes-toggle-swiss-knife',
      label: 'Toggle Rune: Nostr Swizz Knife',
      icon: 'construction',
      action: () => this.runesSettings.toggleRuneEnabled('nostr-swiss-knife'),
      keywords: ['runes', 'nostr', 'swiss knife', 'swizz knife', 'convert', 'npub', 'nevent']
    },
    {
      id: 'runes-toggle-music-favorites',
      label: 'Toggle Rune: Music Favorites',
      icon: 'library_music',
      action: () => this.runesSettings.toggleRuneEnabled('music-favorites'),
      keywords: ['runes', 'music', 'favorites', 'liked songs', 'liked playlists']
    },
    {
      id: 'runes-close-pinned',
      label: 'Close Pinned Rune',
      icon: 'close',
      action: () => this.runesSettings.clearOpenRunes(),
      keywords: ['runes', 'close', 'pin', 'unpin', 'sidebar']
    },
    {
      id: 'runes-toggle-sidebar-widget',
      label: 'Toggle Sidebar: Runes',
      icon: 'auto_awesome',
      action: () => this.runesSettings.setSidebarWidgetEnabled('runes', !this.runesSettings.isSidebarWidgetEnabled('runes')),
      keywords: ['runes', 'sidebar', 'show runes', 'hide runes', 'toggle runes']
    },
    {
      id: 'favorites-toggle-sidebar-widget',
      label: 'Toggle Sidebar: Favorites',
      icon: 'star',
      action: () => this.runesSettings.setSidebarWidgetEnabled('favorites', !this.runesSettings.isSidebarWidgetEnabled('favorites')),
      keywords: ['favorites', 'sidebar', 'show favorites', 'hide favorites', 'toggle favorites']
    },
    {
      id: 'runes-move-bitcoin-up',
      label: 'Runes: Move Bitcoin Price Up',
      icon: 'arrow_upward',
      action: () => this.runesSettings.moveRuneUp('bitcoin-price'),
      keywords: ['runes', 'bitcoin', 'move up', 'reorder', 'order']
    },
    {
      id: 'runes-move-bitcoin-down',
      label: 'Runes: Move Bitcoin Price Down',
      icon: 'arrow_downward',
      action: () => this.runesSettings.moveRuneDown('bitcoin-price'),
      keywords: ['runes', 'bitcoin', 'move down', 'reorder', 'order']
    },
    {
      id: 'runes-move-weather-up',
      label: 'Runes: Move Weather Up',
      icon: 'arrow_upward',
      action: () => this.runesSettings.moveRuneUp('weather'),
      keywords: ['runes', 'weather', 'move up', 'reorder', 'order']
    },
    {
      id: 'runes-move-weather-down',
      label: 'Runes: Move Weather Down',
      icon: 'arrow_downward',
      action: () => this.runesSettings.moveRuneDown('weather'),
      keywords: ['runes', 'weather', 'move down', 'reorder', 'order']
    },
    {
      id: 'runes-move-swiss-up',
      label: 'Runes: Move Nostr Swizz Knife Up',
      icon: 'arrow_upward',
      action: () => this.runesSettings.moveRuneUp('nostr-swiss-knife'),
      keywords: ['runes', 'swizz knife', 'swiss knife', 'move up', 'reorder', 'order']
    },
    {
      id: 'runes-move-swiss-down',
      label: 'Runes: Move Nostr Swizz Knife Down',
      icon: 'arrow_downward',
      action: () => this.runesSettings.moveRuneDown('nostr-swiss-knife'),
      keywords: ['runes', 'swizz knife', 'swiss knife', 'move down', 'reorder', 'order']
    },
    {
      id: 'runes-move-music-up',
      label: 'Runes: Move Music Favorites Up',
      icon: 'arrow_upward',
      action: () => this.runesSettings.moveRuneUp('music-favorites'),
      keywords: ['runes', 'music favorites', 'move up', 'reorder', 'order']
    },
    {
      id: 'runes-move-music-down',
      label: 'Runes: Move Music Favorites Down',
      icon: 'arrow_downward',
      action: () => this.runesSettings.moveRuneDown('music-favorites'),
      keywords: ['runes', 'music favorites', 'move down', 'reorder', 'order']
    },

    // Developer & Debug Tools
    {
      id: 'debug-panel',
      label: 'Debug: Relay',
      icon: 'bug_report',
      action: () => this.openDebugPanel(),
      keywords: ['debug', 'relay', 'diagnostics', 'subscriptions', 'connections', 'pool', 'developer', 'devtools', 'troubleshoot'],
      description: 'View relay connections, subscriptions, and queries'
    },

    {
      id: 'debug-metrics',
      label: 'Debug: Metrics',
      icon: 'speed',
      action: () => this.openMetricsPanel(),
      keywords: ['debug', 'metrics', 'performance', 'timing', 'profiling', 'speed', 'benchmark', 'wasm', 'webassembly'],
      description: 'View application performance metrics and timing data'
    },
    {
      id: 'debug-event-logs',
      label: 'Debug: Event Logs',
      icon: 'feed',
      action: () => this.openDebugLogsPanel(),
      keywords: ['debug', 'logs', 'events', 'malformed', 'nostr', 'diagnostics', 'inspector'],
      description: 'Inspect malformed event contexts and samples'
    },

    // Actions - Content Creation
    {
      id: 'act-create-note',
      label: 'Create Note',
      icon: 'edit_note',
      action: () => this.openNoteEditor(),
      keywords: ['create note', 'write note', 'new note', 'post', 'compose']
    },
    {
      id: 'act-create-article',
      label: 'Create Article',
      icon: 'post_add',
      action: () => this.layoutService.createArticle(),
      keywords: ['create article', 'write article', 'new article', 'blog', 'long-form']
    }
  ];

  filteredCommands = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.commands;

    return this.commands.filter(cmd =>
      cmd.label.toLowerCase().includes(query) ||
      cmd.keywords?.some(k => k.toLowerCase().includes(query))
    );
  });

  ngAfterViewInit() {
    // Small delay to ensure dialog is fully rendered and focusable
    setTimeout(() => {
      if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    }, 100);
  }

  ngOnDestroy() {
    this.speechService.cleanup();
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex.update(i => Math.min(i + 1, this.filteredCommands().length - 1));
      this.scrollToSelected();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex.update(i => Math.max(i - 1, 0));
      this.scrollToSelected();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.executeSelected();
    } else if (event.key === 'Escape') {
      this.dialogRef.close();
    }
  }

  scrollToSelected() {
    setTimeout(() => {
      const selectedEl = this.listItems.get(this.selectedIndex())?.nativeElement;
      selectedEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  executeSelected() {
    const commands = this.filteredCommands();
    if (commands.length > 0 && this.selectedIndex() >= 0 && this.selectedIndex() < commands.length) {
      const cmd = commands[this.selectedIndex()];
      this.executeCommand(cmd);
    }
  }

  executeCommand(cmd: Command) {
    this.dialogRef.close();
    cmd.action();
  }

  openNoteEditor() {
    this.eventService.createNote();
  }

  openDebugPanel() {
    this.customDialog.open(DebugPanelComponent, {
      title: 'Debug: Relay',
      width: '1400px',
      maxWidth: '95vw',
    });
  }

  openMetricsPanel() {
    this.customDialog.open(MetricsDialogComponent, {
      title: 'Debug: Metrics',
      width: '900px',
      maxWidth: '95vw',
    });
  }

  openDebugLogsPanel() {
    this.customDialog.open(DebugLogsDialogComponent, {
      title: 'Debug: Event Logs',
      width: '1100px',
      maxWidth: '95vw',
    });
  }

  // Voice Command Implementation
  async toggleRecording() {
    if (this.isListening()) {
      this.speechService.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    // Check if AI transcription is enabled
    if (!this.settings.settings().aiEnabled || !this.settings.settings().aiTranscriptionEnabled) {
      this.snackBar.open('AI transcription is disabled in settings', 'Open Settings', { duration: 5000 })
        .onAction().subscribe(() => {
          this.dialogRef.close();
          this.router.navigate(['/ai/settings']);
        });
      return;
    }

    this.isListening.set(true);
    this.searchQuery.set('Listening...');

    await this.speechService.startRecording({
      silenceDuration: 2000,
      onRecordingStateChange: (isRecording) => {
        this.isListening.set(isRecording);
        if (!isRecording && !this.isTranscribing()) {
          this.searchQuery.set('Processing...');
        }
      },
      onTranscribingStateChange: (isTranscribing) => {
        this.isTranscribing.set(isTranscribing);
        if (isTranscribing) {
          this.searchQuery.set('Processing...');
        }
      },
      onTranscription: (text) => {
        this.handleTranscription(text);
      }
    });
  }

  private handleTranscription(text: string) {
    // Filter out common Whisper hallucinations/noise
    const hallucinations = [
      /^\[.*\]$/i,  // [music playing], [Music], etc.
      /^music$/i,
      /^music playing$/i,
      /^\(.*\)$/i,  // (music), etc.
      /^\.+$/,      // Just periods
      /^,+$/,       // Just commas
      /^\s*$/,      // Empty or whitespace only
    ];

    const trimmedText = text.trim();
    if (hallucinations.some(pattern => pattern.test(trimmedText))) {
      // Ignore hallucination, don't update the search query
      return;
    }

    const cleanText = trimmedText.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()[\]]/g, "").trim();

    // Ignore if cleaned text is empty
    if (!cleanText) {
      return;
    }

    // Check for "search <term>" command
    const searchMatch = cleanText.match(/^search\s+(.+)$/i);
    if (searchMatch) {
      const searchTerm = searchMatch[1].trim();
      this.dialogRef.close();
      this.layoutService.openSearchWithValue(searchTerm);
      return;
    }

    // Check for "find <term>" command (alternative)
    const findMatch = cleanText.match(/^find\s+(.+)$/i);
    if (findMatch) {
      const searchTerm = findMatch[1].trim();
      this.dialogRef.close();
      this.layoutService.openSearchWithValue(searchTerm);
      return;
    }

    this.searchQuery.set(cleanText);

    // Try to find a match
    const commands = this.commands;
    const match = commands.find(cmd =>
      cmd.label.toLowerCase() === cleanText ||
      cmd.keywords?.some(k => k.toLowerCase() === cleanText)
    );

    if (match) {
      this.executeCommand(match);
      return;
    }

    // Also try partial matching for common voice command patterns
    const partialMatch = commands.find(cmd =>
      cleanText.includes(cmd.label.toLowerCase()) ||
      cmd.keywords?.some(k => cleanText.includes(k.toLowerCase()))
    );

    if (partialMatch) {
      this.executeCommand(partialMatch);
      return;
    }
    // If no match, leave the text in search box so user can see it filtered
    // The computed filteredCommands will update automatically
  }
}
