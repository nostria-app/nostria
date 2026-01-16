import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { nip19 } from 'nostr-tools';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { AccountStateService } from '../../services/account-state.service';
import { NostrRecord } from '../../interfaces';

@Component({
  selector: 'app-invite',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './invite.component.html',
  styleUrl: './invite.component.scss',
})
export class InviteComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private logger = inject(LoggerService);
  private layout = inject(LayoutService);
  private data = inject(DataService);
  private accountState = inject(AccountStateService);

  loading = signal(true);
  error = signal<string | null>(null);
  inviterPubkey = signal<string | null>(null);
  inviterProfile = signal<NostrRecord | null>(null);
  inviterRelays = signal<string[]>([]);

  inviterName = computed(() => {
    const profile = this.inviterProfile();
    if (!profile) return 'Someone';
    return profile.data?.display_name || profile.data?.name || 'A Nostr user';
  });

  inviterAvatar = computed(() => {
    const profile = this.inviterProfile();
    return profile?.data?.picture || null;
  });

  hasAccount = computed(() => {
    return !!this.accountState.pubkey();
  });

  async ngOnInit() {
    this.logger.debug('[InviteComponent] Initializing invite page');

    const nprofileParam = this.route.snapshot.paramMap.get('nprofile');

    if (!nprofileParam) {
      this.error.set('Invalid invite link - missing inviter information');
      this.loading.set(false);
      return;
    }

    try {
      // Decode the nprofile to get pubkey and relays
      const decoded = nip19.decode(nprofileParam);

      if (decoded.type !== 'nprofile') {
        throw new Error('Invalid invite link format');
      }

      const profileData = decoded.data as { pubkey: string; relays?: string[] };
      this.inviterPubkey.set(profileData.pubkey);

      if (profileData.relays && profileData.relays.length > 0) {
        this.inviterRelays.set(profileData.relays);
      }

      this.logger.debug('[InviteComponent] Decoded inviter', {
        pubkey: profileData.pubkey,
        relays: profileData.relays,
      });

      // Load the inviter's profile
      await this.loadInviterProfile(profileData.pubkey);
    } catch (err) {
      this.logger.error('[InviteComponent] Failed to decode invite link', err);
      this.error.set('Invalid invite link format');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadInviterProfile(pubkey: string) {
    try {
      const profile = await this.data.getProfile(pubkey);
      if (profile) {
        this.inviterProfile.set(profile);
        this.logger.debug('[InviteComponent] Loaded inviter profile', profile);
      }
    } catch (err) {
      this.logger.error('[InviteComponent] Failed to load inviter profile', err);
    }
  }

  async acceptInvite() {
    this.logger.debug('[InviteComponent] Accepting invite');

    const inviterPubkey = this.inviterPubkey();
    if (!inviterPubkey) {
      return;
    }

    // Store the inviter pubkey in sessionStorage so we can follow them after login
    sessionStorage.setItem('nostria_invite_follow', inviterPubkey);

    // Open login dialog with new user flow and wait for it to close
    await this.layout.showLoginDialogWithStep('new-user');

    // Small delay to ensure account state is fully updated
    await new Promise(resolve => setTimeout(resolve, 500));

    const currentPubkey = this.accountState.pubkey();
    const storedInviterPubkey = sessionStorage.getItem('nostria_invite_follow');

    if (currentPubkey && storedInviterPubkey) {
      this.logger.debug('[InviteComponent] Auto-following inviter', {
        currentPubkey,
        inviterPubkey: storedInviterPubkey,
      });

      try {
        // Follow the inviter
        await this.accountState.follow(storedInviterPubkey);

        this.logger.debug('[InviteComponent] Successfully followed inviter');

        // Clear the stored inviter pubkey
        sessionStorage.removeItem('nostria_invite_follow');

        // Navigate to inviter's profile (opens in right panel)
        this.layout.openProfile(storedInviterPubkey);
      } catch (err) {
        this.logger.error('[InviteComponent] Failed to follow inviter', err);
        // Still navigate to inviter's profile even if follow fails
        this.layout.openProfile(storedInviterPubkey);
      }
    } else if (currentPubkey) {
      // User logged in but no stored inviter (shouldn't happen)
      this.router.navigate(['/']);
    }
    // If no currentPubkey, user didn't complete login, stay on invite page
  }

  loginWithExistingAccount() {
    this.logger.debug('[InviteComponent] User wants to login with existing account');
    this.layout.showLoginDialog();

    // After login, navigate to the inviter's profile
    setTimeout(() => {
      const currentPubkey = this.accountState.pubkey();
      if (currentPubkey) {
        const inviterPubkey = this.inviterPubkey();
        if (inviterPubkey) {
          this.layout.openProfile(inviterPubkey);
        } else {
          this.router.navigate(['/']);
        }
      }
    }, 1000);
  }

  skipInvite() {
    this.logger.debug('[InviteComponent] User skipped invite');
    this.router.navigate(['/']);
  }
}
