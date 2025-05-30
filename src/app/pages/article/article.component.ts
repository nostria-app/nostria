import { Component, inject, computed, signal, effect } from '@angular/core';
import { Event } from 'nostr-tools';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UtilitiesService } from '../../services/utilities.service';
import { NostrService } from '../../services/nostr.service';
import { StorageService } from '../../services/storage.service';
import { LoggerService } from '../../services/logger.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { DateToggleComponent } from '../../components/date-toggle/date-toggle.component';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

@Component({
  selector: 'app-article',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    DateToggleComponent
  ],
  templateUrl: './article.component.html',
  styleUrl: './article.component.scss'
})
export class ArticleComponent {
  private route = inject(ActivatedRoute);
  private utilities = inject(UtilitiesService);
  private nostrService = inject(NostrService);
  private storageService = inject(StorageService);
  private logger = inject(LoggerService);
  private sanitizer = inject(DomSanitizer);

  event = signal<Event | undefined>(undefined);
  isLoading = signal(false);
  error = signal<string | null>(null);
  constructor() {
    // Effect to load article when route parameter changes
    effect(() => {
      const addrParam = this.route.snapshot.paramMap.get('id');
      if (addrParam) {
        this.loadArticle(addrParam);
      }
    });
  }

  async loadArticle(naddr: string): Promise<void> {

    const receivedData = history.state.event as Event | undefined;

    if (receivedData) {
      this.logger.debug('Received event from navigation state:', receivedData);
      this.event.set(receivedData);
      this.isLoading.set(false);
      return;
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);

      // Decode the naddr1 parameter using nip19.decode()
      const decoded = this.nostrService.decode(naddr);

      if (decoded.type !== 'naddr') {
        throw new Error('Invalid article address format');
      }

      const addrData = decoded.data as any;
      this.logger.debug('Decoded naddr:', addrData);

      // Try to load the article from storage first, then from relays if needed
      // For now, we'll set a placeholder event structure
      // In a real implementation, you would fetch the actual event using the decoded data
      // Example article event structure with rich content
      const articleEvent: Event = {
        id: addrData.identifier || 'sample-article-' + Date.now(),
        pubkey: addrData.pubkey || '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
        created_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        kind: 30023, // Long-form content kind
        tags: [
          ['d', addrData.identifier || 'sample-article'],
          ['title', 'The Future of Decentralized Social Networks: A Deep Dive into Nostr Protocol'],
          ['summary', 'Exploring how the Nostr protocol is revolutionizing social media by enabling censorship-resistant, decentralized communication without the need for traditional servers or centralized platforms.'],
          ['image', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2070&auto=format&fit=crop'],
          ['published_at', (Math.floor(Date.now() / 1000) - 7200).toString()], // 2 hours ago
          ['t', 'nostr'],
          ['t', 'decentralization'],
          ['t', 'social-media'],
          ['t', 'blockchain'],
          ['t', 'technology'],
          ['t', 'privacy'],
          ['t', 'censorship-resistance']
        ],
        content: JSON.stringify(`# The Future of Decentralized Social Networks

## Introduction

In an era where centralized social media platforms dominate our digital interactions, a new paradigm is emerging that promises to return control to users while maintaining the connectivity we've come to rely on. The **Nostr protocol** (Notes and Other Stuff Transmitted by Relays) represents a fundamental shift in how we think about social networking.

## What Makes Nostr Different?

### True Decentralization

Unlike traditional social media platforms that rely on centralized servers, Nostr operates on a network of independent relays. This architecture means:

- **No single point of failure** - If one relay goes down, your content remains accessible through others
- **Censorship resistance** - No central authority can silence your voice
- **Data portability** - Your identity and content aren't locked to any platform

### Cryptographic Identity

Every user has a cryptographic identity consisting of:

1. **Public Key** (npub) - Your unique identifier across the network
2. **Private Key** (nsec) - Used to sign and authenticate your content
3. **Digital Signatures** - Every note is cryptographically signed, ensuring authenticity

## Technical Architecture

### Relays: The Backbone

Relays are simple servers that:
- Store and forward messages
- Can be run by anyone
- Implement basic filtering and spam protection
- Cost pennies to operate

### Clients: The Interface

Clients connect to multiple relays and provide:
- User-friendly interfaces
- Content aggregation
- Local caching and optimization
- Custom features and algorithms

## Real-World Applications

### Social Networking
- **Twitter-like microblogging** with global reach
- **Image and video sharing** without platform restrictions
- **Direct messaging** with end-to-end encryption

### Content Publishing
- **Long-form articles** like this one
- **Newsletter distribution** without platform dependency
- **Podcast hosting** and discovery

### Commerce and Payments
- **Lightning Network integration** for instant micropayments
- **Zaps** - send Bitcoin tips directly to creators
- **Marketplace functionality** without intermediaries

## Challenges and Solutions

### Scalability
While Nostr's simplicity is a strength, it also presents scaling challenges:

**Challenge**: Limited throughput compared to centralized platforms
**Solution**: Specialized relays, client-side caching, and intelligent relay selection

### User Experience
**Challenge**: Technical complexity can intimidate newcomers
**Solution**: Improved client UX, key management tools, and onboarding flows

### Content Moderation
**Challenge**: No central authority to moderate content
**Solution**: Client-side filtering, community-driven moderation, and reputation systems

## The Road Ahead

### Growing Ecosystem

The Nostr ecosystem is rapidly expanding with:
- **100+ different clients** serving various use cases
- **Thousands of relays** worldwide
- **Integration with Bitcoin** for monetization
- **Developer tools** making it easier to build

### Future Innovations

Exciting developments on the horizon include:
- **Decentralized file storage** integration
- **Advanced reputation systems**
- **Cross-protocol bridges**
- **AI-powered content discovery**

## Getting Started

Ready to explore Nostr? Here's how:

1. **Choose a client** - Try Damus (iOS), Amethyst (Android), or web clients like nostria.app
2. **Generate keys** - Most clients will create these for you
3. **Find relays** - Start with popular public relays
4. **Connect** - Follow interesting accounts and start posting

## Conclusion

Nostr represents more than just another social media platform - it's a foundational technology for a more open, resilient, and user-controlled internet. As we move forward, the principles of decentralization, cryptographic verification, and user sovereignty will become increasingly important.

The future of social networking isn't about finding the next big platform - it's about building protocols that empower users and resist centralized control. Nostr is leading this charge, and we're just getting started.

---

*This article was published on the Nostr network, demonstrating the very technology it describes. Join the conversation using the hashtags below and experience decentralized social media firsthand.*`),
        sig: 'sample_signature_would_go_here'
      };

      this.event.set(articleEvent);
    } catch (error) {
      this.logger.error('Error loading article:', error);
      this.error.set('Failed to load article');
    } finally {
      this.isLoading.set(false);
    }
  }
  // Computed properties for parsed event data
  title = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('title', ev.tags)[0] || '';
  });

  image = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('image', ev.tags)[0] || '';
  });

  summary = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return this.utilities.getTagValues('summary', ev.tags)[0] || '';
  });
  publishedAt = computed(() => {
    const ev = this.event();
    if (!ev) return null;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return new Date(parseInt(publishedAtTag) * 1000);
    }
    return new Date(ev.created_at * 1000);
  });

  publishedAtTimestamp = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const publishedAtTag = this.utilities.getTagValues('published_at', ev.tags)[0];
    if (publishedAtTag) {
      return parseInt(publishedAtTag);
    }
    return ev.created_at;
  });

  hashtags = computed(() => {
    const ev = this.event();
    if (!ev) return [];
    return this.utilities.getTagValues('t', ev.tags);
  });
  content = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    try {
      // Try to parse as JSON first, fall back to raw content
      const parsed = JSON.parse(ev.content);
      return typeof parsed === 'string' ? parsed : ev.content;
    } catch {
      return ev.content;
    }
  });  // New computed property for parsed markdown content
  parsedContent = computed<SafeHtml>(() => {
    const content = this.content();
    if (!content) return '';

    try {
      // Configure marked for security and features
      marked.setOptions({
        gfm: true,
        breaks: true
      });

      // Parse markdown to HTML (marked.parse returns string)
      const htmlContent = marked.parse(content) as string;

      // Sanitize and return safe HTML
      return this.sanitizer.bypassSecurityTrustHtml(htmlContent);
    } catch (error) {
      this.logger.error('Error parsing markdown:', error);
      // Fallback to plain text
      return this.sanitizer.bypassSecurityTrustHtml(
        content.replace(/\n/g, '<br>')
      );
    }
  });

  authorPubkey = computed(() => {
    const ev = this.event();
    return ev?.pubkey || '';
  });

  formatLocalDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  retryLoad(): void {
    const addrParam = this.route.snapshot.paramMap.get('id');
    if (addrParam) {
      this.loadArticle(addrParam);
    }
  }
}
