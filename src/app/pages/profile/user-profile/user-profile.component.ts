import { Component, effect, inject, input, output, signal, untracked, ElementRef, OnDestroy, AfterViewInit } from '@angular/core';
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
export class UserProfileComponent implements AfterViewInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private nostrService = inject(NostrService);
    private logger = inject(LoggerService);
    private elementRef = inject(ElementRef);
    layout = inject(LayoutService);
    pubkey = input<string>('');
    npub = signal<string | undefined>(undefined);
    // Create a signal to store profile data
    profile = signal<any>(null);
    isLoading = signal(false);
    error = signal<string>('');
    
    // Flag to track if component is visible
    private isVisible = signal(false);
    private intersectionObserver?: IntersectionObserver;
    
    constructor() {
        // Set up an effect to watch for changes to npub input
        effect(() => {
            const pubkey = this.pubkey();

            if (pubkey) {
                const npub = this.nostrService.getNpubFromPubkey(pubkey);
                this.npub.set(npub);

                // Only load profile data when the component is visible
                if (this.isVisible()) {
                    untracked(() => {
                        this.loadProfileData(pubkey);
                    });
                }
            }
        });
        
        // Additional effect to watch for visibility changes
        effect(() => {
            if (this.isVisible() && this.pubkey() && !this.profile()) {
                untracked(() => {
                    this.loadProfileData(this.pubkey());
                });
            }
        });
    }
    
    ngAfterViewInit(): void {
        // Set up intersection observer to detect when component is visible
        this.setupIntersectionObserver();
    }
    
    ngOnDestroy(): void {
        // Clean up the observer when component is destroyed
        this.disconnectObserver();
    }
    
    private setupIntersectionObserver(): void {
        this.disconnectObserver(); // Ensure any existing observer is disconnected
        
        // Create IntersectionObserver instance
        this.intersectionObserver = new IntersectionObserver((entries) => {
            // Update visibility state
            const isVisible = entries.some(entry => entry.isIntersecting);
            this.isVisible.set(isVisible);
            
            if (isVisible) {
                this.logger.debug(`User profile ${this.pubkey()} is now visible`);
            }
        }, {
            // Options for the observer
            threshold: 0.1, // Trigger when at least 10% is visible
            root: null     // Use viewport as root
        });
        
        // Start observing this component
        this.intersectionObserver.observe(this.elementRef.nativeElement);
    }
    
    private disconnectObserver(): void {
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = undefined;
        }
    }

    private async loadProfileData(npubValue: string): Promise<void> {
        // Don't reload if we're already loading or have data
        if (this.isLoading()) return;
        
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
