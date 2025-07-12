import { computed, effect, inject, Injectable, PLATFORM_ID, signal, untracked } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";
import { FeatureLevel, LoggerService } from "./logger.service";
import { ApplicationStateService } from "./application-state.service";
import { ThemeService } from "./theme.service";
import { NotificationService } from "./notification.service";
import { LocalStorageService } from "./local-storage.service";
import { isPlatformBrowser } from "@angular/common";
import { AccountStateService } from "./account-state.service";
import { DataService } from "./data.service";
import { BadgeService } from "./badge.service";

@Injectable({
    providedIn: 'root'
})
export class ApplicationService {
    nostrService = inject(NostrService);
    storage = inject(StorageService);
    router = inject(Router);
    logger = inject(LoggerService);
    appState = inject(ApplicationStateService);
    accountState = inject(AccountStateService);
    badgeService = inject(BadgeService);
    theme = inject(ThemeService);
    notificationService = inject(NotificationService);
    dataService = inject(DataService);
    private readonly localStorage = inject(LocalStorageService);
    private readonly platformId = inject(PLATFORM_ID);
    readonly isBrowser = signal(isPlatformBrowser(this.platformId));

    /** Check the status on fully initialized, which ensures Nostr, Storage and user is logged in. */
    initialized = computed(() => this.nostrService.initialized() && this.storage.initialized());

    /** User is "authenticated" if there is any account set. */
    authenticated = computed(() => this.accountState.account() != null);

    /** Used to check if both initialized and authenticated. Used to wait for both conditions. */
    // initializedAndAuthenticated = computed(() => this.initialized() && this.authenticated());

    featureLevel = signal<FeatureLevel>(this.getStoredFeatureLevel());

    private readonly featurePrecedence: Record<FeatureLevel, number> = {
        'stable': 0,
        'beta': 1,
        'preview': 2,
    };

    previousPubKey = '';

    constructor() {
        // Set up effect to load notifications when app is initialized and authenticated
        // effect(async () => {
        //     // For reasons unable to figure out,
        //     // this is triggered twice on app start.
        //     let pubkey = this.accountState.pubkey();

        //     if (pubkey && pubkey !== this.previousPubKey) {
        //         this.previousPubKey = pubkey;
        //         await this.loadAppData();
        //     }
        // });

        effect(async () => {
            const followingList = this.accountState.followingList();
            // const initialize = this.appState.

            // Auto-trigger profile processing when following list changes, but only once per account
            const pubkey = this.accountState.pubkey();

            // For reasons unable to figure out,
            // this is triggered twice on app start.
            if (pubkey && followingList.length > 0) {
                untracked(async () => {
                    try {
                        // Check if profile discovery has already been done for this account
                        if (!this.accountState.hasProfileDiscoveryBeenDone(pubkey)) {
                            await this.accountState.startProfileProcessing(followingList, this.nostrService);
                            this.accountState.markProfileDiscoveryDone(pubkey);
                        } else {
                            const currentState = this.accountState.profileProcessingState();
                            if (!currentState.isProcessing) {
                                // Profile discovery has been done, load profiles from storage into cache
                                await this.accountState.loadProfilesFromStorageToCache(pubkey, this.dataService, this.storage);
                            }
                        }
                    } catch (error) {
                        this.logger.error('Error during profile processing:', error);
                    }
                });
            }
        });
    }

    private getStoredFeatureLevel(): FeatureLevel {
        if (!this.isBrowser()) return 'stable';

        const storedLevel = localStorage.getItem(this.appState.FEATURE_LEVEL) as FeatureLevel | null;
        return storedLevel || 'stable';
    }

    enabledFeature(level?: FeatureLevel): boolean {
        if (!level) {
            return true;
        }

        return this.featurePrecedence[level] <= this.featurePrecedence[this.featureLevel()];
    }

    reload() {
        const window = this.appState.getWindow();

        if (window) {
            // Reload the application
            window.location.reload();
        }
    }

    async wipe() {
        this.nostrService.clear();

        // Clear known localStorage keys related to the app
        const keysToRemove = [
            this.appState.ACCOUNT_STORAGE_KEY,
            this.appState.ACCOUNTS_STORAGE_KEY,
            this.appState.DISCOVERY_RELAYS_STORAGE_KEY,
            this.appState.PEOPLE_VIEW_MODE,
            this.appState.MEDIA_ACTIVE_TAB,
            this.appState.FEATURE_LEVEL,
            this.appState.WELCOME,
            this.logger.LOG_LEVEL_KEY,
            this.logger.LOG_OVERLAY_KEY,
            this.theme.THEME_KEY,
            this.appState.FEEDS_STORAGE_KEY,
            this.appState.RELAYS_STORAGE_KEY,
            this.appState.PROCESSING_STORAGE_KEY,
            this.appState.SETTINGS_KEY,
            this.appState.WALLETS_KEY,
        ];

        for (let i = 0; i < keysToRemove.length; i++) {
            this.localStorage.removeItem(keysToRemove[i]);
        }

        // Clear notifications from memory
        this.notificationService.clearNotifications();

        await this.storage.wipe(); // Assuming this method clears all app data

        // Navigate to home page before reloading
        await this.router.navigate(['/']);

        const window = this.appState.getWindow();

        if (window) {
            // Reload the application
            window.location.reload();
        }
    }
}