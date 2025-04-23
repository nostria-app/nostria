import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
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
import { LearnComponent } from './pages/learn/learn.component';
import { PremiumComponent } from './pages/premium/premium.component';
import { UpgradeComponent } from './pages/premium/upgrade/upgrade.component';
import { DetailsComponent } from './pages/profile/details/details.component';
import { NotificationsComponent } from './pages/notifications/notifications.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'learn', component: LearnComponent },
  { path: 'relays', component: RelaysComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'notifications', component: NotificationsComponent },
  { path: 'credentials', component: CredentialsComponent },
  { path: 'about', component: AboutComponent },
  {
    path: 'p/:id',
    component: ProfileComponent,
    children: [
      { path: '', component: ProfileHomeComponent, pathMatch: 'full' },
      { path: 'replies', component: ProfileRepliesComponent },
      { path: 'reads', component: ProfileReadsComponent },
      { path: 'media', component: ProfileMediaComponent },
      { path: 'about', component: ProfileAboutComponent },
      { path: 'connections', component: ProfileConnectionsComponent },
      { path: 'following', component: FollowingComponent },
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
  { path: '**', redirectTo: '/home' }
];
