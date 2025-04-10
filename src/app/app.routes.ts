import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { RelaysComponent } from './pages/relays/relays.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { AboutComponent } from './pages/about/about.component';
import { CredentialsComponent } from './pages/credentials/credentials.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { ProfilePostsComponent } from './pages/profile/profile-posts/profile-posts.component';
import { ProfileAboutComponent } from './pages/profile/profile-about/profile-about.component';
import { ProfileConnectionsComponent } from './pages/profile/profile-connections/profile-connections.component';
import { ProfilePhotosComponent } from './pages/profile/profile-photos/profile-photos.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'relays', component: RelaysComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'credentials', component: CredentialsComponent },
  { path: 'about', component: AboutComponent },
  { 
    path: 'p/:id', 
    component: ProfileComponent,
    children: [
      { path: '', redirectTo: 'posts', pathMatch: 'full' },
      { path: 'posts', component: ProfilePostsComponent },
      { path: 'about', component: ProfileAboutComponent },
      { path: 'photos', component: ProfilePhotosComponent },
      { path: 'connections', component: ProfileConnectionsComponent }
    ]
  },
  { path: 'profile', redirectTo: '/credentials' }, // Redirect to credentials when no profile specified
  { path: '**', redirectTo: '/home' }
];
