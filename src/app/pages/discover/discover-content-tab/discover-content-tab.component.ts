import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRippleModule } from '@angular/material/core';

interface ContentCategory {
  id: string;
  title: string;
  description: string;
  icon: string;
  gradient: string;
  route?: string;
}

interface CreatorProfile {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatar?: string;
  followers: number;
  tags: string[];
  verified?: boolean;
}

interface FeaturedContent {
  id: string;
  title: string;
  excerpt: string;
  image?: string;
  type: 'article' | 'photo' | 'gallery' | 'thread';
  author: string;
  authorAvatar?: string;
  publishedAt: string;
  readTime?: string;
  likes: number;
  comments: number;
  tags: string[];
}

interface CuratedSection {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  items: FeaturedContent[];
}

@Component({
  selector: 'app-discover-content-tab',
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
  templateUrl: './discover-content-tab.component.html',
  styleUrl: './discover-content-tab.component.scss',
})
export class DiscoverContentTabComponent {
  private router = inject(Router);

  isLoading = signal(false);
  selectedCategory = signal<string | null>(null);

  readonly contentCategories: ContentCategory[] = [
    {
      id: 'articles',
      title: 'Articles',
      description: 'Long-form writing and in-depth stories',
      icon: 'article',
      gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    },
    {
      id: 'photography',
      title: 'Photography',
      description: 'Visual stories and stunning imagery',
      icon: 'photo_camera',
      gradient: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)',
    },
    {
      id: 'creators',
      title: 'Creators',
      description: 'Discover talented content creators',
      icon: 'person_celebrate',
      gradient: 'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)',
    },
    {
      id: 'threads',
      title: 'Threads',
      description: 'Engaging discussions and conversations',
      icon: 'forum',
      gradient: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)',
    },
    {
      id: 'news',
      title: 'News',
      description: 'Latest updates from the community',
      icon: 'newspaper',
      gradient: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
    },
    {
      id: 'art',
      title: 'Digital Art',
      description: 'Creative works and digital expressions',
      icon: 'palette',
      gradient: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)',
    },
  ];

  readonly quickFilters = [
    { id: 'featured', label: 'Featured', icon: 'star' },
    { id: 'latest', label: 'Latest', icon: 'schedule' },
    { id: 'top', label: 'Top Rated', icon: 'trending_up' },
    { id: 'following', label: 'Following', icon: 'people' },
  ];

  readonly featuredCreators: CreatorProfile[] = [
    {
      id: '1',
      name: 'Alice Crypto',
      handle: 'alice',
      bio: 'Bitcoin educator and writer. Sharing knowledge about decentralized technology.',
      followers: 15420,
      tags: ['Bitcoin', 'Education', 'Technology'],
      verified: true,
    },
    {
      id: '2',
      name: 'Bob the Builder',
      handle: 'bobbuilds',
      bio: 'Developer building on Nostr. Open source enthusiast.',
      followers: 8930,
      tags: ['Developer', 'Nostr', 'Open Source'],
    },
    {
      id: '3',
      name: 'Carol Photography',
      handle: 'carolphoto',
      bio: 'Capturing moments through the lens. Nature and urban explorer.',
      followers: 23100,
      tags: ['Photography', 'Nature', 'Travel'],
      verified: true,
    },
    {
      id: '4',
      name: 'Dave Writer',
      handle: 'davewords',
      bio: 'Long-form content creator. Essays on privacy and freedom.',
      followers: 12500,
      tags: ['Writer', 'Privacy', 'Freedom'],
    },
  ];

  readonly curatedSections: CuratedSection[] = [
    {
      id: 'editors-picks',
      title: "Editor's Picks",
      subtitle: 'Handpicked content from our curators',
      icon: 'auto_awesome',
      items: [
        {
          id: '1',
          title: 'The Future of Decentralized Social Media',
          excerpt: 'An exploration of how protocols like Nostr are reshaping online communication and giving power back to users.',
          type: 'article',
          author: 'Alice Crypto',
          publishedAt: '2 hours ago',
          readTime: '8 min read',
          likes: 234,
          comments: 45,
          tags: ['Nostr', 'Social Media', 'Decentralization'],
        },
        {
          id: '2',
          title: 'Mountain Sunrise Collection',
          excerpt: 'A stunning photo series capturing the first light of day across different mountain ranges.',
          type: 'gallery',
          author: 'Carol Photography',
          publishedAt: '5 hours ago',
          likes: 892,
          comments: 67,
          tags: ['Photography', 'Nature', 'Mountains'],
        },
        {
          id: '3',
          title: 'Why I Chose Freedom Tech',
          excerpt: 'A personal journey from centralized platforms to self-sovereign digital identity.',
          type: 'article',
          author: 'Dave Writer',
          publishedAt: '1 day ago',
          readTime: '12 min read',
          likes: 567,
          comments: 89,
          tags: ['Privacy', 'Freedom', 'Technology'],
        },
      ],
    },
    {
      id: 'trending-articles',
      title: 'Trending Articles',
      subtitle: 'Most read content this week',
      icon: 'local_fire_department',
      items: [
        {
          id: '4',
          title: 'Getting Started with Nostr Development',
          excerpt: 'A comprehensive guide for developers looking to build applications on the Nostr protocol.',
          type: 'article',
          author: 'Bob the Builder',
          publishedAt: '3 days ago',
          readTime: '15 min read',
          likes: 1234,
          comments: 156,
          tags: ['Development', 'Tutorial', 'Nostr'],
        },
        {
          id: '5',
          title: 'The Art of Zapping: Building a Value-for-Value Economy',
          excerpt: 'How lightning payments are creating new economic models for content creators.',
          type: 'article',
          author: 'Alice Crypto',
          publishedAt: '2 days ago',
          readTime: '10 min read',
          likes: 987,
          comments: 134,
          tags: ['Bitcoin', 'Lightning', 'Economics'],
        },
      ],
    },
    {
      id: 'photo-highlights',
      title: 'Photo Highlights',
      subtitle: 'Visual stories worth exploring',
      icon: 'photo_library',
      items: [
        {
          id: '6',
          title: 'Urban Night Stories',
          excerpt: 'Capturing the essence of city life after dark through long exposure photography.',
          type: 'photo',
          author: 'Carol Photography',
          publishedAt: '4 hours ago',
          likes: 456,
          comments: 23,
          tags: ['Urban', 'Night', 'Long Exposure'],
        },
        {
          id: '7',
          title: 'Wildlife Encounters',
          excerpt: 'Rare moments captured in the wild - from forests to savannas.',
          type: 'gallery',
          author: 'Nature Explorer',
          publishedAt: '1 day ago',
          likes: 678,
          comments: 45,
          tags: ['Wildlife', 'Nature', 'Animals'],
        },
        {
          id: '8',
          title: 'Abstract Architecture',
          excerpt: 'Finding patterns and beauty in modern building designs.',
          type: 'photo',
          author: 'Urban Lens',
          publishedAt: '2 days ago',
          likes: 345,
          comments: 28,
          tags: ['Architecture', 'Abstract', 'Design'],
        },
      ],
    },
  ];

  readonly topics = [
    'Technology',
    'Bitcoin',
    'Photography',
    'Art',
    'Writing',
    'Privacy',
    'Development',
    'Philosophy',
    'Science',
    'Culture',
    'Travel',
    'Lifestyle',
  ];

  selectCategory(category: ContentCategory): void {
    if (category.route) {
      this.router.navigate([category.route]);
    } else {
      this.selectedCategory.set(category.id);
    }
  }

  selectFilter(filterId: string): void {
    console.log('Filter selected:', filterId);
  }

  selectTopic(topic: string): void {
    console.log('Topic selected:', topic);
  }

  viewContent(content: FeaturedContent): void {
    console.log('View content:', content);
  }

  viewCreator(creator: CreatorProfile): void {
    console.log('View creator:', creator);
  }

  followCreator(creator: CreatorProfile, event: Event): void {
    event.stopPropagation();
    console.log('Follow creator:', creator);
  }

  getTypeIcon(type: string): string {
    switch (type) {
      case 'article':
        return 'article';
      case 'photo':
        return 'photo';
      case 'gallery':
        return 'photo_library';
      case 'thread':
        return 'forum';
      default:
        return 'description';
    }
  }

  formatFollowers(count: number): string {
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1) + 'M';
    } else if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
  }
}
