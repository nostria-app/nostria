import { Routes } from '@angular/router';
import { SettingsComponent } from './pages/settings/settings.component';
import { AboutComponent } from './pages/settings/about/about.component';
import { CredentialsComponent } from './pages/credentials/credentials.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { ProfileNotesComponent } from './pages/profile/profile-notes/profile-notes.component';
import { ProfileReadsComponent } from './pages/profile/profile-reads/profile-reads.component';
import { ProfileMediaComponent } from './pages/profile/profile-media/profile-media.component';
import { ProfileAboutComponent } from './pages/profile/profile-about/profile-about.component';
import { FollowingComponent } from './pages/profile/following/following.component';
import { ProfileHomeComponent } from './pages/profile/profile-home/profile-home.component';
import { PremiumComponent } from './pages/premium/premium.component';
import { UpgradeComponent } from './pages/premium/upgrade/upgrade.component';
import { DetailsComponent } from './pages/profile/details/details.component';
import { NotificationsComponent } from './pages/notifications/notifications.component';
import { MessagesComponent } from './pages/messages/messages.component';
import { BadgesComponent } from './pages/badges/badges.component';
import { ProfileRelaysComponent } from './pages/profile/profile-relays/profile-relays.component';
import { AccountsComponent } from './pages/accounts/accounts.component';
import { NotificationSettingsComponent } from './pages/notifications/settings/settings.component';
import { LoginDialogComponent } from './components/login-dialog/login-dialog.component';
import { ProfileEditComponent } from './pages/profile/profile-edit/profile-edit.component';
import { FeedsComponent } from './pages/feeds/feeds.component';
import { SummaryComponent } from './pages/summary/summary.component';
import { ArticleComponent } from './pages/article/article.component';
import { EditorComponent } from './pages/article/editor/editor.component';
import { MediaQueueComponent } from './pages/media-queue/media-queue.component';
import { PlaylistEditorComponent } from './pages/playlists/playlist-editor/playlist-editor.component';
import { EventPageComponent } from './pages/event/event.component';
import { NotificationManageComponent } from './pages/notifications/manage/manage.component';
import { PollsComponent } from './pages/polls/polls.component';
import { PollEditorComponent } from './pages/polls/poll-editor/poll-editor.component';
import { DataResolver } from './data-resolver';
import { ArticleResolver } from './articleResolver';
import { UsernameResolver } from './usernameResolver';
import { streamResolver } from './stream-resolver';
import { MessagesMain } from './pages/messages/main/main';
import { MessagesList } from './pages/messages/list/list';
import { PrivacySettingsComponent } from './pages/settings/privacy-settings/privacy-settings.component';
import { LogsSettingsComponent } from './pages/settings/logs-settings/logs-settings.component';
import { BackupComponent } from './pages/backup/backup.component';
import { PremiumSettings } from './pages/premium/settings/settings';
import { GeneralSettingsComponent } from './pages/settings/general/general.component';
import { Calendar } from './pages/calendar/calendar';
import { AlgorithmComponent } from './pages/settings/algorithm/algorithm';
import { RelaysComponent } from './pages/settings/relays/relays.component';
import { TrustSettingsComponent } from './pages/settings/trust/trust.component';
import { ArticlesListComponent } from './pages/articles-list/articles-list.component';
import { ProfileOpenComponent } from './pages/profile/profile-open.component';
import { DeleteEventComponent } from './pages/delete-event/delete-event.component';
import { DeleteAccountComponent } from './pages/delete-account/delete-account.component';
import { ShareTargetComponent } from './pages/share-target/share-target.component';
import { InviteComponent } from './pages/invite/invite.component';
import { StreamsComponent } from './pages/streams/streams.component';
import { MeetingsComponent } from './pages/meetings/meetings.component';
import { StreamViewerComponent } from './pages/stream-viewer/stream-viewer.component';
import { MemosComponent } from './pages/memos/memos.component';

const profileChildren: Routes = [
  {
    path: '',
    component: ProfileHomeComponent,
    children: [
      { path: '', component: ProfileNotesComponent, title: 'Timeline' },
      { path: 'notes', component: ProfileNotesComponent, title: 'Timeline' },
      { path: 'reads', component: ProfileReadsComponent, title: 'Reads' },
      { path: 'media', component: ProfileMediaComponent, title: 'Media' },
    ],
  },
  {
    path: 'about',
    component: ProfileAboutComponent,
    data: { isRoot: true },
    title: 'About',
  },
  { path: 'edit', component: ProfileEditComponent, title: 'Edit Profile' },
  { path: 'following', component: FollowingComponent, title: 'Following' },
  { path: 'relays', component: ProfileRelaysComponent, title: 'Relays' },
  { path: 'details', component: DetailsComponent, title: 'Details' },
  { path: 'badges', component: BadgesComponent, title: 'Badges' },
];

export const routes: Routes = [
  {
    path: '',
    component: FeedsComponent,
    data: { isRoot: true },
    pathMatch: 'full',
    title: 'Home',
  },
  { path: 'share-target', component: ShareTargetComponent },
  { path: 'summary', component: SummaryComponent, data: { isRoot: true }, title: 'Summary' },
  { path: 'f', component: FeedsComponent, title: 'Feeds' },
  { path: 'f/:path', component: FeedsComponent, title: 'Feeds' },
  {
    path: 'e/:id',
    component: EventPageComponent,
    resolve: { data: DataResolver },
    title: 'Event',
  },
  { path: 'relays', component: RelaysComponent, title: 'Relays' },
  {
    path: 'badges',
    data: { isRoot: true },
    title: 'Badges',
    children: [
      { path: '', component: BadgesComponent },
      {
        path: 'create',
        loadComponent: () =>
          import('./pages/badges/badge-editor/badge-editor.component').then(
            m => m.BadgeEditorComponent
          ),
        title: 'Create Badge',
      },
      {
        path: 'details/:id',
        loadComponent: () =>
          import('./pages/badges/badge-details/badge-details.component').then(
            m => m.BadgeDetailsComponent
          ),
        title: 'Badge Details',
      },
      {
        path: 'edit/:id',
        loadComponent: () =>
          import('./pages/badges/badge-editor/badge-editor.component').then(
            m => m.BadgeEditorComponent
          ),
        title: 'Edit Badge',
      },
    ],
  },
  {
    path: 'b/:id',
    loadComponent: () =>
      import('./pages/badges/badge-details/badge-details.component').then(
        m => m.BadgeDetailsComponent
      ),
    title: 'Badge',
  },
  {
    path: 'messages',
    component: MessagesComponent,
    data: { isRoot: true },
    title: 'Messages',
    children: [
      { path: '', component: MessagesMain },
      { path: ':id', component: MessagesList, title: 'Conversation' },
    ],
  },

  {
    path: 'settings',
    component: SettingsComponent,
    data: { isRoot: true },
    title: 'Settings',
    children: [
      { path: '', redirectTo: 'general', pathMatch: 'full' },
      {
        path: 'general',
        component: GeneralSettingsComponent,
        title: 'General',
      },
      { path: 'algorithm', component: AlgorithmComponent, title: 'Algorithm' },
      { path: 'relays', component: RelaysComponent, title: 'Relays' },
      {
        path: 'privacy',
        component: PrivacySettingsComponent,
        title: 'Privacy & Safety',
      },
      { path: 'trust', component: TrustSettingsComponent, title: 'Trust' },
      { path: 'backup', component: BackupComponent, title: 'Backup' },
      { path: 'premium', component: PremiumSettings, title: 'Premium' },
      { path: 'logs', component: LogsSettingsComponent, title: 'Logs' },
      { path: 'about', component: AboutComponent, title: 'About' },
    ],
  },
  { path: 'queue', component: MediaQueueComponent, title: 'Media Queue' },
  { path: 'playlists', component: MediaQueueComponent, title: 'Playlists' },
  {
    path: 'stream/:encodedEvent',
    component: StreamViewerComponent,
    title: 'Live Stream',
    resolve: { streamData: streamResolver },
  },
  {
    path: 'streams',
    component: StreamsComponent,
    data: { isRoot: true },
    title: 'Live Streams',
  },
  {
    path: 'meetings',
    component: MeetingsComponent,
    data: { isRoot: true },
    title: 'Meeting Spaces',
  },
  { path: 'playlists/edit/:id', component: PlaylistEditorComponent, title: 'Edit Playlist' },
  { path: 'polls', component: PollsComponent, title: 'Polls' },
  { path: 'polls/edit/:id', component: PollEditorComponent, title: 'Edit Poll' },
  {
    path: 'notifications',
    component: NotificationsComponent,
    title: 'Notifications',
  },
  { path: 'notifications/settings', component: NotificationSettingsComponent },
  { path: 'notifications/manage', component: NotificationManageComponent },
  {
    path: 'credentials',
    component: CredentialsComponent,
    data: { isRoot: true },
  },
  { path: 'accounts', component: AccountsComponent, data: { isRoot: true } },
  { path: 'about', component: AboutComponent, data: { isRoot: true } },
  { path: 'calendar', component: Calendar, data: { isRoot: true } },
  {
    path: 'bookmarks',
    data: { isRoot: true },
    loadComponent: () =>
      import('./pages/bookmarks/bookmarks.component').then(m => m.BookmarksComponent),
    title: 'Bookmarks',
  },
  {
    path: 'memos',
    component: MemosComponent,
    data: { isRoot: true },
    title: 'Memos',
  },
  {
    path: 'zaps',
    data: { isRoot: true },
    loadComponent: () =>
      import('./components/zap-history/zap-history.component').then(m => m.ZapHistoryComponent),
    title: 'Zap History',
  },
  { path: 'article/create', component: EditorComponent, title: 'New Article' },
  {
    path: 'article/edit/:id',
    component: EditorComponent,
    title: 'Edit Article',
  },
  {
    path: 'articles',
    component: ArticlesListComponent,
    data: { isRoot: true },
    title: 'Articles',
  },
  {
    path: 'a/:id',
    component: ArticleComponent,
    title: 'Article',
    resolve: { data: DataResolver },
  },
  {
    path: 'a/:id/:slug',
    component: ArticleComponent,
    title: 'Article',
    resolve: { data: DataResolver, article: ArticleResolver },
  },
  {
    path: 'p',
    component: ProfileOpenComponent,
    resolve: { data: DataResolver },
    children: profileChildren,
  },
  {
    path: 'p/:id',
    component: ProfileComponent,
    resolve: { data: DataResolver },
    children: profileChildren,
  },
  {
    path: 'u/:username',
    component: ProfileComponent,
    resolve: { data: DataResolver, user: UsernameResolver },
    children: profileChildren,
  },
  {
    path: 'premium',
    component: PremiumComponent,
    title: 'Nostria Premium',
    data: { isRoot: true },
  },
  {
    path: 'premium/upgrade',
    component: UpgradeComponent,
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
    loadComponent: () => import('./pages/ai/ai').then((m) => m.AiComponent),
    title: 'AI',
  },
  {
    path: 'ai/settings',
    loadComponent: () => import('./pages/ai/settings/settings.component').then((m) => m.AiSettingsComponent),
    title: 'AI Settings',
  },
  {
    path: 'backup',
    loadComponent: () => import('./pages/backup/backup.component').then(mod => mod.BackupComponent),
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
    loadComponent: () => import('./pages/discover/discover.component').then(m => m.DiscoverComponent),
    title: 'Discover People',
  },
  {
    path: 'lists',
    data: { isRoot: true },
    loadComponent: () => import('./pages/lists/lists.component').then(m => m.ListsComponent),
    title: 'Lists',
  },
  {
    path: 'delete-event',
    component: DeleteEventComponent,
    data: { isRoot: true },
    title: 'Delete Event',
  },
  {
    path: 'delete-account',
    component: DeleteAccountComponent,
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
  { path: 'login', component: LoginDialogComponent },
  {
    path: 'invite/:nprofile',
    component: InviteComponent,
    title: 'Join Nostria',
  },
  { path: '**', redirectTo: '/' }, // Update to redirect to root instead of /home
];
