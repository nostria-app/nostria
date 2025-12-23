import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TermsOfUseDialogContentComponent } from '../../components/terms-of-use-dialog/terms-of-use-dialog.component';

@Component({
  selector: 'app-terms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, TermsOfUseDialogContentComponent],
  template: `
    <div class="terms-container">
      <button mat-icon-button class="back-button" (click)="goBack()" aria-label="Go back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      
      <div class="terms-wrapper">
        <app-terms-of-use-dialog-content />
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

    .back-button {
      margin-bottom: 1rem;
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
export class TermsComponent {
  private router = inject(Router);

  goBack(): void {
    this.router.navigate(['/']);
  }
}
