import { inject, Injectable, signal } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";
import { LoggerService } from "./logger.service";

@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    search = signal(false);
    router = inject(Router);
    private logger = inject(LoggerService);

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

    /**
     * Scrolls the page to show half of the banner and the full profile picture
     */
    scrollToOptimalPosition(): void {
        // We need the banner height to calculate the optimal scroll position
        const bannerHeight = this.getBannerHeight();

        // Calculate scroll position that shows half of the banner
        // We divide banner height by 2 to show half of it
        const scrollPosition = bannerHeight / 2;

        // Find the content wrapper element
        const contentWrapper = document.querySelector('.content-wrapper');
        if (contentWrapper) {
            // Scroll the content wrapper to the calculated position with smooth animation
            contentWrapper.scrollTo({
                top: scrollPosition,
                behavior: 'smooth'
            });

            this.logger.debug('Scrolled content wrapper to optimal profile view position', scrollPosition);
        } else {
            this.logger.error('Could not find content-wrapper element for scrolling');
        }
    }

    /**
     * Returns the banner height based on the current viewport width
     */
    getBannerHeight(): number {
        // Default height of the banner is 300px (as defined in CSS)
        let bannerHeight = 300;

        // Check viewport width and return appropriate banner height
        // matching the responsive CSS values
        if (window.innerWidth <= 480) {
            bannerHeight = 150;
        } else if (window.innerWidth <= 768) {
            bannerHeight = 200;
        }

        return bannerHeight;
    }

    /**
     * Scrolls an element to the top of the page with smooth animation
     * @param elementSelector CSS selector for the element to scroll
     */
    scrollToTop(elementSelector: string = '.content-wrapper'): void {
        const element = document.querySelector(elementSelector);
        if (element) {
            element.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            this.logger.debug(`Scrolled ${elementSelector} to top`);
        } else {
            this.logger.error(`Could not find ${elementSelector} element for scrolling`);
        }
    }

    /**
     * Scrolls an element into view
     * @param elementSelector CSS selector for the element to scroll into view
     * @param block Position of the element relative to the viewport after scrolling
     * @param behavior Scrolling behavior
     */
    scrollToElement(elementSelector: string, block: ScrollLogicalPosition = 'start', behavior: ScrollBehavior = 'smooth'): void {
        const element = document.querySelector(elementSelector);
        if (element) {
            element.scrollIntoView({
                behavior: behavior,
                block: block
            });
            this.logger.debug(`Scrolled ${elementSelector} into view`);
        } else {
            this.logger.error(`Could not find ${elementSelector} element for scrolling into view`);
            
            // Fallback: try scrolling the parent container
            const contentWrapper = document.querySelector('.content-wrapper');
            if (contentWrapper) {
                contentWrapper.scrollTo({
                    top: 0,
                    behavior: behavior
                });
                this.logger.debug('Fallback: scrolled content-wrapper to top');
            }
        }
    }

    /**
     * Scrolls to a specific position within a container
     * @param containerSelector CSS selector for the container element
     * @param position Position to scroll to (in pixels)
     * @param behavior Scrolling behavior
     */
    scrollToPosition(containerSelector: string = '.content-wrapper', position: number = 0, behavior: ScrollBehavior = 'smooth'): void {
        const container = document.querySelector(containerSelector);
        if (container) {
            container.scrollTo({
                top: position,
                behavior: behavior
            });
            this.logger.debug(`Scrolled ${containerSelector} to position ${position}`);
        } else {
            this.logger.error(`Could not find ${containerSelector} element for scrolling to position`);
        }
    }
}

