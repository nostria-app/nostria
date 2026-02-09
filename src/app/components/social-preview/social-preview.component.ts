import { ChangeDetectionStrategy, Component, inject, Input, input, signal } from '@angular/core';
import { OpenGraphService } from '../../services/opengraph.service';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface SocialPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  loading: boolean;
  error: boolean;
}

@Component({
  selector: 'app-social-preview',
  imports: [MatCardModule, MatProgressSpinnerModule],
  templateUrl: './social-preview.component.html',
  styleUrl: './social-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialPreviewComponent {
  openGraphService = inject(OpenGraphService);

  /** When true, renders a smaller preview with thumbnail + title + URL only (no description). */
  compact = input<boolean>(false);

  // Input for raw url
  private _url = signal<string>('');
  preview = signal<SocialPreview>({ url: '', loading: false, error: false });

  @Input() set url(value: string) {
    this._url.set(value || '');
    this.loadSocialPreview(value);
  }

  get url() {
    return this._url();
  }

  async loadSocialPreview(url: string): Promise<void> {
    if (!url) {
      this.preview.set({ url: '', loading: false, error: false });
      return;
    }

    this.preview.update(prev => ({
      ...prev,
      url,
      loading: true,
      error: false,
    }));

    try {
      const data = await this.openGraphService.getOpenGraphData(url);
      this.preview.update(prev => ({
        ...prev,
        loading: false,
        title: data.title || '',
        description: data.description || '',
        image: data.image || '',
      }));
    } catch (error) {
      this.preview.update(prev => ({ ...prev, loading: false, error: true }));
      console.error('Failed to load preview:', error);
    }
  }
}
