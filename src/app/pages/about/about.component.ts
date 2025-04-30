import { Component, effect, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { ApplicationService } from '../../services/application.service';
import { MetaService } from '../../services/meta.service';

interface WebManifest {
  version?: string;
  name: string;
  short_name: string;
  [key: string]: any;
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
  version = signal('Loading...');

  constructor() {
    effect(() => {
      this.fetchManifestVersion();
    });
  }

  async ngOnInit() {
    if (!this.app.isBrowser()) {

      // Get the current URL
      const url = 'https://metadata.nostria.app/api/e/nevent1qqsy8pt6rh73a20dy04trvsnjy747lx289qwmkrhdmw3wyc0zzz72dg2tp2my';
      const result = await fetch(url);

      if (result.ok) {
        const data = await result.json();
        console.log('Data:', data);

        console.log('Author:', data.author.profile.display_name || data.author.profile.name);

        

        this.meta.updateSocialMetadata({
          title: data.author.profile.display_name || data.author.profile.name,
          description: data.content,
          image: 'https://yoursite.com/image.jpg',
          url: 'https://primal.net/e/nevent1qqsy8pt6rh73a20dy04trvsnjy747lx289qwmkrhdmw3wyc0zzz72dg2tp2my'
        });
      }
    }
  }

  private async fetchManifestVersion(): Promise<void> {
    // Skip fetch on server side
    if (!this.app.isBrowser()) {
      this.version.set('1.0.0'); // Default value for SSR
      return;
    }

    try {
      const response = await fetch('/manifest.webmanifest');

      if (!response.ok) {
        throw new Error(`Failed to fetch manifest.webmanifest: ${response.statusText}`);
      }

      const manifestData: WebManifest = await response.json();

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
