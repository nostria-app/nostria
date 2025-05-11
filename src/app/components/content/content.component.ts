import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SocialPreviewComponent } from '../social-preview/social-preview.component';

interface ContentToken {
  id: number;
  type: 'text' | 'url' | 'youtube' | 'image' | 'audio' | 'linebreak';
  content: string;
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
  imports: [CommonModule, MatCardModule, MatProgressSpinnerModule, SocialPreviewComponent],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss'
})
export class ContentComponent {
  private sanitizer = inject(DomSanitizer);
  
  // Input for raw content
  private _content = signal<string>('');
  
  // Processed content tokens
  contentTokens = computed<ContentToken[]>(() => this.parseContent(this._content()));
  
  // Social previews for URLs
  socialPreviews = signal<SocialPreview[]>([]);

  @Input() set content(value: string) {
    this._content.set(value || '');
  }

  get content() {
    return this._content();
  }

  constructor() {
    // Use effect to load social previews when content changes
    effect(() => {
      const tokens = this.contentTokens();
      const urlTokens = tokens.filter(token => token.type === 'url');
      
      if (urlTokens.length) {
        this.loadSocialPreviews(urlTokens.map(token => token.content));
      } else {
        this.socialPreviews.set([]);
      }
    });
  }

  private parseContent(content: string): ContentToken[] {
    if (!content) return [];
    
    // Regex for different types of content
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const youtubeRegex = /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/g;
    const imageRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?)/gi;
    const audioRegex = /(https?:\/\/[^\s]+\.(mp3|wav|ogg)(\?[^\s]*)?)/gi;
    
    // Replace line breaks with placeholders
    let processedContent = content.replace(/\n/g, '##LINEBREAK##');
    
    // Split content and generate tokens
    let tokens: ContentToken[] = [];
    let tokenId = 0;
    let lastIndex = 0;
    
    // Find all matches and their positions
    const matches: {start: number, end: number, content: string, type: ContentToken['type']}[] = [];
    
    // Find YouTube URLs
    let match: any;
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
      tokens.push({
        id: tokenId++,
        type: match.type,
        content: match.content
      });
      
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
      if (parts[i]) {
        tokens.push({
          id: startId++,
          type: 'text',
          content: parts[i]
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
        const response = await fetch(`https://api.yourdomain.com/metadata?url=${encodeURIComponent(url)}`);
        
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
}
