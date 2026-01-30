import { Component, computed, inject, signal } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterModule, NavigationEnd } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatTabsModule } from '@angular/material/tabs';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { filter } from 'rxjs';
import { ProfileNotesComponent } from '../profile-notes/profile-notes.component';
import { ProfileReadsComponent } from '../profile-reads/profile-reads.component';
import { ProfileMediaComponent } from '../profile-media/profile-media.component';
import { ProfileConnectionComponent } from '../profile-connection/profile-connection.component';

interface NavLink {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-profile-home',
  standalone: true,
  imports: [
    MatIconModule, 
    MatTabsModule, 
    RouterModule, 
    ProfileNotesComponent,
    ProfileReadsComponent,
    ProfileMediaComponent,
    ProfileConnectionComponent
  ],
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
  profileState = inject(PROFILE_STATE);

  // Detect if this profile home is in the right panel outlet
  isInRightPanel = computed(() => {
    return this.route.outlet === 'right';
  });

  // Active tab for right panel mode (defaults to 'notes')
  activeTab = signal<string>('notes');

  // Computed label for articles tab with count
  articlesLabel = computed(() => {
    const count = this.profileState.articles().length;
    return count > 0 ? `Articles (${count})` : 'Articles';
  });

  // Navigation links for the profile tabs - articles uses dynamic label via getLabel()
  navLinks: NavLink[] = [
    { path: 'notes', label: 'Timeline', icon: 'timeline' },
    { path: 'articles', label: 'Articles', icon: 'article' },
    { path: 'media', label: 'Media', icon: 'image' },
    { path: 'connection', label: 'Connection', icon: 'connect_without_contact' },
  ];

  // Get dynamic label for a nav link
  getLabel(link: NavLink): string {
    if (link.path === 'articles') {
      return this.articlesLabel();
    }
    return link.label;
  }

  // Set active tab (for right panel mode)
  setActiveTab(path: string): void {
    this.activeTab.set(path);
  }

  constructor() {
    // Listen for navigation end to save the active tab
    // Only save tab state when not in the right panel to avoid interfering with auxiliary route navigation
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        // Skip tab saving when in the right panel (auxiliary outlet)
        if (this.route.outlet === 'right') {
          return;
        }
        
        const currentPubkey = this.accountState.pubkey();
        const profilePubkey = this.getPubkey();
        const currentPath = this.route.firstChild?.snapshot?.url[0]?.path ?? 'notes';

        if (currentPubkey && profilePubkey) {
          // Save the active tab for this profile
          this.accountLocalState.setActiveProfileTab(currentPubkey, `${profilePubkey}:${currentPath}`);
        }
      });

    // Skip tab restoration when in the right panel (auxiliary outlet)
    // This prevents interfering with auxiliary route navigation
    if (this.route.outlet === 'right') {
      return;
    }

    // Check if we should restore a saved tab
    const currentPubkey = this.accountState.pubkey();
    const profilePubkey = this.getPubkey();

    if (currentPubkey && profilePubkey) {
      const savedTab = this.accountLocalState.getActiveProfileTab(currentPubkey);

      // Check if this saved tab is for the current profile
      if (savedTab && savedTab.startsWith(`${profilePubkey}:`)) {
        let tabPath = savedTab.split(':')[1];
        
        // Migration: rename 'reads' to 'articles'
        if (tabPath === 'reads') {
          tabPath = 'articles';
        }
        
        const currentPath = this.route.firstChild?.snapshot?.url[0]?.path ?? '';

        // Only navigate if we're at the default route (empty or 'notes') and the saved tab is different
        if ((currentPath === '' || currentPath === 'notes') && tabPath !== 'notes' && tabPath !== '') {
          this.router.navigate([tabPath], { relativeTo: this.route, replaceUrl: true });
        }
      }
    }
  }

  isLinkActive(path: string, isActive: boolean): boolean {
    const firstChild = this.route.firstChild?.snapshot?.url[0]?.path ?? '';
    return isActive || (path === 'notes' && firstChild === '');
  }

  // We'll get the pubkey from the profile state (which is set by parent ProfileComponent)
  getPubkey(): string {
    return this.profileState.pubkey() || '';
  }
}
