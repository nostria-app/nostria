import { computed, effect, inject, Injectable, signal } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";

@Injectable({
    providedIn: 'root'
})
export class ApplicationService {
    nostrService = inject(NostrService);
    storage = inject(StorageService);
    router = inject(Router);

    /** Check the status on fully initialized, which ensures Nostr, Storage and user is logged in. */
    initialized = computed(() => this.nostrService.initialized() && this.storage.initialized());
    authenticated = computed(() => this.nostrService.isLoggedIn());

    loadingMessage = signal('Loading data...');
    showSuccess = signal(false);
    isLoading = signal(false);
    isOnline = signal(navigator.onLine);

    constructor() {
        // Set up event listeners for online/offline status changes
        this.setupConnectionListeners();
    }

    private setupConnectionListeners(): void {
        window.addEventListener('online', () => this.isOnline.set(true));
        window.addEventListener('offline', () => this.isOnline.set(false));

        // Create an effect to log status changes (optional)
        effect(() => {
            console.log(`Connection status changed: ${this.isOnline() ? 'online' : 'offline'}`);
        });
    }

    async wipe() {
        this.nostrService.reset();

        // Clear known localStorage keys related to the app
        const keysToRemove = [
            'nostria-theme',
            'nostria-accounts',
            'nostria-account',
            'nostria-log-level',
        ];

        for (let i = 0; i < keysToRemove.length; i++) {
            localStorage.removeItem(keysToRemove[i]);
        }

        await this.storage.wipe(); // Assuming this method clears all app data

        // Navigate to home page before reloading
        await this.router.navigate(['/']);

        // Reload the application
        window.location.reload();
    }
}