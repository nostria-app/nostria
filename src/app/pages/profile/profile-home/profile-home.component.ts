import { Component, inject } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatTabsModule } from '@angular/material/tabs';

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
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  // Updated navigation links for the profile tabs
  navLinks: NavLink[] = [
    { path: 'notes', label: 'Timeline', icon: 'timeline' },
    { path: 'reads', label: 'Articles', icon: 'article' },
    { path: 'media', label: 'Media', icon: 'image' },
    // { path: 'about', label: 'About', icon: 'info' },
    // { path: 'connections', label: 'Connections', icon: 'people' },
    // { path: 'following', label: 'Following', icon: 'people' }
  ];

  isLinkActive(path: string, isActive: boolean): boolean {
    const firstChild = this.route.firstChild?.snapshot.url[0]?.path ?? '';
    return isActive || (path === 'notes' && firstChild === '');
  }

  // We'll get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
}
