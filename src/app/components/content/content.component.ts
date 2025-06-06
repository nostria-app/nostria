import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule } from '@angular/material/dialog';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SocialPreviewComponent } from '../social-preview/social-preview.component';
import { MatDialog } from '@angular/material/dialog';
import { ImageDialogComponent } from '../image-dialog/image-dialog.component';
import { SettingsService } from '../../services/settings.service';
import { UtilitiesService } from '../../services/utilities.service';

interface ContentToken {
  id: number;
  type: 'text' | 'url' | 'youtube' | 'image' | 'audio' | 'video' | 'linebreak' | 'nostr-mention';
  content: string;
  nostrData?: { type: string; data: any; displayName: string };
}

interface SocialPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  loading: boolean;
  error: boolean;
}

@Component({
  selector: 'app-content',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatProgressSpinnerModule, SocialPreviewComponent, MatDialogModule],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss'
})
export class ContentComponent implements AfterViewInit, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  private dialog = inject(MatDialog);
  settings = inject(SettingsService);
  private utilities = inject(UtilitiesService);
  
  @ViewChild('contentContainer') contentContainer!: ElementRef;
  
  // Input for raw content
  private _content = signal<string>('');
  
  // Track visibility of the component
  private _isVisible = signal<boolean>(false);
  isVisible = computed(() => this._isVisible());
  
  // Observer for intersection
  private intersectionObserver: IntersectionObserver | null = null;
  
  // Processed content tokens
  contentTokens = computed<ContentToken[]>(() => {
    // Only parse content if component is visible
    return this._isVisible() ? this.parseContent(this._content()) : [];
  });
  
  // Social previews for URLs
  socialPreviews = signal<SocialPreview[]>([]);

  @Input() set content(value: string) {
    this._content.set(value || '');
  }

  get content() {
    return this._content();
  }

  constructor() {
    // Use effect to load social previews when content changes AND component is visible
    effect(() => {
      if (!this._isVisible()) return;
      
      const tokens = this.contentTokens();
      const urlTokens = tokens.filter(token => token.type === 'url');
      
      if (urlTokens.length) {
        this.loadSocialPreviews(urlTokens.map(token => token.content));
      } else {
        this.socialPreviews.set([]);
      }
    });
  }

  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  ngOnDestroy() {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
  }

  private setupIntersectionObserver() {
    // Ensure the element reference exists before proceeding
    if (!this.contentContainer?.nativeElement) {
      // If element isn't available yet, set a default visible state to true
      // and try again later with a slight delay
      this._isVisible.set(true); // Make content visible by default
      
      setTimeout(() => {
        if (this.contentContainer?.nativeElement) {
          this.setupIntersectionObserver();
        }
      }, 100);
      
      return;
    }

    // Options for the observer (which part of item visible, etc)
    const options = {
      root: null, // Use viewport as root
      rootMargin: '0px',
      threshold: 0.1 // 10% of the item visible
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        this._isVisible.set(entry.isIntersecting);
      });
    }, options);

    // Start observing the element
    this.intersectionObserver.observe(this.contentContainer.nativeElement);
  }

  private parseContent(content: string): ContentToken[] {
    if (!content) return [];
    
    // Replace line breaks with placeholders
    let processedContent = content.replace(/\n/g, '##LINEBREAK##');
    
    // Regex for different types of content - updated to avoid capturing trailing LINEBREAK placeholders
    const urlRegex = /(https?:\/\/[^\s##]+)(?=\s|##LINEBREAK##|$)/g;
    const youtubeRegex = /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?=\s|##LINEBREAK##|$)/g;
    const imageRegex = /(https?:\/\/[^\s##]+\.(jpg|jpeg|png|gif|webp)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const audioRegex = /(https?:\/\/[^\s##]+\.(mp3|wav|ogg)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const videoRegex = /(https?:\/\/[^\s##]+\.(mp4|webm|mov|avi|wmv|flv|mkv)(\?[^\s##]*)?(?=\s|##LINEBREAK##|$))/gi;
    const nostrRegex = /(nostr:[a-zA-Z0-9]+1[a-zA-Z0-9]+)(?=\s|##LINEBREAK##|$)/g;
    
    // Split content and generate tokens
    let tokens: ContentToken[] = [];
    let tokenId = 0;
    let lastIndex = 0;
    
    // Find all matches and their positions
    const matches: {start: number, end: number, content: string, type: ContentToken['type'], nostrData?: any}[] = [];
    
    // Find Nostr URIs first (highest priority)
    let match: any;
    while ((match = nostrRegex.exec(processedContent)) !== null) {
      const nostrData = this.utilities.parseNostrUri(match[0]);
      if (nostrData) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[0],
          type: 'nostr-mention',
          nostrData
        });
      }
    }
    
    // Find YouTube URLs
    while ((match = youtubeRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'youtube'
      });
    }
    
    // Find image URLs
    imageRegex.lastIndex = 0;
    while ((match = imageRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'image'
      });
    }
    
    // Find video URLs
    videoRegex.lastIndex = 0;
    while ((match = videoRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'video'
      });
    }
    
    // Find audio URLs
    audioRegex.lastIndex = 0;
    while ((match = audioRegex.exec(processedContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        type: 'audio'
      });
    }
    
    // Find remaining URLs
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(processedContent)) !== null) {
      // Check if this URL was already matched as a special type
      const isSpecialType = matches.some(m => m.start === match.index && m.end === match.index + match[0].length);
      
      if (!isSpecialType) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[0],
          type: 'url'
        });
      }
    }
    
    // Sort matches by their starting position
    matches.sort((a, b) => a.start - b.start);
    
    // Process text segments and matches
    for (const match of matches) {
      // Add text segment before the match
      if (match.start > lastIndex) {
        const textSegment = processedContent.substring(lastIndex, match.start);
        this.processTextSegment(textSegment, tokens, tokenId);
        tokenId = tokens.length;
      }
      
      // Add the match as a token
      const token: ContentToken = {
        id: tokenId++,
        type: match.type,
        content: match.content
      };
      
      if (match.nostrData) {
        token.nostrData = match.nostrData;
      }
      
      tokens.push(token);
      
      lastIndex = match.end;
    }
    
    // Add remaining text after the last match
    if (lastIndex < processedContent.length) {
      const textSegment = processedContent.substring(lastIndex);
      this.processTextSegment(textSegment, tokens, tokenId);
    }
    
    return tokens;
  }
  
  private processTextSegment(segment: string, tokens: ContentToken[], startId: number): void {
    // Process line breaks in text segments
    const parts = segment.split('##LINEBREAK##');

    for (let i = 0; i < parts.length; i++) {
      // Only add text token if there's actual content (not empty string)
      if (parts[i].trim()) {
        tokens.push({
          id: startId++,
          type: 'text',
          content: parts[i].trim()
        });
      }
      
      // Add a line break token after each part except the last one
      if (i < parts.length - 1) {
        tokens.push({
          id: startId++,
          type: 'linebreak',
          content: ''
        });
      }
    }
  }
  
  getYouTubeEmbedUrl(url: string): SafeResourceUrl {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    
    if (match && match[1]) {
      const embedUrl = `https://www.youtube.com/embed/${match[1]}`;
      return this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
    }
    
    return this.sanitizer.bypassSecurityTrustResourceUrl('');
  }
  
  getVideoType(url: string): string {
    const extension = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    switch (extension) {
      case 'mp4':
        return 'mp4';
      case 'webm':
        return 'webm';
      case 'mov':
        return 'quicktime';
      case 'avi':
        return 'x-msvideo';
      case 'wmv':
        return 'x-ms-wmv';
      case 'flv':
        return 'x-flv';
      case 'mkv':
        return 'x-matroska';
      default:
        return 'mp4';
    }
  }
  
  private async loadSocialPreviews(urls: string[]): Promise<void> {
    // Initialize previews with loading state
    const initialPreviews = urls.map(url => ({
      url,
      loading: true,
      error: false
    }));
    
    this.socialPreviews.set(initialPreviews);
    
    // Load previews for each URL
    const previewPromises = urls.map(async (url, index) => {
      try {
        // In a real implementation, you would call an API to fetch the metadata
        // For example, using a service like Open Graph or your own backend API
        const response = await fetch(`https://metadata.nostria.app/og?url=${encodeURIComponent(url)}`);
        
        // This is a mock response - replace with actual API call
        // const preview = await response.json();
        
        // Mock preview data
        const preview = await this.mockFetchPreview(url);
        
        return {
          ...preview,
          url,
          loading: false,
          error: false
        };
      } catch (error) {
        console.error(`Failed to load preview for ${url}:`, error);
        return {
          url,
          loading: false,
          error: true
        };
      }
    });
    
    // Update previews as they complete
    const previews = await Promise.all(previewPromises);
    this.socialPreviews.set(previews);
  }
  
  // Mock function for demonstration purposes
  private async mockFetchPreview(url: string): Promise<Partial<SocialPreview>> {
    // In a real application, replace this with an actual API call
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
    
    // Return mock data based on URL type
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return {
        title: 'YouTube Video Title',
        description: 'This is a YouTube video description',
        image: 'https://i.ytimg.com/vi/SAMPLE_ID/hqdefault.jpg'
      };
    } else if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return {
        title: 'Image',
        description: 'Image from the web',
        image: url
      };
    } else {
      return {
        title: `Website Title for ${new URL(url).hostname}`,
        description: 'Website description would appear here',
        image: 'https://via.placeholder.com/300x200?text=Website+Preview'
      };
    }
  }
  
  /**
   * Opens an image dialog to view the image with zoom capabilities
   */
  openImageDialog(imageUrl: string): void {
    console.log('Opening image dialog for URL:', imageUrl);
    this.dialog.open(ImageDialogComponent, {
      data: { imageUrl },
      maxWidth: '95vw',
      maxHeight: '95vh',
      width: '100%',
      height: '100%',
      panelClass: 'image-dialog'
    });
  }

  onNostrMentionClick(token: ContentToken): void {
    if (!token.nostrData) return;
    
    const { type, data } = token.nostrData;
    
    switch (type) {
      case 'npub':
      case 'nprofile':
        // Navigate to profile page
        const pubkey = type === 'npub' ? data : data.pubkey;
        window.location.href = `/p/${this.utilities.getNpubFromPubkey(pubkey)}`;
        break;
      case 'note':
      case 'nevent':
        // Navigate to event page  
        const eventId = type === 'note' ? data : data.id;
        window.location.href = `/e/${eventId}`;
        break;
      case 'naddr':
        // Navigate to address-based event
        const encoded = this.utilities.extractNostrUriIdentifier(token.content);
        window.location.href = `/a/${encoded}`;
        break;
      default:
        console.warn('Unsupported nostr URI type:', type);
    }
  }
}
