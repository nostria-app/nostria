import { Component, inject, effect, untracked } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterModule, NavigationEnd } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatTabsModule } from '@angular/material/tabs';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { filter } from 'rxjs';

interface NavLink {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-profile-home',
  standalone: true,
  imports: [MatIconModule, MatTabsModule, RouterModule],
  templateUrl: './profile-home.component.html',
  styleUrl: './profile-home.component.scss',
})
export class ProfileHomeComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);

  // Updated navigation links for the profile tabs
  navLinks: NavLink[] = [
    { path: 'notes', label: 'Timeline', icon: 'timeline' },
    { path: 'reads', label: 'Articles', icon: 'article' },
    { path: 'media', label: 'Media', icon: 'image' },
    // { path: 'about', label: 'About', icon: 'info' },
    // { path: 'connections', label: 'Connections', icon: 'people' },
    // { path: 'following', label: 'Following', icon: 'people' }
  ];

  constructor() {
    // Listen for navigation end to save the active tab
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        const currentPubkey = this.accountState.pubkey();
        const profilePubkey = this.getPubkey();
        const currentPath = this.route.firstChild?.snapshot.url[0]?.path ?? 'notes';

        if (currentPubkey && profilePubkey) {
          // Save the active tab for this profile
          this.accountLocalState.setActiveProfileTab(currentPubkey, `${profilePubkey}:${currentPath}`);
        }
      });

    // Check if we should restore a saved tab
    const currentPubkey = this.accountState.pubkey();
    const profilePubkey = this.getPubkey();

    if (currentPubkey && profilePubkey) {
      const savedTab = this.accountLocalState.getActiveProfileTab(currentPubkey);

      // Check if this saved tab is for the current profile
      if (savedTab && savedTab.startsWith(`${profilePubkey}:`)) {
        const tabPath = savedTab.split(':')[1];
        const currentPath = this.route.firstChild?.snapshot.url[0]?.path ?? '';

        // Only navigate if we're at the default route (empty or 'notes') and the saved tab is different
        if ((currentPath === '' || currentPath === 'notes') && tabPath !== 'notes' && tabPath !== '') {
          this.router.navigate([tabPath], { relativeTo: this.route, replaceUrl: true });
        }
      }
    }
  }

  isLinkActive(path: string, isActive: boolean): boolean {
    const firstChild = this.route.firstChild?.snapshot.url[0]?.path ?? '';
    return isActive || (path === 'notes' && firstChild === '');
  }

  // We'll get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
}
