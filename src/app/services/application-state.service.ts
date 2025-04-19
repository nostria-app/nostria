import { computed, inject, Injectable, signal } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";

@Injectable({
    providedIn: 'root'
})
export class ApplicationStateService {
    router = inject(Router);
    loadingMessage = signal('Loading data...');
    showSuccess = signal(false);
    isLoading = signal(false);
}