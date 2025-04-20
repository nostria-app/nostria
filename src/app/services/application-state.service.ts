import { inject, Injectable, signal } from "@angular/core";
import { Router } from "@angular/router";

@Injectable({
    providedIn: 'root'
})
export class ApplicationStateService {
    router = inject(Router);
    loadingMessage = signal('Loading data...');
    showSuccess = signal(false);
    isLoading = signal(false);
}