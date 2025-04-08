
import { inject, Injectable, signal } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";

@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    search = signal(false);
    router = inject(Router);

    toggleSearch() {
        this.search.set(!this.search());
    }

    searchInput: string = '';

    private debounceTimer: any;

    onSearchInput(event: any) {
        if (event.target.value === null) {
            clearTimeout(this.debounceTimer);
            return;
        }

        // Debounce logic to wait until user finishes typing
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            console.log('Handle search called!');
            this.handleSearch(event.target.value);
        }, 750);
    }

    private handleSearch(value: string): void {
        if (!value) {
            return;
        }

        if (value.startsWith('npub')) {
            this.toggleSearch();
            this.searchInput = '';
            this.router.navigate(['/p', value]);
        }
        else if (value.includes(':')) {
            this.router.navigate(['/p', value]);
        } else {
            this.router.navigate(['/search'], { queryParams: { query: value } });
        }
    }
}

