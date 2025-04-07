import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'home', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
  { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent) },
  { path: 'relays', loadComponent: () => import('./pages/relays/relays.component').then(m => m.RelaysComponent) },
  { path: 'about', loadComponent: () => import('./pages/about/about.component').then(m => m.AboutComponent) },
  { path: 'credentials', loadComponent: () => import('./pages/credentials/credentials.component').then(m => m.CredentialsComponent) },
  { path: '**', redirectTo: 'home' }
];
