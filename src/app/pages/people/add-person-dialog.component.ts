import { Component, inject, signal } from '@angular/core';

import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { nip05, nip19 } from 'nostr-tools';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { AccountStateService } from '../../services/account-state.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

type DialogState = 'input' | 'loading' | 'preview' | 'error' | 'success';

@Component({
  selector: 'app-add-person-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    FormsModule,
    UserProfileComponent
],
  template: `
    <div class="add-person-dialog">
      <h2 mat-dialog-title>
        <mat-icon>person_add</mat-icon>
        Add Person to Follow
      </h2>

      <mat-dialog-content>
        @switch (state()) {
          @case ('input') {
            <div class="input-section">
              <p class="description">
                Enter a public key (npub or hex format) or a NIP-05 identifier to discover and follow
                someone new.
              </p>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Public Key or NIP-05</mat-label>
                <input
                  matInput
                  [(ngModel)]="inputValue"
                  placeholder="npub1..., hex, or name@domain.com"
                  (keyup.enter)="onSearch()"
                />
                @if (inputValue()) {
                  <button matSuffix mat-icon-button (click)="inputValue.set('')">
                    <mat-icon>close</mat-icon>
                  </button>
                }
              </mat-form-field>
              @if (errorMessage()) {
                <div class="error-message">
                  <mat-icon color="warn">error</mat-icon>
                  <span>{{ errorMessage() }}</span>
                </div>
              }
            </div>
          }
          @case ('loading') {
            <div class="loading-section">
              <mat-spinner diameter="40"></mat-spinner>
              <p>Discovering user information...</p>
            </div>
          }
          @case ('preview') {
            <div class="preview-section">
              @if (discoveredPubkey()) {
                <app-user-profile
                  [pubkey]="discoveredPubkey()!"
                  [view]="'details'"
                  [hostWidthAuto]="false"
                ></app-user-profile>
                @if (alreadyFollowing()) {
                  <div class="already-following-notice">
                    <mat-icon>check_circle</mat-icon>
                    <span>You are already following this person</span>
                  </div>
                }
              }
            </div>
          }
          @case ('success') {
            <div class="success-section">
              <mat-icon color="primary">check_circle</mat-icon>
              <p>Successfully followed!</p>
            </div>
          }
          @case ('error') {
            <div class="error-section">
              <mat-icon color="warn">error</mat-icon>
              <p>{{ errorMessage() }}</p>
            </div>
          }
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        @switch (state()) {
          @case ('input') {
            <button mat-button (click)="onCancel()">Cancel</button>
            <button mat-flat-button color="primary" (click)="onSearch()" [disabled]="!inputValue()">
              Search
            </button>
          }
          @case ('preview') {
            <button mat-button (click)="onBack()">Back</button>
            <button
              mat-flat-button
              color="primary"
              (click)="onFollow()"
              [disabled]="alreadyFollowing()"
            >
              {{ alreadyFollowing() ? 'Already Following' : 'Follow' }}
            </button>
          }
          @case ('success') {
            <button mat-flat-button color="primary" (click)="onClose()">Done</button>
          }
          @case ('error') {
            <button mat-button (click)="onBack()">Back</button>
            <button mat-flat-button color="primary" (click)="onClose()">Close</button>
          }
        }
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .add-person-dialog {
        min-width: 400px;
        max-width: 600px;

        h2 {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0;
        }
      }

      mat-dialog-content {
        min-height: 200px;
        padding: 20px 24px;
      }

      .input-section {
        .description {
          margin-bottom: 20px;
          color: var(--mat-sys-on-surface-variant);
        }

        .full-width {
          width: 100%;
        }

        .error-message {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--mat-sys-error);
          margin-top: 8px;

          mat-icon {
            font-size: 20px;
            width: 20px;
            height: 20px;
          }
        }
      }

      .loading-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        gap: 20px;

        p {
          color: var(--mat-sys-on-surface-variant);
        }
      }

      .preview-section {
        app-user-profile {
          width: 100%;
        }

        .already-following-notice {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          margin-top: 16px;
          background-color: var(--mat-sys-primary-container);
          border-radius: 8px;
          color: var(--mat-sys-on-primary-container);

          mat-icon {
            font-size: 20px;
            width: 20px;
            height: 20px;
          }
        }
      }

      .success-section,
      .error-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        gap: 16px;

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
        }

        p {
          font-size: 16px;
          text-align: center;
        }
      }

      mat-dialog-actions {
        padding: 16px 24px;
        gap: 8px;
      }
    `,
  ],
})
export class AddPersonDialogComponent {
  private dialogRef = inject(MatDialogRef<AddPersonDialogComponent>);
  private discoveryRelay = inject(DiscoveryRelayService);
  private nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);

  state = signal<DialogState>('input');
  inputValue = signal<string>('');
  errorMessage = signal<string>('');
  discoveredPubkey = signal<string | null>(null);
  alreadyFollowing = signal<boolean>(false);

  onCancel(): void {
    this.dialogRef.close();
  }

  onClose(): void {
    this.dialogRef.close(this.state() === 'success' ? this.discoveredPubkey() : null);
  }

  onBack(): void {
    this.state.set('input');
    this.errorMessage.set('');
  }

  async onSearch(): Promise<void> {
    const input = this.inputValue().trim();

    if (!input) {
      this.errorMessage.set('Please enter a public key or NIP-05 identifier');
      return;
    }

    this.state.set('loading');
    this.errorMessage.set('');

    try {
      // Parse the input - could be npub, hex, nprofile, or NIP-05
      let pubkey: string;

      if (input.includes('@')) {
        // Handle NIP-05 identifier
        try {
          this.logger.info('Resolving NIP-05 identifier:', input);
          const profile = await nip05.queryProfile(input);

          if (!profile || !profile.pubkey) {
            this.logger.error('NIP-05 identifier not found');
            this.errorMessage.set('NIP-05 identifier not found or invalid');
            this.state.set('input');
            return;
          }

          pubkey = profile.pubkey;
          this.logger.info('Resolved NIP-05 to pubkey:', pubkey);
        } catch (err) {
          this.logger.error('Failed to resolve NIP-05', err);
          this.errorMessage.set('Failed to resolve NIP-05 identifier. Please check the address.');
          this.state.set('input');
          return;
        }
      } else if (input.startsWith('npub')) {
        // Decode npub to hex
        try {
          const decoded = nip19.decode(input);
          if (decoded.type !== 'npub') {
            throw new Error('Invalid npub format');
          }
          pubkey = decoded.data as string;
        } catch (err) {
          this.logger.error('Failed to decode npub', err);
          this.errorMessage.set('Invalid npub format');
          this.state.set('input');
          return;
        }
      } else if (input.startsWith('nprofile')) {
        // Decode nprofile to get pubkey
        try {
          const decoded = nip19.decode(input);
          if (decoded.type !== 'nprofile') {
            throw new Error('Invalid nprofile format');
          }
          pubkey = (decoded.data as { pubkey: string }).pubkey;
        } catch (err) {
          this.logger.error('Failed to decode nprofile', err);
          this.errorMessage.set('Invalid nprofile format');
          this.state.set('input');
          return;
        }
      } else {
        // Assume it's a hex pubkey, validate it
        if (!/^[0-9a-f]{64}$/i.test(input)) {
          this.errorMessage.set(
            'Invalid format. Use npub, 64-character hex, or NIP-05 (name@domain.com).'
          );
          this.state.set('input');
          return;
        }
        pubkey = input.toLowerCase();
      }

      this.logger.info('Searching for user:', pubkey);

      // Check if already following
      const isFollowing = this.accountState.isFollowing();
      this.alreadyFollowing.set(isFollowing(pubkey));

      // Query discovery relay for user's relays
      const relayUrls = await this.discoveryRelay.getUserRelayUrls(pubkey);
      this.logger.info('Found relay URLs:', relayUrls);

      // Try to get metadata from discovery relay or user's relays
      let metadata = await this.nostr.getMetadataForUser(pubkey, true);

      if (!metadata) {
        // If not in cache/storage, try to discover it
        this.logger.info('Metadata not found, attempting discovery');
        const metadataEvent = await this.nostr.discoverMetadata(pubkey, true);

        if (metadataEvent) {
          // Refresh metadata after discovery
          metadata = await this.nostr.getMetadataForUser(pubkey, true);
        }
      }

      if (!metadata) {
        this.logger.warn('No metadata found for user');
        // Still allow following even without metadata
      }

      this.discoveredPubkey.set(pubkey);
      this.state.set('preview');
    } catch (err) {
      this.logger.error('Error discovering user', err);
      this.errorMessage.set('Failed to discover user. Please try again.');
      this.state.set('error');
    }
  }

  async onFollow(): Promise<void> {
    const pubkey = this.discoveredPubkey();

    if (!pubkey) {
      return;
    }

    if (this.alreadyFollowing()) {
      return;
    }

    try {
      this.state.set('loading');
      await this.accountState.follow(pubkey);
      this.state.set('success');

      // Auto-close after a short delay
      setTimeout(() => {
        this.onClose();
      }, 1500);
    } catch (err) {
      this.logger.error('Error following user', err);
      this.errorMessage.set('Failed to follow user. Please try again.');
      this.state.set('error');
    }
  }
}
