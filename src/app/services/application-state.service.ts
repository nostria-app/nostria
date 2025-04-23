import { computed, effect, inject, Injectable, signal } from "@angular/core";
import { Router } from "@angular/router";
import { LoggerService } from "./logger.service";

@Injectable({
    providedIn: 'root'
})
export class ApplicationStateService {
    router = inject(Router);
    logger = inject(LoggerService);
    loadingMessage = signal('Loading data...');
    showSuccess = signal(false);
    isLoading = signal(false);
    isOnline = signal(navigator.onLine);

    readonly BOOTSTRAP_RELAYS_STORAGE_KEY = 'nostria-bootstrap-relays';
    readonly ACCOUNT_STORAGE_KEY = 'nostria-account';
    readonly ACCOUNTS_STORAGE_KEY = 'nostria-accounts';
    readonly PEOPLE_VIEW_MODE = 'nostria-peple-view-mode';
    readonly MEDIA_ACTIVE_TAB = 'nostria-media-active-tab';

    showOfflineWarning = computed(() => !this.isOnline() && !this.offlineDismissed());
    // showOfflineWarning = signal(true);
    private offlineDismissed = signal(false);

    constructor() {
        this.setupConnectionListeners();
    }

    dismissOffline() {
        this.offlineDismissed.set(true);
    }

    private setupConnectionListeners(): void {
        window.addEventListener('online', () => {
            this.isOnline.set(true);
            this.offlineDismissed.set(false); // Reset dismiss state when coming back online
        });
        window.addEventListener('offline', () => this.isOnline.set(false));

        // Create an effect to log status changes (optional)
        effect(() => {
            if (this.isOnline()) {
                this.logger.info('Connection status: online');
            } else {
                this.logger.warn('Connection status: offline');
            }
        });
    }
}