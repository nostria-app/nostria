import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRippleModule } from '@angular/material/core';

interface MediaCategory {
  id: string;
  title: string;
  description: string;
  icon: string;
  gradient: string;
  route?: string;
}

interface FeaturedSection {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  items: DiscoverItem[];
}

interface DiscoverItem {
  id: string;
  title: string;
  description: string;
  image?: string;
  type: 'podcast' | 'music' | 'video' | 'live' | 'article';
  creator?: string;
  duration?: string;
  tags?: string[];
}

@Component({
  selector: 'app-discover-media-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatChipsModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatRippleModule,
  ],
  templateUrl: './discover-media-tab.component.html',
  styleUrl: './discover-media-tab.component.scss',
})
export class DiscoverMediaTabComponent {
  private router = inject(Router);

  isLoading = signal(false);
  selectedCategory = signal<string | null>(null);

  readonly mediaCategories: MediaCategory[] = [
    {
      id: 'podcasts',
      title: 'Podcasts',
      description: 'Listen to conversations, stories, and ideas',
      icon: 'podcasts',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    },
    {
      id: 'music',
      title: 'Music',
      description: 'Discover tracks from independent artists',
      icon: 'library_music',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    },
    {
      id: 'videos',
      title: 'Videos',
      description: 'Watch educational and entertainment content',
      icon: 'smart_display',
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    },
    {
      id: 'live',
      title: 'Live Streams',
      description: 'Join live broadcasts happening now',
      icon: 'stream',
      gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      route: '/streams',
    },
    {
      id: 'audiobooks',
      title: 'Audiobooks',
      description: 'Listen to narrated books and stories',
      icon: 'auto_stories',
      gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    },
    {
      id: 'radio',
      title: 'Radio',
      description: 'Tune into community radio stations',
      icon: 'radio',
      gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    },
  ];

  readonly quickActions = [
    { id: 'trending', label: 'Trending', icon: 'trending_up' },
    { id: 'new', label: 'New Releases', icon: 'new_releases' },
    { id: 'popular', label: 'Popular', icon: 'whatshot' },
    { id: 'following', label: 'Following', icon: 'people' },
  ];

  readonly featuredSections: FeaturedSection[] = [
    {
      id: 'trending-podcasts',
      title: 'Trending Podcasts',
      subtitle: 'Popular shows in the community',
      icon: 'trending_up',
      items: [
        {
          id: '1',
          title: 'The Bitcoin Standard',
          description: 'Economics, philosophy, and the future of money',
          type: 'podcast',
          creator: 'Saifedean Ammous',
          duration: '45 min',
          tags: ['Bitcoin', 'Economics'],
        },
        {
          id: '2',
          title: 'Nostr Talks',
          description: 'Weekly discussions about the Nostr protocol',
          type: 'podcast',
          creator: 'Community',
          duration: '60 min',
          tags: ['Nostr', 'Technology'],
        },
        {
          id: '3',
          title: 'Freedom Tech',
          description: 'Exploring decentralized technologies',
          type: 'podcast',
          creator: 'Various Hosts',
          duration: '30 min',
          tags: ['Tech', 'Privacy'],
        },
      ],
    },
    {
      id: 'new-music',
      title: 'Fresh Music',
      subtitle: 'Newly released tracks from artists',
      icon: 'library_music',
      items: [
        {
          id: '4',
          title: 'Decentralized Dreams',
          description: 'Electronic ambient soundscape',
          type: 'music',
          creator: 'Anonymous Artist',
          duration: '4:32',
          tags: ['Electronic', 'Ambient'],
        },
        {
          id: '5',
          title: 'Lightning Network',
          description: 'Energetic electronic beats',
          type: 'music',
          creator: 'Satoshi Sounds',
          duration: '3:45',
          tags: ['Electronic', 'Dance'],
        },
        {
          id: '6',
          title: 'Purple Pill',
          description: 'Chill lo-fi vibes',
          type: 'music',
          creator: 'Lo-Fi Master',
          duration: '2:58',
          tags: ['Lo-Fi', 'Chill'],
        },
      ],
    },
    {
      id: 'featured-videos',
      title: 'Featured Videos',
      subtitle: 'Must-watch content',
      icon: 'smart_display',
      items: [
        {
          id: '7',
          title: 'Building on Nostr',
          description: 'A complete developer guide',
          type: 'video',
          creator: 'Dev Community',
          duration: '25:00',
          tags: ['Development', 'Tutorial'],
        },
        {
          id: '8',
          title: 'Privacy in the Digital Age',
          description: 'Documentary about digital privacy',
          type: 'video',
          creator: 'Documentary Team',
          duration: '45:00',
          tags: ['Documentary', 'Privacy'],
        },
      ],
    },
  ];

  readonly genres = [
    'Technology',
    'Music',
    'Entertainment',
    'Education',
    'News',
    'Comedy',
    'Sports',
    'Art',
    'Science',
    'Philosophy',
    'Bitcoin',
    'Nostr',
  ];

  selectCategory(category: MediaCategory): void {
    if (category.route) {
      this.router.navigate([category.route]);
    } else {
      this.selectedCategory.set(category.id);
    }
  }

  selectQuickAction(actionId: string): void {
    console.log('Quick action selected:', actionId);
  }

  selectGenre(genre: string): void {
    console.log('Genre selected:', genre);
  }

  playItem(item: DiscoverItem): void {
    console.log('Play item:', item);
  }

  getTypeIcon(type: string): string {
    switch (type) {
      case 'podcast':
        return 'podcasts';
      case 'music':
        return 'music_note';
      case 'video':
        return 'smart_display';
      case 'live':
        return 'stream';
      default:
        return 'play_circle';
    }
  }
}
