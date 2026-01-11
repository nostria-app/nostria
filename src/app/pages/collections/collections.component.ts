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
      title: $localize`:@@collections.bookmarks.title:Bookmarks`,
      description: $localize`:@@collections.bookmarks.description:Your saved notes, articles, and links`,
      icon: 'bookmark',
      route: '/bookmarks',
      color: '#2196f3',
    },
    {
      title: $localize`:@@collections.curated-lists.title:Curated Lists`,
      description: $localize`:@@collections.curated-lists.description:Organized collections of content`,
      icon: 'collections',
      route: '/lists?tab=sets&kind=30004',
      color: '#4caf50',
    },
    {
      title: $localize`:@@collections.interest-sets.title:Interest Sets`,
      description: $localize`:@@collections.interest-sets.description:Topics organized by hashtags`,
      icon: 'label',
      route: '/lists?tab=sets&kind=30015',
      color: '#ff9800',
    },
    {
      title: $localize`:@@collections.emoji-sets.title:Emoji Sets`,
      description: $localize`:@@collections.emoji-sets.description:Custom emoji collections`,
      icon: 'emoji_emotions',
      route: '/lists?tab=sets&kind=30030',
      color: '#9c27b0',
    },
  ];

  navigateTo(route: string): void {
    this.router.navigateByUrl(route);
  }
}
