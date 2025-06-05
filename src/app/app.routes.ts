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
import { EventComponent } from './pages/event/event.component';

export const routes: Routes = [
  { path: '', component: FeedsComponent, pathMatch: 'full' },
  { path: 'f/:path', component: FeedsComponent },
  { path: 'e/:id', component: EventComponent },
  { path: 'beta', component: BetaComponent, title: 'Beta' },
  { path: 'relays', component: RelaysComponent },
  {
    path: 'badges',
    children: [
      { path: '', component: BadgesComponent },
      { path: 'create', loadComponent: () => import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent) },
      { path: 'details/:id', loadComponent: () => import('./pages/badges/badge-details/badge-details.component').then(m => m.BadgeDetailsComponent) },
      { path: 'edit/:id', loadComponent: () => import('./pages/badges/badge-editor/badge-editor.component').then(m => m.BadgeEditorComponent) }
    ]
  },
  { path: 'messages', component: MessagesComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'media-queue', component: MediaQueueComponent },
  { path: 'notifications', component: NotificationsComponent },
  { path: 'notifications/settings', component: NotificationSettingsComponent },
  { path: 'credentials', component: CredentialsComponent },
  { path: 'accounts', component: AccountsComponent },
  { path: 'about', component: AboutComponent },  { path: 'bookmarks', loadComponent: () => import('./pages/bookmarks/bookmarks.component').then(m => m.BookmarksComponent), title: 'Bookmarks' },
  { path: 'articles', component: ArticlesComponent, title: 'Articles' },
  { path: 'article/create', component: EditorComponent, title: 'New Article' },
  { path: 'article/edit/:id', component: EditorComponent, title: 'Edit Article' },
  { path: 'a/:id', component: ArticleComponent, title: 'Article' },
  {
    path: 'p/:id',
    component: ProfileComponent,
    children: [
      { 
        path: '', 
        component: ProfileHomeComponent,
        children: [
          { path: '', redirectTo: 'notes', pathMatch: 'full' },
          { path: 'notes', component: ProfileNotesComponent },
          { path: 'replies', component: ProfileRepliesComponent },
          { path: 'reads', component: ProfileReadsComponent },
          { path: 'media', component: ProfileMediaComponent }
        ] 
      },
      { path: 'about', component: ProfileAboutComponent },
      { path: 'edit', component: ProfileEditComponent },
      { path: 'connections', component: ProfileConnectionsComponent },
      { path: 'following', component: FollowingComponent },
      { path: 'relays', component: ProfileRelaysComponent },
      { path: 'details', component: DetailsComponent }
    ]
  },
  {
    path: 'premium',
    component: PremiumComponent,
    title: 'Nostria Premium'
  },
  {
    path: 'premium/upgrade',
    component: UpgradeComponent,
    title: 'Upgrade to Premium'
  },
  { path: 'backup', loadComponent: () => import('./pages/backup/backup.component').then(mod => mod.BackupComponent) },
  {
    path: 'media',
    children: [
      { path: '', loadComponent: () => import('./pages/media/media.component').then(mod => mod.MediaComponent) },
      { path: 'details/:id', loadComponent: () => import('./pages/media/media-details/media-details.component').then(mod => mod.MediaDetailsComponent) }
    ]
  },
  {
    path: 'people',
    loadComponent: () => import('./pages/people/people.component').then(m => m.PeopleComponent),
    title: 'People'
  },
  { path: 'profile', redirectTo: '/credentials' },
  { path: 'login', component: LoginDialogComponent },
  { path: '**', redirectTo: '/' } // Update to redirect to root instead of /home
];