import { Component, effect, inject, input, output, signal, untracked, ElementRef, OnDestroy, AfterViewInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { ProfileStateService } from '../../../services/profile-state.service';
import { NostrRecord } from '../../../interfaces';
import { isNip05, queryProfile } from 'nostr-tools/nip05';
import { AccountStateService } from '../../../services/account-state.service';
import { UtilitiesService } from '../../../services/utilities.service';

@Component({
    selector: 'app-profile-header',
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatListModule,
        MatProgressSpinnerModule,
        MatMenuModule,
        RouterModule,
        MatButtonModule
    ],
    templateUrl: './profile-header.component.html',
    styleUrl: './profile-header.component.scss'
})
export class ProfileHeaderComponent {
    profile = input<NostrRecord | undefined>(undefined);
    layout = inject(LayoutService);
    nostr = inject(NostrService);
    npub = signal<string | undefined>(undefined);
    logger = inject(LoggerService);
    compact = input<boolean>(false);
    profileState = inject(ProfileStateService);
    accountState = inject(AccountStateService);
    utilities = inject(UtilitiesService);

    // Add signal for verified identifier
    verifiedIdentifier = signal<{ value: string, valid: boolean, status: string }>({ value: '', valid: false, status: '' });

    pubkey = computed(() => {
        return this.profile() ? this.profile()!.event.pubkey : undefined;
    });

    name = computed(() => {
        if (this.profile()!.data.display_name) {
            return this.profile()!.data.display_name;
        }
        else if (this.profile()!.data.name) {
            return this.profile()!.data.name;
        }
        else {
            return this.profile()!.event.pubkey;
        }
    });

    isOwnProfile = computed(() => {
        return this.accountState.pubkey() === this.profile()?.event.pubkey;
    });

    constructor() {
        effect(() => {
            if (this.profile()) {
                console.debug('LOCATION 4:');
                this.npub.set(this.utilities.getNpubFromPubkey(this.profile()!.event.pubkey));
            }
        });

        // Add effect to verify identifier when profile changes
        effect(async () => {
            const currentProfile = this.profile();
            if (currentProfile?.data.nip05) {
                const result = await this.getVerifiedIdentifier();
                untracked(() => {
                    this.verifiedIdentifier.set(result);
                });
            } else {
                untracked(() => {
                    this.verifiedIdentifier.set({ value: '', valid: false, status: 'No NIP-05 value' });
                });
            }
        });
    }

    unfollowUser(): void {
        this.logger.debug('Unfollow requested for:', this.pubkey());
        // TODO: Implement actual unfollow functionality
    }

    muteUser(): void {
        this.accountState.mutePubkey(this.pubkey()!);
    }

    blockUser(): void {
        this.logger.debug('Block requested for:', this.pubkey());
        // TODO: Implement actual block functionality
    }

    followUser(): void {
        this.logger.debug('Follow requested for:', this.pubkey());
        // TODO: Implement actual follow functionality
    }

    copyProfileData(): void {
        this.layout.copyToClipboard(this.profile()?.event.content, 'profile data');
    }

    copyFollowingList(): void {
        // Placeholder for actual implementation that would fetch the following list
        this.logger.debug('Copy following list requested for:', this.pubkey());
        this.layout.copyToClipboard('Following list not implemented yet', 'following list');
    }

    copyRelayList(): void {
        // Placeholder for actual implementation that would fetch the relay list
        this.logger.debug('Copy relay list requested for:', this.pubkey());
        this.layout.copyToClipboard('Relay list not implemented yet', 'relay list');
    }

    getDefaultBanner(): string {
        // Return a default gradient for users without a banner
        return 'linear-gradient(135deg, #8e44ad, #3498db)';
    }

    private async getVerifiedIdentifier(): Promise<{ value: string, valid: boolean, status: string }> {
        const metadata = this.profile();
        if (!metadata || !metadata.data.nip05) return { value: '', valid: false, status: 'No NIP-05 value' };

        const value = this.utilities.parseNip05(metadata.data.nip05);

        if (isNip05(metadata.data.nip05)) {
            const profile = await queryProfile(metadata.data.nip05);

            if (profile) {
                if (profile.pubkey === metadata.event.pubkey) {
                    return { value, valid: true, status: 'Verified valid' };
                } else {
                    this.logger.warn('NIP-05 profile pubkey mismatch:', profile.pubkey, metadata.event.pubkey);
                }
            }
        }

        return { value, valid: false, status: 'Invalid NIP-05' };
    }
}