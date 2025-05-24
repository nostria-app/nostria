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
        return this.nostr.pubkey() === this.profile()?.event.pubkey;
    });

    constructor() {
        effect(() => {
            if (this.profile()) {
                console.debug('LOCATION 4:');
                this.npub.set(this.nostr.getNpubFromPubkey(this.profile()!.event.pubkey));
            }
        });
    }

    unfollowUser(): void {
        this.logger.debug('Unfollow requested for:', this.pubkey());
        // TODO: Implement actual unfollow functionality
    }

    muteUser(): void {
        this.logger.debug('Mute requested for:', this.pubkey());
        // TODO: Implement actual mute functionality
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

    getVerifiedIdentifier(): string | null {
        // TODO: Perform actual fetch requests to validate the NIP5.
        const metadata = this.profile();
        if (!metadata || !metadata.data.nip05) return null;

        // Format NIP-05 identifier for display
        return metadata.data.nip05.startsWith('_@')
            ? metadata.data.nip05.substring(1)
            : metadata.data.nip05;
    }
}