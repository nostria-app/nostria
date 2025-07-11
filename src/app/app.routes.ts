import { Routes } from '@angular/router';
import { RelaysComponent } from './pages/relays/relays.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { AboutComponent } from './pages/about/about.component';
import { CredentialsComponent } from './pages/credentials/credentials.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { ProfileNotesComponent } from './pages/profile/profile-notes/profile-notes.component';
import { ProfileRepliesComponent } from './pages/profile/profile-replies/profile-replies.component';
import { ProfileReadsComponent } from './pages/profile/profile-reads/profile-reads.component';
import { ProfileMediaComponent } from './pages/profile/profile-media/profile-media.component';
import { ProfileAboutComponent } from './pages/profile/profile-about/profile-about.component';
import { ProfileConnectionsComponent } from './pages/profile/profile-connections/profile-connections.component';
import { FollowingComponent } from './pages/profile/following/following.component';
import { ProfileHomeComponent } from './pages/profile/profile-home/profile-home.component';
import { PremiumComponent } from './pages/premium/premium.component';
import { UpgradeComponent } from './pages/premium/upgrade/upgrade.component';
import { DetailsComponent } from './pages/profile/details/details.component';
import { NotificationsComponent } from './pages/notifications/notifications.component';
import { MessagesComponent } from './pages/messages/messages.component';
import { ArticlesComponent } from './pages/articles/articles.component';
import { BadgesComponent } from './pages/badges/badges.component';
import { ProfileRelaysComponent } from './pages/profile/profile-relays/profile-relays.component';
import { BetaComponent } from './pages/beta/beta.component';
import { AccountsComponent } from './pages/accounts/accounts.component';
import { NotificationSettingsComponent } from './pages/notifications/settings/settings.component';
import { LoginDialogComponent } from './components/login-dialog/login-dialog.component';
import { ProfileEditComponent } from './pages/profile/profile-edit/profile-edit.component';
import { FeedsComponent } from './pages/feeds/feeds.component';
import { ArticleComponent } from './pages/article/article.component';
import { EditorComponent } from './pages/article/editor/editor.component';
import { MediaQueueComponent } from './pages/media-queue/media-queue.component';
import { EventPageComponent } from './pages/event/event.component';
import { NotificationManageComponent } from './pages/notifications/manage/manage.component';
import { DataResolver } from './data-resolver';
import { UsernameResolver } from './usernameResolver';
import { MessagesMain } from './pages/messages/main/main';
import { MessagesList } from './pages/messages/list/list';
import { PrivacySettingsComponent } from './components/privacy-settings/privacy-settings.component';
import { LogsSettingsComponent } from './components/logs-settings/logs-settings.component';
import { BackupComponent } from './pages/backup/backup.component';
import { PremiumSettings } from './pages/premium/settings/settings';
import { GeneralSettingsComponent } from './pages/settings/general/general.component';

const profileChildren: Routes = [
  {
    path: '',
    component: ProfileHomeComponent,
    children: [
      { path: '', component: ProfileNotesComponent, title: 'Notes' },
      { path: 'notes', component: ProfileNotesComponent, title: 'Notes' },
      { path: 'replies', component: ProfileRepliesComponent, title: 'Replies' },
      { path: 'reads', component: ProfileReadsComponent, title: 'Reads' },
      { path: 'media', component: ProfileMediaComponent, title: 'Media' }
    ]
  },
  { path: 'about', component: ProfileAboutComponent, data: { isRoot: true }, title: 'About' },
  { path: 'edit', component: ProfileEditComponent, title: 'Edit Profile' },
  { path: 'connections', component: ProfileConnectionsComponent, title: 'Connections' },
  { path: 'following', component: FollowingComponent, title: 'Following' },
  { path: 'relays', component: ProfileRelaysComponent, title: 'Relays' },
  { path: 'details', component: DetailsComponent, title: 'Details' }
];

export const routes: Routes = [
  { path: '', component: FeedsComponent, data: { isRoot: true }, pathMatch: 'full', title: 'Home' },
  { path: 'f/:path', component: FeedsComponent, title: 'Feeds' },
  { path: 'e/:id', component: EventPageComponent, resolve: { data: DataResolver }, title: 'Event' },
  { path: 'beta', component: BetaComponent, title: 'Beta' },
  { path: 'relays', component: RelaysComponent, title: 'Relays' },
  {
    path: 'badges',
    data: { isRoot: true },
    title: 'Badges',
    children: [
      { path: '', component: BadgesComponent },
      { path: 'create', loadComponent: () => import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent), title: 'Create Badge' },
      { path: 'details/:id', loadComponent: () => import('./pages/badges/badge-details/badge-details.component').then(m => m.BadgeDetailsComponent), title: 'Badge Details' },
      { path: 'edit/:id', loadComponent: () => import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent), title: 'Edit Badge' }
    ]
  },
  { path: 'b/:id', loadComponent: () => import('./pages/badges/badge-details/badge-details.component').then(m => m.BadgeDetailsComponent), title: 'Badge' },

  // { path: 'messages', component: MessagesComponent },
  {
    path: 'messages',
    component: MessagesComponent,
    data: { isRoot: true },
    title: 'Messages',
    children: [
      { path: '', component: MessagesMain },
      { path: ':id', component: MessagesList, title: 'Conversation' },
    ]
  },

  {
    path: 'settings',
    component: SettingsComponent,
    data: { isRoot: true },
    title: 'Settings',
    children: [
      { path: '', redirectTo: 'general', pathMatch: 'full' },
      { path: 'general', component: GeneralSettingsComponent, title: 'General Settings' },
      { path: 'relays', component: RelaysComponent, title: 'Relays' },
      { path: 'privacy', component: PrivacySettingsComponent, title: 'Privacy & Safety' },
      { path: 'backup', component: BackupComponent, title: 'Backup' },
      { path: 'premium', component: PremiumSettings, title: 'Premium' },
      { path: 'logs', component: LogsSettingsComponent, title: 'Logs' },
      { path: 'about', component: AboutComponent, title: 'About' }
    ]
  },
  { path: 'media-queue', component: MediaQueueComponent, title: 'Media Queue' },
  { path: 'notifications', component: NotificationsComponent, title: 'Notifications' },
  { path: 'notifications/settings', component: NotificationSettingsComponent },
  { path: 'notifications/manage', component: NotificationManageComponent },
  { path: 'credentials', component: CredentialsComponent, data: { isRoot: true } },
  { path: 'accounts', component: AccountsComponent, data: { isRoot: true } },
  { path: 'about', component: AboutComponent, data: { isRoot: true } },
  { path: 'bookmarks', data: { isRoot: true }, loadComponent: () => import('./pages/bookmarks/bookmarks.component').then(m => m.BookmarksComponent), title: 'Bookmarks' },
  { path: 'articles', component: ArticlesComponent, data: { isRoot: true }, title: 'Articles' },
  { path: 'article/create', component: EditorComponent, title: 'New Article' },
  { path: 'article/edit/:id', component: EditorComponent, title: 'Edit Article' },
  { path: 'a/:id', component: ArticleComponent, title: 'Article', resolve: { data: DataResolver } },
  { path: 'a/:id/:slug', component: ArticleComponent, title: 'Article', resolve: { data: DataResolver } },
  {
    path: 'p/:id',
    component: ProfileComponent,
    resolve: { data: DataResolver },
    children: profileChildren,
  },
  {
    path: 'u/:username',
    component: ProfileComponent,
    resolve: { data: UsernameResolver },
    children: profileChildren,
  },
  {
    path: 'premium',
    component: PremiumComponent,
    title: 'Nostria Premium',
    data: { isRoot: true }
  },
  {
    path: 'premium/upgrade',
    component: UpgradeComponent,
    title: 'Upgrade to Premium'
  },
  { path: 'backup', loadComponent: () => import('./pages/backup/backup.component').then(mod => mod.BackupComponent) },
  {
    path: 'media',
    data: { isRoot: true },
    children: [
      { path: '', loadComponent: () => import('./pages/media/media.component').then(mod => mod.MediaComponent) },
      { path: 'details/:id', loadComponent: () => import('./pages/media/media-details/media-details.component').then(mod => mod.MediaDetailsComponent) }
    ],
  },
  {
    path: 'people',
    data: { isRoot: true },
    loadComponent: () => import('./pages/people/people.component').then(m => m.PeopleComponent),
    title: 'People'
  },
  {
    path: 'debug/storage',
    loadComponent: () => import('./components/storage-debug/storage-debug.component').then(mod => mod.StorageDebugComponent),
    title: 'Storage Debug'
  },
  { path: 'login', component: LoginDialogComponent },
  { path: '**', redirectTo: '/' } // Update to redirect to root instead of /home
];