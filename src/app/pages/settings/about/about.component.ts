import { Component, effect, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { ApplicationService } from '../../../services/application.service';
import { MetaService } from '../../../services/meta.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { LayoutService } from '../../../services/layout.service';
import { MatButtonModule } from '@angular/material/button';

interface WebManifest {
  version?: string;
  commitSha?: string;
  commitShort?: string;
  buildDate?: string;
  name: string;
  short_name: string;
  [key: string]: any;
}

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [MatCardModule, MatListModule, MatIconModule, MatButtonModule],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent implements OnInit, OnDestroy {
  private readonly app = inject(ApplicationService);
  private readonly meta = inject(MetaService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  version = signal('Loading...');
  commitSha = signal<string | undefined>(undefined);
  commitShort = signal<string | undefined>(undefined);
  buildDate = signal<string | undefined>(undefined);

  constructor() {
    effect(() => {
      this.fetchManifestVersion();
    });
  }

  resetIntroduction() {
    this.layout.showWelcomeScreen.set(true);
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
    // Parent settings component handles the page title
  }

  ngOnDestroy() {
    // No cleanup needed
  }

  private async fetchManifestVersion(): Promise<void> {
    // Skip fetch on server side
    if (!this.app.isBrowser()) {
      this.version.set('1.0.0'); // Default value for SSR
      return;
    }

    try {
      const manifestData = await firstValueFrom(
        this.http.get<WebManifest>('/manifest.webmanifest')
      );

      // Check if version exists in the manifest, otherwise fallback
      if (manifestData.version) {
        this.version.set(manifestData.version);
      } else {
        console.warn('Version not found in manifest.webmanifest');
        this.version.set('1.0.0'); // Fallback version
      }

      // Set commit and build date information
      if (manifestData.commitSha) {
        this.commitSha.set(manifestData.commitSha);
      }
      if (manifestData.commitShort) {
        this.commitShort.set(manifestData.commitShort);
      }
      if (manifestData.buildDate) {
        this.buildDate.set(manifestData.buildDate);
      }
    } catch (error) {
      console.error('Error fetching manifest.webmanifest:', error);
      this.version.set('1.0.0'); // Fallback version
    }
  }
}
