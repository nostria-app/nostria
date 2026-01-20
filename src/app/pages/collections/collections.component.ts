import { Component, inject } from '@angular/core';

import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

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

  collections: CollectionItem[] = [
    {
      title: $localize`:@@collections.media.title:Media`,
      description: $localize`:@@collections.media.description:Video and photo collections`,
      icon: 'perm_media',
      route: '/collections/media',
      color: '#e91e63',
    },
    {
      title: $localize`:@@collections.bookmarks.title:Bookmarks`,
      description: $localize`:@@collections.bookmarks.description:Your saved notes, articles, and links`,
      icon: 'bookmark',
      route: '/collections/bookmarks',
      color: '#2196f3',
    },
    {
      title: $localize`:@@collections.relays.title:Relays`,
      description: $localize`:@@collections.relays.description:Manage your relay connections`,
      icon: 'dns',
      route: '/collections/relays',
      color: '#ff9800',
    },
    {
      title: $localize`:@@collections.emoji-sets.title:Emoji Sets`,
      description: $localize`:@@collections.emoji-sets.description:Custom emoji collections`,
      icon: 'emoji_emotions',
      route: '/collections/emojis',
      color: '#00bcd4',
    },
    {
      title: $localize`:@@collections.interests.title:Interests`,
      description: $localize`:@@collections.interests.description:Topics and hashtags you follow`,
      icon: 'tag',
      route: '/collections/interests',
      color: '#9c27b0',
    },
  ];

  navigateTo(route: string): void {
    // All collections are list views that open in left panel
    this.router.navigateByUrl(route);
  }
}
