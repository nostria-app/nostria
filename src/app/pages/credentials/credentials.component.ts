import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NostrService } from '../../services/nostr.service';

@Component({
  selector: 'app-credentials',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule
  ],
  templateUrl: './credentials.component.html',
  styleUrl: './credentials.component.scss'
})
export class CredentialsComponent {
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  
  isNsecVisible = signal(false);
  
  toggleNsecVisibility(): void {
    this.isNsecVisible.update(current => !current);
  }
  
  async copyToClipboard(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.snackBar.open(`${label} copied to clipboard`, 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.snackBar.open('Failed to copy to clipboard', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom'
      });
    }
  }
    getMaskedNsec(nsec: string): string {
    if (!nsec) return '';
    // Show only first 4 characters, mask the rest
    const prefix = nsec.substring(0, 4);
    return `${prefix}${'•'.repeat(Math.min(20, nsec.length - 4))}`;
  }

  getNpub(): string {
    const pubkey = this.nostrService.pubkey();
    if (!pubkey) return '';

    console.debug('LOCATION 2:', pubkey);
    return this.nostrService.getNpubFromPubkey(pubkey);
  }

  getNsec(): string {
    const privkey = this.nostrService.account()?.privkey;
    if (!privkey) return '';
    return this.nostrService.getNsecFromPrivkey(privkey);
  }

  isRemoteAccount(): boolean {
    return this.nostrService.account()?.source === 'remote';
  }
}
