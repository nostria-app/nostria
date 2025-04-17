import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
    selector: 'app-user-profile',
    standalone: true,
    imports: [
        CommonModule,
        MatIconModule,
        MatListModule,
        MatProgressSpinnerModule
    ],
    templateUrl: './user-profile.component.html',
    styleUrl: './user-profile.component.scss'
})
export class UserProfileComponent {
    private route = inject(ActivatedRoute);
    private nostrService = inject(NostrService);
    private logger = inject(LoggerService);
    layout = inject(LayoutService);
    pubkey = input<string>('');
    npub = signal<string | undefined>(undefined);
    // Create a signal to store profile data
    profile = signal<any>(null);
    isLoading = signal(false);
    error = signal<string>('');

    constructor() {
        // Set up an effect to watch for changes to npub input
        effect(() => {
            const pubkey = this.pubkey();

            if (pubkey) {
                const npub = this.nostrService.getNpubFromPubkey(pubkey);
                this.npub.set(npub);

                if (pubkey) {
                    untracked(() => {
                        this.loadProfileData(pubkey);
                    });
                }
            }
        });
    }

    private async loadProfileData(npubValue: string): Promise<void> {
        try {
            this.isLoading.set(true);
            this.logger.debug('Loading profile data for:', npubValue);

            const data = await this.nostrService.getMetadataForUser(npubValue);
            this.profile.set(data);
        } catch (error) {
            this.logger.error('Failed to load profile data:', error);
            this.error.set('Failed to load profile data:' + error);
            this.profile.set(null);
        } finally {
            this.isLoading.set(false);
        }
    }
}
