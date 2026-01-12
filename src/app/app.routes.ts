import { Routes } from '@angular/router';
import { DataResolver } from './data-resolver';
import { ArticleResolver } from './articleResolver';
import { UsernameResolver } from './usernameResolver';
import { streamResolver } from './stream-resolver';

// Only import the main landing component eagerly
// Everything else should be lazy-loaded
const profileChildren: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/profile/profile-home/profile-home.component').then(m => m.ProfileHomeComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/profile/profile-notes/profile-notes.component').then(m => m.ProfileNotesComponent),
        title: 'Timeline',
      },
      {
        path: 'notes',
        loadComponent: () =>
          import('./pages/profile/profile-notes/profile-notes.component').then(m => m.ProfileNotesComponent),
        title: 'Timeline',
      },
      {
        path: 'reads',
        loadComponent: () =>
          import('./pages/profile/profile-reads/profile-reads.component').then(m => m.ProfileReadsComponent),
        title: 'Reads',
      },
      {
        path: 'media',
        loadComponent: () =>
          import('./pages/profile/profile-media/profile-media.component').then(m => m.ProfileMediaComponent),
        title: 'Media',
      },
    ],
  },
  {
    path: 'about',
    loadComponent: () =>
      import('./pages/profile/profile-about/profile-about.component').then(m => m.ProfileAboutComponent),
    data: { isRoot: true },
    title: 'About',
  },
  {
    path: 'edit',
    loadComponent: () =>
      import('./pages/profile/profile-edit/profile-edit.component').then(m => m.ProfileEditComponent),
    title: 'Edit Profile',
  },
  {
    path: 'following',
    loadComponent: () =>
      import('./pages/profile/following/following.component').then(m => m.FollowingComponent),
    title: 'Following',
  },
  {
    path: 'relays',
    loadComponent: () =>
      import('./pages/profile/profile-relays/profile-relays.component').then(m => m.ProfileRelaysComponent),
    title: 'Relays',
  },
  {
    path: 'details',
    loadComponent: () =>
      import('./pages/profile/details/details.component').then(m => m.DetailsComponent),
    title: 'Details',
  },
  {
    path: 'badges',
    loadComponent: () =>
      import('./pages/badges/badges.component').then(m => m.BadgesComponent),
    title: 'Badges',
  },
];

export const routes: Routes = [
  // Home - activates feeds in the named 'feeds' outlet
  {
    path: '',
    children: [
      {
        path: '',
        outlet: 'feeds',
        loadComponent: () =>
          import('./pages/feeds/feeds.component').then(m => m.FeedsComponent),
      }
    ],
    data: { isRoot: true },
    pathMatch: 'full',
    title: 'Home',
  },
  {
    path: 'share-target',
    loadComponent: () =>
      import('./pages/share-target/share-target.component').then(m => m.ShareTargetComponent),
  },
  {
    path: 'summary',
    loadComponent: () =>
      import('./pages/summary/summary.component').then(m => m.SummaryComponent),
    data: { isRoot: true },
    title: 'Summary',
  },
  {
    path: 'f',
    children: [
      {
        path: '',
        outlet: 'feeds',
        loadComponent: () =>
          import('./pages/feeds/feeds.component').then(m => m.FeedsComponent),
      }
    ],
    title: 'Feeds',
  },
  {
    path: 'f/:path',
    children: [
      {
        path: '',
        outlet: 'feeds',
        loadComponent: () =>
          import('./pages/feeds/feeds.component').then(m => m.FeedsComponent),
      }
    ],
    title: 'Feeds',
  },
  {
    path: 'e/:id',
    loadComponent: () =>
      import('./pages/event/event.component').then(m => m.EventPageComponent),
    resolve: { data: DataResolver },
    title: 'Event',
  },
  {
    path: 'relays',
    loadComponent: () =>
      import('./pages/settings/relays/relays.component').then(m => m.RelaysComponent),
    title: 'Relays',
  },
  {
    path: 'badges',
    data: { isRoot: true },
    title: 'Badges',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/badges/badges.component').then(m => m.BadgesComponent),
      },
      {
        path: 'create',
        loadComponent: () =>
          import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent),
        title: 'Create Badge',
      },
      {
        path: 'details/:id',
        loadComponent: () =>
          import('./pages/badges/badge-details/badge-details.component').then(m => m.BadgeDetailsComponent),
        title: 'Badge Details',
      },
      {
        path: 'edit/:id',
        loadComponent: () =>
          import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent),
        title: 'Edit Badge',
      },
    ],
  },
  {
    path: 'b/:id',
    loadComponent: () =>
      import('./pages/badges/badge-details/badge-details.component').then(m => m.BadgeDetailsComponent),
    title: 'Badge',
  },
  {
    path: 'messages',
    loadComponent: () =>
      import('./pages/messages/messages.component').then(m => m.MessagesComponent),
    data: { isRoot: true },
    title: 'Messages',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/messages/main/main').then(m => m.MessagesMain),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./pages/messages/list/list').then(m => m.MessagesList),
        title: 'Conversation',
      },
    ],
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings.component').then(m => m.SettingsComponent),
    data: { isRoot: true },
    title: 'Settings',
    children: [
      { path: '', redirectTo: 'general', pathMatch: 'full' },
      {
        path: 'general',
        loadComponent: () =>
          import('./pages/settings/general/general.component').then(m => m.GeneralSettingsComponent),
        title: 'General',
      },
      {
        path: 'algorithm',
        loadComponent: () =>
          import('./pages/settings/algorithm/algorithm').then(m => m.AlgorithmComponent),
        title: 'Algorithm',
      },
      {
        path: 'relays',
        loadComponent: () =>
          import('./pages/settings/relays/relays.component').then(m => m.RelaysComponent),
        title: 'Relays',
      },
      {
        path: 'search',
        loadComponent: () =>
          import('./pages/settings/search/search.component').then(m => m.SearchSettingsComponent),
        title: 'Search',
      },
      {
        path: 'privacy',
        loadComponent: () =>
          import('./pages/settings/privacy-settings/privacy-settings.component').then(
            m => m.PrivacySettingsComponent
          ),
        title: 'Privacy & Safety',
      },
      {
        path: 'trust',
        loadComponent: () =>
          import('./pages/settings/trust/trust.component').then(m => m.TrustSettingsComponent),
        title: 'Trust',
      },
      {
        path: 'backup',
        loadComponent: () =>
          import('./pages/backup/backup.component').then(m => m.BackupComponent),
        title: 'Backup',
      },
      {
        path: 'premium',
        loadComponent: () =>
          import('./pages/premium/settings/settings').then(m => m.PremiumSettings),
        title: 'Premium',
      },
      {
        path: 'logs',
        loadComponent: () =>
          import('./pages/settings/logs-settings/logs-settings.component').then(
            m => m.LogsSettingsComponent
          ),
        title: 'Logs',
      },
      {
        path: 'about',
        loadComponent: () =>
          import('./pages/settings/about/about.component').then(m => m.AboutComponent),
        title: 'About',
      },
    ],
  },
  {
    path: 'queue',
    loadComponent: () =>
      import('./pages/media-queue/media-queue.component').then(m => m.MediaQueueComponent),
    title: 'Media Queue',
  },
  {
    path: 'playlists',
    loadComponent: () =>
      import('./pages/media-queue/media-queue.component').then(m => m.MediaQueueComponent),
    title: 'Playlists',
  },
  {
    path: 'discover',
    loadComponent: () =>
      import('./pages/discover/discover.component').then(m => m.DiscoverComponent),
    title: 'Discover',
  },
  {
    path: 'discover/media',
    loadComponent: () =>
      import('./pages/discover/discover.component').then(m => m.DiscoverComponent),
    title: 'Discover Media',
  },
  {
    path: 'discover/content/:category',
    loadComponent: () =>
      import('./pages/discover/discover-category/discover-category.component').then(m => m.DiscoverCategoryComponent),
    title: 'Discover Content',
  },
  {
    path: 'discover/media/:category',
    loadComponent: () =>
      import('./pages/discover/discover-category/discover-category.component').then(m => m.DiscoverCategoryComponent),
    title: 'Discover Media',
  },
  {
    path: 'stream/:encodedEvent',
    loadComponent: () =>
      import('./pages/stream-viewer/stream-viewer.component').then(m => m.StreamViewerComponent),
    title: 'Live Stream',
    resolve: { streamData: streamResolver },
  },
  {
    path: 'music',
    loadComponent: () =>
      import('./pages/music/music.component').then(m => m.MusicComponent),
    data: { isRoot: true },
    title: 'Music',
  },
  {
    path: 'music/offline',
    loadComponent: () =>
      import('./pages/music/music-offline/music-offline.component').then(m => m.MusicOfflineComponent),
    title: 'Offline Music',
  },
  {
    path: 'music/liked',
    loadComponent: () =>
      import('./pages/music/music-liked/music-liked.component').then(m => m.MusicLikedComponent),
    title: 'Liked Songs',
  },
  {
    path: 'music/liked-playlists',
    loadComponent: () =>
      import('./pages/music/music-liked-playlists/music-liked-playlists.component').then(m => m.MusicLikedPlaylistsComponent),
    title: 'Liked Playlists',
  },
  {
    path: 'music/tracks',
    loadComponent: () =>
      import('./pages/music/music-tracks/music-tracks.component').then(m => m.MusicTracksComponent),
    title: 'All Songs',
  },
  {
    path: 'music/playlists',
    loadComponent: () =>
      import('./pages/music/music-playlists/music-playlists.component').then(m => m.MusicPlaylistsComponent),
    title: 'All Playlists',
  },
  {
    path: 'music/artists',
    loadComponent: () =>
      import('./pages/music/artists/artists.component').then(m => m.ArtistsComponent),
    title: 'Artists',
  },
  {
    path: 'music/song/:pubkey/:identifier',
    loadComponent: () =>
      import('./pages/music/song-detail/song-detail.component').then(m => m.SongDetailComponent),
    resolve: { data: DataResolver },
    title: 'Song',
  },
  {
    path: 'music/artist/:pubkey',
    loadComponent: () =>
      import('./pages/music/music-artist/music-artist.component').then(m => m.MusicArtistComponent),
    resolve: { data: DataResolver },
    title: 'Artist',
  },
  {
    path: 'music/playlist/:pubkey/:identifier',
    loadComponent: () =>
      import('./pages/music/music-playlist/music-playlist.component').then(m => m.MusicPlaylistComponent),
    resolve: { data: DataResolver },
    title: 'Playlist',
  },
  {
    path: 'music/terms',
    loadComponent: () =>
      import('./pages/music/music-terms/music-terms.component').then(m => m.MusicTermsComponent),
    title: 'Music Terms of Service',
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./pages/terms/terms.component').then(m => m.TermsComponent),
    title: 'Terms of Use',
  },
  {
    path: 'articles',
    loadComponent: () =>
      import('./pages/articles/articles.component').then(m => m.ArticlesDiscoverComponent),
    data: { isRoot: true },
    title: 'Articles',
  },
  {
    path: 'streams',
    loadComponent: () =>
      import('./pages/streams/streams.component').then(m => m.StreamsComponent),
    data: { isRoot: true },
    title: 'Live Streams',
  },
  {
    path: 'meetings',
    loadComponent: () =>
      import('./pages/meetings/meetings.component').then(m => m.MeetingsComponent),
    data: { isRoot: true },
    title: 'Meeting Spaces',
  },
  {
    path: 'playlists/edit/:id',
    loadComponent: () =>
      import('./pages/playlists/playlist-editor/playlist-editor.component').then(
        m => m.PlaylistEditorComponent
      ),
    title: 'Edit Playlist',
  },
  {
    path: 'polls',
    loadComponent: () =>
      import('./pages/polls/polls.component').then(m => m.PollsComponent),
    title: 'Polls',
  },
  {
    path: 'polls/edit/:id',
    loadComponent: () =>
      import('./pages/polls/poll-editor/poll-editor.component').then(m => m.PollEditorComponent),
    title: 'Edit Poll',
  },
  {
    path: 'notifications',
    loadComponent: () =>
      import('./pages/notifications/notifications.component').then(m => m.NotificationsComponent),
    title: 'Notifications',
  },
  {
    path: 'notifications/settings',
    loadComponent: () =>
      import('./pages/notifications/settings/settings.component').then(
        m => m.NotificationSettingsComponent
      ),
  },
  {
    path: 'notifications/manage',
    loadComponent: () =>
      import('./pages/notifications/manage/manage.component').then(m => m.NotificationManageComponent),
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./pages/search/search.component').then(m => m.SearchComponent),
    data: { isRoot: true },
    title: 'Search',
  },
  {
    path: 'credentials',
    loadComponent: () =>
      import('./pages/credentials/credentials.component').then(m => m.CredentialsComponent),
    data: { isRoot: true },
  },
  {
    path: 'accounts',
    loadComponent: () =>
      import('./pages/accounts/accounts.component').then(m => m.AccountsComponent),
    data: { isRoot: true },
  },
  {
    path: 'about',
    loadComponent: () =>
      import('./pages/settings/about/about.component').then(m => m.AboutComponent),
    data: { isRoot: true },
  },
  {
    path: 'calendar',
    loadComponent: () =>
      import('./pages/calendar/calendar').then(m => m.Calendar),
    data: { isRoot: true },
  },
  {
    path: 'collections',
    data: { isRoot: true },
    loadComponent: () =>
      import('./pages/collections/collections.component').then(m => m.CollectionsComponent),
    title: 'Collections',
  },
  {
    path: 'bookmarks',
    data: { isRoot: true },
    loadComponent: () =>
      import('./pages/bookmarks/bookmarks.component').then(m => m.BookmarksComponent),
    title: 'Bookmarks',
  },
  {
    path: 'memos',
    loadComponent: () =>
      import('./pages/memos/memos.component').then(m => m.MemosComponent),
    data: { isRoot: true },
    title: 'Memos',
  },
  {
    path: 'youtube',
    loadComponent: () =>
      import('./pages/youtube/youtube.component').then(m => m.YouTubeComponent),
    data: { isRoot: true },
    title: 'YouTube',
  },
  {
    path: 'zaps',
    data: { isRoot: true },
    loadComponent: () =>
      import('./components/zap-history/zap-history.component').then(m => m.ZapHistoryComponent),
    title: 'Zap History',
  },
  {
    path: 'article/create',
    loadComponent: () =>
      import('./pages/article/editor/editor.component').then(m => m.EditorComponent),
    title: 'New Article',
  },
  {
    path: 'article/edit/:id',
    loadComponent: () =>
      import('./pages/article/editor/editor.component').then(m => m.EditorComponent),
    title: 'Edit Article',
  },
  {
    path: 'articles/edit',
    loadComponent: () =>
      import('./pages/articles-list/articles-list.component').then(m => m.ArticlesListComponent),
    data: { isRoot: true },
    title: 'Articles',
  },
  {
    path: 'a/:id',
    loadComponent: () =>
      import('./pages/article/article.component').then(m => m.ArticleComponent),
    title: 'Article',
    resolve: { data: DataResolver },
  },
  {
    path: 'a/:id/:slug',
    loadComponent: () =>
      import('./pages/article/article.component').then(m => m.ArticleComponent),
    title: 'Article',
    resolve: { data: DataResolver, article: ArticleResolver },
  },
  {
    path: 'p',
    loadComponent: () =>
      import('./pages/profile/profile-open.component').then(m => m.ProfileOpenComponent),
    resolve: { data: DataResolver },
    children: profileChildren,
  },
  {
    path: 'p/:id',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    resolve: { data: DataResolver },
    children: profileChildren,
  },
  {
    path: 'u/:username',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    resolve: { data: DataResolver, user: UsernameResolver },
    children: profileChildren,
  },
  {
    path: 'premium',
    loadComponent: () =>
      import('./pages/premium/premium.component').then(m => m.PremiumComponent),
    title: 'Nostria Premium',
    data: { isRoot: true },
  },
  {
    path: 'premium/upgrade',
    loadComponent: () =>
      import('./pages/premium/upgrade/upgrade.component').then(m => m.UpgradeComponent),
    title: 'Upgrade to Premium',
  },
  {
    path: 'analytics',
    loadComponent: () =>
      import('./pages/analytics/analytics.component').then(m => m.AnalyticsComponent),
    title: 'Analytics',
    data: { isRoot: true },
  },
  {
    path: 'ai',
    loadComponent: () => import('./pages/ai/ai').then(m => m.AiComponent),
    title: 'AI',
  },
  {
    path: 'ai/settings',
    loadComponent: () =>
      import('./pages/ai/settings/settings.component').then(m => m.AiSettingsComponent),
    title: 'AI Settings',
  },
  {
    path: 'backup',
    loadComponent: () =>
      import('./pages/backup/backup.component').then(m => m.BackupComponent),
  },
  {
    path: 'media',
    data: { isRoot: true },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/media/media.component').then(mod => mod.MediaComponent),
      },
      {
        path: 'details/:id',
        loadComponent: () =>
          import('./pages/media/media-details/media-details.component').then(
            mod => mod.MediaDetailsComponent
          ),
      },
    ],
  },
  {
    path: 'people',
    data: { isRoot: true },
    loadComponent: () => import('./pages/people/people.component').then(m => m.PeopleComponent),
    title: 'People',
  },
  {
    path: 'people/discover',
    data: { isRoot: true },
    loadComponent: () =>
      import('./pages/people/discover/discover-people.component').then(m => m.DiscoverPeopleComponent),
    title: 'Discover People',
  },
  {
    path: 'lists',
    data: { isRoot: true },
    loadComponent: () => import('./pages/lists/lists.component').then(m => m.ListsComponent),
    title: 'Lists',
  },
  {
    path: 'relay-sets',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/relay-sets/relay-sets.component').then(m => m.RelaySetsComponent),
    title: 'Relays',
  },
  {
    path: 'emoji-sets',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/emoji-sets/emoji-sets.component').then(m => m.EmojiSetsComponent),
    title: 'Emojis',
  },
  {
    path: 'interest-sets',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/interest-sets/interest-sets.component').then(m => m.InterestSetsComponent),
    title: 'Interests',
  },
  {
    path: 'delete-event',
    loadComponent: () =>
      import('./pages/delete-event/delete-event.component').then(m => m.DeleteEventComponent),
    data: { isRoot: true },
    title: 'Delete Event',
  },
  {
    path: 'delete-account',
    loadComponent: () =>
      import('./pages/delete-account/delete-account.component').then(m => m.DeleteAccountComponent),
    data: { isRoot: true },
    title: 'Delete Account',
  },
  {
    path: 'debug/storage',
    loadComponent: () =>
      import('./components/storage-debug/storage-debug.component').then(
        mod => mod.StorageDebugComponent
      ),
    title: 'Storage Debug',
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./components/login-dialog/login-dialog.component').then(m => m.LoginDialogComponent),
  },
  {
    path: 'invite/:nprofile',
    loadComponent: () =>
      import('./pages/invite/invite.component').then(m => m.InviteComponent),
    title: 'Join Nostria',
  },
  { path: '**', redirectTo: '/' },
];
