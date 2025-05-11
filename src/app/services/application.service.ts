import { computed, effect, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";
import { LoggerService } from "./logger.service";
import { ApplicationStateService } from "./application-state.service";
import { ThemeService } from "./theme.service";
import { NotificationService } from "./notification.service";
import { LocalStorageService } from "./local-storage.service";
import { isPlatformBrowser } from "@angular/common";

@Injectable({
    providedIn: 'root'
})
export class ApplicationService {
    nostrService = inject(NostrService);
    storage = inject(StorageService);
    router = inject(Router);
    logger = inject(LoggerService);
    appState = inject(ApplicationStateService);
    theme = inject(ThemeService);
    notificationService = inject(NotificationService);
    private readonly localStorage = inject(LocalStorageService);
    private readonly platformId = inject(PLATFORM_ID);
    readonly isBrowser = signal(isPlatformBrowser(this.platformId));

    /** Check the status on fully initialized, which ensures Nostr, Storage and user is logged in. */
    initialized = computed(() => this.nostrService.initialized() && this.storage.initialized());

    /** User is "authenticated" if there is any account set. */
    authenticated = computed(() => this.nostrService.account() != null);

    /** Used to check if both initialized and authenticated. Used to wait for both conditions. */
    // initializedAndAuthenticated = computed(() => this.initialized() && this.authenticated());

    loadingMessage = signal('Loading data...');
    showSuccess = signal(false);
    isLoading = signal(false);

    constructor() {
        // Set up effect to load notifications when app is initialized and authenticated
        effect(() => {
            if (this.authenticated()) {
                this.loadAppData();
            }
        });
    }

    reload() {
        const window = this.appState.getWindow();

        if (window) {
            // Reload the application
            window.location.reload();
        }
    }

    private async loadAppData(): Promise<void> {
        this.logger.info('Application initialized and authenticated, loading app data');

        // Load notifications from storage
        if (!this.notificationService.notificationsLoaded()) {
            await this.notificationService.loadNotifications();
        }

        // Add any other app data loading here in the future
    }

    async wipe() {
        this.nostrService.reset();

        // Clear known localStorage keys related to the app
        const keysToRemove = [
            this.appState.ACCOUNT_STORAGE_KEY,
            this.appState.ACCOUNTS_STORAGE_KEY,
            this.appState.DISCOVERY_RELAYS_STORAGE_KEY,
            this.appState.PEOPLE_VIEW_MODE,
            this.appState.MEDIA_ACTIVE_TAB,
            this.logger.LOG_LEVEL_KEY,
            this.theme.THEME_KEY
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