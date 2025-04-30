import { Component, effect, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { ApplicationService } from '../../services/application.service';
import { MetaService } from '../../services/meta.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface WebManifest {
  version?: string;
  name: string;
  short_name: string;
  [key: string]: any;
}

interface MetadataResponse {
  author: {
    profile: {
      display_name?: string;
      name?: string;
    }
  };
  content: string;
  tags: any[];
}

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [MatCardModule, MatListModule, MatIconModule],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss'
})
export class AboutComponent {
  private readonly app = inject(ApplicationService);
  private readonly meta = inject(MetaService);
  private readonly http = inject(HttpClient);
  version = signal('Loading...');

  constructor() {
    effect(() => {
      this.fetchManifestVersion();
    });
  }

  private extractImageUrlFromImeta(tags: any[]): string | null {
    if (!tags || !Array.isArray(tags)) return null;
    
    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === 'imeta') {
        // Extract URL from imeta tag content which is typically in format "url https://..."
        const imetaContent = tag[1];
        if (imetaContent && imetaContent.startsWith('url ')) {
          return imetaContent.substring(4).trim(); // Remove 'url ' prefix
        }
      }
    }
    return null;
  }

  private extractImageUrlFromContent(content: string): string | null {
    if (!content) return null;
    
    // Regular expression to match image URLs in content
    const urlRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i;
    const match = content.match(urlRegex);
    
    return match ? match[0] : null;
  }

  async ngOnInit() {
    if (!this.app.isBrowser()) {
      await this.loadSocialMetadata();
    }
  }

  private async loadSocialMetadata(): Promise<void> {
    try {
      // Get the current URL
      const url = 'https://metadata.nostria.app/e/nevent1qqsy8pt6rh73a20dy04trvsnjy747lx289qwmkrhdmw3wyc0zzz72dg2tp2my';
      
      console.log('Fetching metadata on server...');
      const data = await firstValueFrom(this.http.get<MetadataResponse>(url));
      console.log('Fetching done.');

      // Extract image URL from imeta tag or content
      let imageUrl = this.extractImageUrlFromImeta(data.tags);
      if (!imageUrl) {
        imageUrl = this.extractImageUrlFromContent(data.content);
      }
      
      // Get current browsing URL
      const currentUrl = 'https://nostria.app/e/nevent1qqsy8pt6rh73a20dy04trvsnjy747lx289qwmkrhdmw3wyc0zzz72dg2tp2my';
      let twitterCard = 'summary_large_image'; // Default Twitter card type

      // Summary card should be used for Nostr Profiles, use summary_large_image for events.
      if (false) {
        twitterCard = 'summary';
      }

      this.meta.updateSocialMetadata({
        title: data.author.profile.display_name || data.author.profile.name,
        description: data.content,
        image: imageUrl || 'https://nostria.app/icons/icon-192x192.png', // Use extracted image or fallback
        url: currentUrl,
        twitterCard: twitterCard
      });
    } catch (err) {
      console.error('Error loading social metadata:', err);
    }
  }

  private async fetchManifestVersion(): Promise<void> {
    // Skip fetch on server side
    if (!this.app.isBrowser()) {
      this.version.set('1.0.0'); // Default value for SSR
      return;
    }

    try {
      const manifestData = await firstValueFrom(this.http.get<WebManifest>('/manifest.webmanifest'));

      // Check if version exists in the manifest, otherwise fallback
      if (manifestData.version) {
        this.version.set(manifestData.version);
      } else {
        console.warn('Version not found in manifest.webmanifest');
        this.version.set('1.0.0'); // Fallback version
      }
    } catch (error) {
      console.error('Error fetching manifest.webmanifest:', error);
      this.version.set('1.0.0'); // Fallback version
    }
  }
}
