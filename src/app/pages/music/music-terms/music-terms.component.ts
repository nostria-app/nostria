import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MusicTermsContentComponent } from '../music-terms-content/music-terms-content.component';

@Component({
  selector: 'app-music-terms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MusicTermsContentComponent],
  template: `
    <div class="terms-container">
      <div class="terms-wrapper">
        <app-music-terms-content />
      </div>
    </div>
  `,
  styles: [`
    .terms-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 1rem;
      padding-bottom: 120px;
    }

    .terms-wrapper {
      background: var(--mat-sys-surface-container);
      border-radius: var(--mat-sys-corner-large);
      padding: 2rem;

      @media (max-width: 600px) {
        padding: 1.5rem;
      }
    }
  `],
})
export class MusicTermsComponent {
  private router = inject(Router);

  goBack(): void {
    this.router.navigate(['/music']);
  }
}
