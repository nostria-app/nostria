import { Component, effect, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';

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
  version = signal('Loading...');
  
  constructor() {
    effect(() => {
      this.fetchManifestVersion();
    });
  }

  private async fetchManifestVersion(): Promise<void> {
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
