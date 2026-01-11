import { Component, inject } from '@angular/core';

import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { LayoutService } from '../../services/layout.service';

interface CollectionItem {
  title: string;
  description: string;
  icon: string;
  route: string;
  color: string;
}

@Component({
  selector: 'app-collections',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
  ],
  templateUrl: './collections.component.html',
  styleUrl: './collections.component.scss',
})
export class CollectionsComponent {
  private router = inject(Router);
  layout = inject(LayoutService);

  collections: CollectionItem[] = [
    {
      title: $localize`:@@collections.media.title:Media`,
      description: $localize`:@@collections.media.description:Video and photo collections`,
      icon: 'perm_media',
      route: '/media',
      color: '#e91e63',
    },
    {
      title: $localize`:@@collections.bookmarks.title:Bookmarks`,
      description: $localize`:@@collections.bookmarks.description:Your saved notes, articles, and links`,
      icon: 'bookmark',
      route: '/bookmarks',
      color: '#2196f3',
    },
    {
      title: $localize`:@@collections.relays.title:Relays`,
      description: $localize`:@@collections.relays.description:Manage your relay connections`,
      icon: 'dns',
      route: '/relay-sets',
      color: '#ff9800',
    },
    {
      title: $localize`:@@collections.emoji-sets.title:Emoji Sets`,
      description: $localize`:@@collections.emoji-sets.description:Custom emoji collections`,
      icon: 'emoji_emotions',
      route: '/emoji-sets',
      color: '#00bcd4',
    },
    {
      title: $localize`:@@collections.interests.title:Interests`,
      description: $localize`:@@collections.interests.description:Topics and hashtags you follow`,
      icon: 'tag',
      route: '/interest-sets',
      color: '#9c27b0',
    },
  ];

  navigateTo(route: string): void {
    this.router.navigateByUrl(route);
  }
}
