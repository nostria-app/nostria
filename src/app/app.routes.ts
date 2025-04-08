import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { RelaysComponent } from './pages/relays/relays.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { AboutComponent } from './pages/about/about.component';
import { CredentialsComponent } from './pages/credentials/credentials.component';
import { ProfileComponent } from './pages/profile/profile.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'relays', component: RelaysComponent },
  { path: 'settings', component: SettingsComponent },
  { path: 'credentials', component: CredentialsComponent },
  { path: 'about', component: AboutComponent },
  { path: 'p/:id', component: ProfileComponent },
  { path: 'profile', redirectTo: '/credentials' }, // Redirect to credentials when no profile specified
  { path: '**', redirectTo: '/home' }
];
