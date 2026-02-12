import { Routes } from '@angular/router';
import { DataResolver } from './data-resolver';
import { ArticleResolver } from './articleResolver';
import { UsernameResolver } from './usernameResolver';
import { streamResolver } from './stream-resolver';

// Only import the main landing component eagerly
// Everything else should be lazy-loaded

/**
 * Creates profile children routes.
 * IMPORTANT: Must return a fresh array for each use to avoid router state issues.
 * Using the same array reference across multiple outlets (primary and auxiliary)
 * causes Angular's setRouterState to enter infinite recursion when traversing
 * the state tree, resulting in "Maximum call stack size exceeded" errors.
 */
function createProfileChildren(): Routes {
  return [
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
          path: 'articles',
          loadComponent: () =>
            import('./pages/profile/profile-reads/profile-reads.component').then(m => m.ProfileReadsComponent),
          title: 'Articles',
        },
        {
          path: 'media',
          loadComponent: () =>
            import('./pages/profile/profile-media/profile-media.component').then(m => m.ProfileMediaComponent),
          title: 'Media',
        },
        {
          path: 'connection',
          loadComponent: () =>
            import('./pages/profile/profile-connection/profile-connection.component').then(m => m.ProfileConnectionComponent),
          title: 'Connection',
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
      path: 'badges',
      loadComponent: () =>
        import('./pages/profile/profile-badges/profile-badges.component').then(m => m.ProfileBadgesComponent),
      title: 'Badges',
    },
    {
      path: 'details',
      loadComponent: () =>
        import('./pages/profile/details/details.component').then(m => m.DetailsComponent),
      title: 'Details',
    },
  ];
}

export const routes: Routes = [
  // Home - Two-column layout with feeds on left and dynamic content on right
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component').then(m => m.HomeComponent),
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
    path: 'profile-edit',
    loadComponent: () =>
      import('./pages/profile/profile-edit/profile-edit.component').then(m => m.ProfileEditComponent),
    title: 'Edit Profile',
  },
  {
    path: 'f',
    loadComponent: () => import('./components/empty/empty.component').then(m => m.EmptyComponent),
    title: 'Feeds',
  },
  {
    path: 'f/:path',
    redirectTo: '',
    pathMatch: 'full',
  },
  {
    path: 'summary',
    loadComponent: () =>
      import('./pages/summary/summary.component').then(m => m.SummaryComponent),
    data: { isRoot: true },
    title: 'Summary',
  },
  {
    path: 'e/:id',
    loadComponent: () =>
      import('./pages/event/event.component').then(m => m.EventPageComponent),
    resolve: { data: DataResolver },
    title: 'Event',
  },
  {
    path: 'z/:id',
    loadComponent: () =>
      import('./pages/zap-detail/zap-detail.component').then(m => m.ZapDetailComponent),
    title: 'Zap',
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
      {
        path: '',
        loadComponent: () =>
          import('./pages/settings/home/settings-home.component').then(m => m.SettingsHomeComponent),
        title: 'Settings',
      },
      {
        // Catch all settings sub-routes - section components are opened in right panel
        path: ':section',
        loadComponent: () =>
          import('./pages/settings/home/settings-home.component').then(m => m.SettingsHomeComponent),
        title: 'Settings',
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
    redirectTo: 'accounts?tab=credentials',
    pathMatch: 'full',
  },
  {
    path: 'accounts',
    loadComponent: () =>
      import('./pages/accounts/accounts.component').then(m => m.AccountsComponent),
    data: { isRoot: true },
    title: 'Manage Account',
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
    path: 'collections/bookmarks',
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
    path: 'wallet',
    data: { isRoot: true },
    loadComponent: () =>
      import('./pages/wallet/wallet.component').then(m => m.WalletComponent),
    title: 'Wallet',
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
    children: createProfileChildren(),
  },
  {
    path: 'p/:id',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    resolve: { data: DataResolver },
    children: createProfileChildren(),
  },
  {
    path: 'u/:username',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    resolve: { data: DataResolver, user: UsernameResolver },
    children: createProfileChildren(),
  },
  {
    path: 'premium',
    redirectTo: 'accounts?tab=premium',
    pathMatch: 'full',
  },
  {
    path: 'premium/upgrade',
    loadComponent: () =>
      import('./pages/premium/upgrade/upgrade.component').then(m => m.UpgradeComponent),
    title: 'Upgrade to Premium',
  },
  {
    path: 'premium/renew',
    loadComponent: () =>
      import('./pages/premium/renew/renew.component').then(m => m.RenewComponent),
    title: 'Renew Subscription',
  },
  {
    path: 'analytics',
    loadComponent: () =>
      import('./pages/analytics/analytics.component').then(m => m.AnalyticsComponent),
    title: 'Analytics',
    data: { isRoot: true },
  },
  {
    path: 'analytics/event/:id',
    loadComponent: () =>
      import('./pages/event-analytics/event-analytics.component').then(m => m.EventAnalyticsComponent),
    title: 'Event Analytics',
  },
  {
    path: 'newsletter',
    loadComponent: () =>
      import('./pages/newsletter/newsletter.component').then(m => m.NewsletterComponent),
    title: 'Newsletter',
    data: { isRoot: true },
  },
  {
    path: 'newsletter/:id',
    loadComponent: () =>
      import('./pages/newsletter/newsletter.component').then(m => m.NewsletterComponent),
    title: 'Newsletter',
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
    path: 'collections/media',
    data: { isRoot: true },
    loadComponent: () =>
      import('./pages/media/media.component').then(mod => mod.MediaComponent),
    title: 'Media',
  },
  {
    path: 'collections/media/details/:id',
    loadComponent: () =>
      import('./pages/media/media-details/media-details.component').then(
        mod => mod.MediaDetailsComponent
      ),
    title: 'Media Details',
  },
  {
    path: 'people',
    data: { isRoot: true },
    loadComponent: () => import('./pages/people/people.component').then(m => m.PeopleComponent),
    title: 'People',
  },
  {
    path: 'people/list/:setId',
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
    path: 'collections/relays',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/relay-sets/relay-sets.component').then(m => m.RelaySetsComponent),
    title: 'Relays',
  },
  {
    path: 'collections/emojis',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/emoji-sets/emoji-sets.component').then(m => m.EmojiSetsComponent),
    title: 'Emojis',
  },
  {
    path: 'collections/interests',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/interest-sets/interest-sets.component').then(m => m.InterestSetsComponent),
    title: 'Interests',
  },
  {
    path: 'collections/follow-packs',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/follow-packs/follow-packs.component').then(m => m.FollowPacksComponent),
    title: 'Follow Packs',
  },
  {
    path: 'collections/boards',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/boards/boards.component').then(m => m.BoardsComponent),
    title: 'Boards',
  },
  {
    path: 'collections/boards/:kind/:identifier',
    data: { isRoot: true },
    loadComponent: () => import('./pages/collections/boards/board-detail/board-detail.component').then(m => m.BoardDetailComponent),
    title: 'Board',
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
    title: 'Join',
  },

  // Right panel routes (named outlet)
  {
    path: 'e/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/event/event.component').then(m => m.EventPageComponent),
    resolve: { data: DataResolver },
    title: 'Event',
  },
  {
    path: 'z/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/zap-detail/zap-detail.component').then(m => m.ZapDetailComponent),
    title: 'Zap',
  },
  {
    path: 'a/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/article/article.component').then(m => m.ArticleComponent),
    title: 'Article',
    resolve: { data: DataResolver },
  },
  {
    path: 'a/:id/:slug',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/article/article.component').then(m => m.ArticleComponent),
    title: 'Article',
    resolve: { data: DataResolver, article: ArticleResolver },
  },
  // Profile routes in auxiliary outlet WITHOUT children to avoid Angular router state tree issues.
  // When the same nested children structure exists in both primary and auxiliary outlets,
  // Angular's setRouterState enters infinite recursion. Profiles in the right panel
  // will only show the default "notes" tab view.
  {
    path: 'p/:id/details',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/profile/details/details.component').then(m => m.DetailsComponent),
    title: 'Details',
  },
  {
    path: 'p/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    resolve: { data: DataResolver },
  },
  {
    path: 'u/:username',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(m => m.ProfileComponent),
    resolve: { data: DataResolver, user: UsernameResolver },
  },
  {
    path: 'stream/:encodedEvent',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/stream-viewer/stream-viewer.component').then(m => m.StreamViewerComponent),
    title: 'Live Stream',
    resolve: { streamData: streamResolver },
  },
  {
    path: 'music/song/:pubkey/:identifier',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/music/song-detail/song-detail.component').then(m => m.SongDetailComponent),
    resolve: { data: DataResolver },
    title: 'Song',
  },
  {
    path: 'music/artist/:pubkey',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/music/music-artist/music-artist.component').then(m => m.MusicArtistComponent),
    resolve: { data: DataResolver },
    title: 'Artist',
  },
  {
    path: 'music/playlist/:pubkey/:identifier',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/music/music-playlist/music-playlist.component').then(m => m.MusicPlaylistComponent),
    resolve: { data: DataResolver },
    title: 'Playlist',
  },
  {
    path: 'music/liked',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/music/music-liked/music-liked.component').then(m => m.MusicLikedComponent),
    title: 'Liked Songs',
  },
  {
    path: 'music/liked-playlists',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/music/music-liked-playlists/music-liked-playlists.component').then(m => m.MusicLikedPlaylistsComponent),
    title: 'Liked Playlists',
  },
  {
    path: 'collections/media/details/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/media/media-details/media-details.component').then(mod => mod.MediaDetailsComponent),
    title: 'Media Details',
  },
  {
    path: 'user-badges/:pubkey',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/badges/badges.component').then(m => m.BadgesComponent),
    title: 'Badges',
  },
  {
    path: 'badges/details/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/badges/badge-details/badge-details.component').then(m => m.BadgeDetailsComponent),
    title: 'Badge Details',
  },
  {
    path: 'badges/create',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent),
    title: 'Create Badge',
  },
  {
    path: 'badges/edit/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent),
    title: 'Edit Badge',
  },
  {
    path: 'b/:id',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/badges/badge-details/badge-details.component').then(m => m.BadgeDetailsComponent),
    title: 'Badge',
  },
  {
    path: 'user-following/:pubkey',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/user-following/user-following.component').then(m => m.UserFollowingComponent),
    title: 'Following',
  },
  {
    path: 'user-relays/:pubkey',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/user-relays/user-relays.component').then(m => m.UserRelaysComponent),
    title: 'Relays',
  },
  {
    path: 'user-links/:pubkey',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/user-links/user-links.component').then(m => m.UserLinksComponent),
    title: 'Links',
  },
  {
    path: 'user-details/:pubkey',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/profile/details/details.component').then(m => m.DetailsComponent),
    title: 'Details',
  },
  {
    path: 'profile-edit',
    outlet: 'right',
    loadComponent: () =>
      import('./pages/profile/profile-edit/profile-edit.component').then(m => m.ProfileEditComponent),
    title: 'Edit Profile',
  },

  { path: '**', redirectTo: '/' },
];
