import { Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Clipboard } from '@angular/cdk/clipboard';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-cashu-token',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './cashu-token.component.html',
  styleUrl: './cashu-token.component.scss',
})
export class CashuTokenComponent {
  token = input.required<string>();
  mint = input<string>();
  amount = input<number>();
  unit = input<string>('sat');

  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);

  getMintDomain(): string {
    const mintUrl = this.mint();
    if (!mintUrl) return 'Unknown mint';

    try {
      const url = new URL(mintUrl);
      return url.hostname;
    } catch {
      return 'Unknown mint';
    }
  }

  copyToken(): void {
    const success = this.clipboard.copy(this.token());

    if (success) {
      this.snackBar.open('Cashu token copied to clipboard!', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    }
  }

  openInWallet(): void {
    // Try to open with cashu: protocol handler
    const cashuUrl = `cashu:${this.token()}`;
    window.open(cashuUrl, '_blank');
  }
}
