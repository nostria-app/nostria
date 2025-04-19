import { inject, Injectable, signal } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";
import { LoggerService } from "./logger.service";
import { NostrEvent } from "../interfaces";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { BreakpointObserver } from "@angular/cdk/layout";
import { MediaPreviewDialogComponent } from "../components/media-preview-dialog/media-preview.component";

@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    search = signal(false);
    router = inject(Router);
    private logger = inject(LoggerService);
    private dialog = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    isHandset = signal(false);
    breakpointObserver = inject(BreakpointObserver);
    optimalProfilePosition: number = 200;
    premium = signal(false);

    constructor() {
        // Monitor only mobile devices (not tablets)
        this.breakpointObserver.observe('(max-width: 599px)').subscribe(result => {
            this.logger.debug('Breakpoint observer update', { isMobile: result.matches });
            this.isHandset.set(result.matches);

        });
    }

    toggleSearch() {
        const newSearchState = !this.search();
        this.search.set(newSearchState);

        if (newSearchState) {
            // Add ESC key listener when search is opened
            this.setupEscKeyListener();
        } else {
            // Remove ESC key listener when search is closed
            this.removeEscKeyListener();
            // Clear search input when closing
            this.searchInput = '';
        }
    }

    private escKeyListener: ((event: KeyboardEvent) => void) | null = null;

    private setupEscKeyListener(): void {
        // Remove any existing listener first to prevent duplicates
        this.removeEscKeyListener();

        // Create and store the listener function
        this.escKeyListener = (event: KeyboardEvent) => {
            if (event.key === 'Escape' || event.key === 'Esc') {
                this.logger.debug('ESC key pressed, canceling search');
                this.toggleSearch();
                // Prevent default behavior for the ESC key
                event.preventDefault();
            }
        };

        // Add the listener to document
        document.addEventListener('keydown', this.escKeyListener);
        this.logger.debug('ESC key listener added for search');
    }

    private removeEscKeyListener(): void {
        if (this.escKeyListener) {
            document.removeEventListener('keydown', this.escKeyListener);
            this.escKeyListener = null;
            this.logger.debug('ESC key listener removed');
        }
    }

    searchInput: string = '';

    private debounceTimer: any;

    copyToClipboard(text: string | undefined | null, type: string): void {
        if (text === null || text === undefined) {
            return;
        }

        navigator.clipboard.writeText(text)
            .then(() => {
                this.logger.debug(`Copied ${type} to clipboard:`, text);
                this.snackBar.open(`${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard`, 'Dismiss', {
                    duration: 3000,
                    horizontalPosition: 'center',
                    verticalPosition: 'bottom',
                    panelClass: 'copy-snackbar'
                });
            })
            .catch(error => {
                this.logger.error('Failed to copy to clipboard:', error);
                this.snackBar.open('Failed to copy to clipboard', 'Dismiss', {
                    duration: 3000,
                    horizontalPosition: 'center',
                    verticalPosition: 'bottom',
                    panelClass: 'error-snackbar'
                });
            });
    }

    navigateToProfile(npub: string): void {
        this.router.navigate(['/p', npub]);
        setTimeout(() => {
            this.scrollToOptimalProfilePosition();
        }, 300);
    }

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

    scrollToOptimalProfilePosition() {
        this.scrollToOptimalPosition(this.optimalProfilePosition);
    }

    /**
     * Scrolls the page to show half of the banner and the full profile picture
     */
    scrollToOptimalPosition(scrollPosition: number): void {
        // We need the banner height to calculate the optimal scroll position
        // const bannerHeight = this.getBannerHeight();

        // // Calculate scroll position that shows half of the banner
        // // We divide banner height by 2 to show half of it
        // const scrollPosition = bannerHeight / 2;

        // Find the content wrapper element
        const contentWrapper = document.querySelector('.mat-drawer-content');
        if (contentWrapper) {
            // Scroll the content wrapper to the calculated position with smooth animation
            contentWrapper.scrollTo({
                top: scrollPosition,
                behavior: 'smooth'
            });

            this.logger.debug('Scrolled content wrapper to optimal profile view position', scrollPosition);
        } else {
            this.logger.error('Could not find mat-drawer-content element for scrolling');
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
     * Scrolls the content wrapper to make a specific element visible
     * @param elementSelector CSS selector for the element to scroll to
     * @param offset Optional offset from the element's top (in pixels)
     * @param behavior Scrolling behavior
     */
    scrollToPosition(elementSelector: string, offset: number = 0, behavior: ScrollBehavior = 'smooth'): void {
        const container = document.querySelector('.content-wrapper');
        const targetElement = document.querySelector(elementSelector);

        if (!container) {
            this.logger.error('Could not find .content-wrapper element for scrolling');
            return;
        }

        if (!targetElement) {
            this.logger.error(`Could not find target element "${elementSelector}" for scrolling to`);
            return;
        }

        // Calculate the target element's position relative to the container
        const containerRect = container.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const relativeTop = targetRect.top - containerRect.top + container.scrollTop + offset;

        container.scrollTo({
            top: relativeTop,
            behavior: behavior
        });

        this.logger.debug(`Scrolled .content-wrapper to show element "${elementSelector}" at position ${relativeTop}`);
    }

    /**
     * Opens the profile picture in a larger view dialog
     */
    openProfilePicture(profile: NostrEvent): void {
        if (profile?.content.picture) {
            const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
                data: {
                    mediaUrl: profile.content.picture,
                },
                maxWidth: '100vw',
                maxHeight: '100vh',
                panelClass: 'profile-picture-dialog'
            });

            this.logger.debug('Opened profile picture dialog');
        }
    }

    openProfileBanner(profile: NostrEvent): void {
        if (profile?.content.banner) {
            const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
                data: {
                    mediaUrl: profile.content.banner,
                },
                maxWidth: '100vw',
                maxHeight: '100vh',
                panelClass: 'profile-picture-dialog'
            });

            this.logger.debug('Opened profile picture dialog');
        }
    }

    shareProfile(npub?: string, name?: string): void {
        if (!npub || !name) {
            this.logger.error('Cannot share profile: npub or name is undefined');
            return;
        }

        // Share profile action using the Web Share API if available
        if (navigator.share) {
            navigator.share({
                title: `${name}'s Nostr Profile`,
                text: `Check out ${npub} on Nostr`,
                url: window.location.href
            }).then(() => {
                this.logger.debug('Profile shared successfully');
            }).catch((error) => {
                this.logger.error('Error sharing profile:', error);
            });
        } else {
            // Fallback if Web Share API is not available
            this.copyToClipboard(window.location.href, 'profile URL');
        }
    }

    shareProfileUrl(npub: string | null | undefined): void {
        if (!npub) {
            return;
        }

        let url = 'https://nostria.app/p/' + npub;
        this.copyToClipboard(url, 'profile URL');
    }
}

