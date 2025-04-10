import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatGridListModule } from '@angular/material/grid-list';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';

@Component({
  selector: 'app-profile-media',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatGridListModule,
    LoadingOverlayComponent
  ],
  templateUrl: './profile-media.component.html',
  styleUrl: './profile-media.component.scss'
})
export class ProfileMediaComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  isLoading = signal(true);
  media = signal<any[]>([]);
  error = signal<string | null>(null);

  constructor() {
    // Load media when component is initialized
    this.loadMedia();
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadMedia(): Promise<void> {
    const pubkey = this.getPubkey();
    
    if (!pubkey) {
      this.error.set('No pubkey provided');
      this.isLoading.set(false);
      return;
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Create mock media data based on pubkey
      const mockMedia = Array.from({ length: 12 }, (_, i) => {
        // Use pubkey and index to generate consistent mock data
        const id = `${pubkey.substring(0, 6)}-media-${i}`;
        
        // Alternate between images and videos
        const mediaType = i % 3 === 0 ? 'video' : 'image';
        
        return {
          id,
          type: mediaType,
          title: `${mediaType === 'video' ? 'Video' : 'Image'} ${i + 1}`,
          url: mediaType === 'image' 
            ? `https://picsum.photos/seed/${id}/400/300` 
            : `https://example.com/videos/${id}.mp4`,
          thumbnail: `https://picsum.photos/seed/${id}/400/300`,
          createdAt: new Date(Date.now() - (i * 86400000)).toISOString(),
          likes: Math.floor(Math.random() * 100),
          comments: Math.floor(Math.random() * 20)
        };
      });
      
      this.media.set(mockMedia);
      
      this.logger.debug('Loaded media for pubkey:', pubkey, mockMedia.length);
    } catch (err) {
      this.logger.error('Error loading media:', err);
      this.error.set('Failed to load media');
    } finally {
      this.isLoading.set(false);
    }
  }
}
