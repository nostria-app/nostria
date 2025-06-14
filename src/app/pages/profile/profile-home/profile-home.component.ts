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
  imports: [
    MatIconModule,
    MatTabsModule,
    RouterModule
],
  templateUrl: './profile-home.component.html',
  styleUrl: './profile-home.component.scss'
})
export class ProfileHomeComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

    // Updated navigation links for the profile tabs
    navLinks: NavLink[] = [
      { path: 'notes', label: 'Notes', icon: 'chat' },
      { path: 'replies', label: 'Replies', icon: 'reply_all' },
      { path: 'reads', label: 'Reads', icon: 'bookmark' },
      { path: 'media', label: 'Media', icon: 'image' },
      // { path: 'about', label: 'About', icon: 'info' },
      // { path: 'connections', label: 'Connections', icon: 'people' },
      // { path: 'following', label: 'Following', icon: 'people' }
    ];

  // We'll get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
}
