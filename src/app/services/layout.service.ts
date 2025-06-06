import { inject, Injectable, signal } from "@angular/core";
import { NostrService } from "./nostr.service";
import { StorageService } from "./storage.service";
import { Router, RouterLink, RouterModule } from "@angular/router";
import { LoggerService } from "./logger.service";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { BreakpointObserver } from "@angular/cdk/layout";
import { MediaPreviewDialogComponent } from "../components/media-preview-dialog/media-preview.component";
import { Event, nip19 } from "nostr-tools";
import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";
import { ProfileStateService } from "./profile-state.service";
import { LoginDialogComponent } from "../components/login-dialog/login-dialog.component";
import { NostrRecord } from "../interfaces";

@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    /** Used to perform queries or search when input has been parsed to be NIP-5 or similar. */
    query = signal<string | null>(null);
    search = signal(false);
    router = inject(Router);
    private logger = inject(LoggerService);
    private dialog = inject(MatDialog);
    private snackBar = inject(MatSnackBar);
    isHandset = signal(false);
    isWideScreen = signal(false);
    breakpointObserver = inject(BreakpointObserver);
    optimalProfilePosition: number = 200;
    premium = signal(false);
    profileState = inject(ProfileStateService);
    overlayMode = signal(false);
    showMediaPlayer = signal(false);

    constructor() {
        // Monitor only mobile devices (not tablets)
        this.breakpointObserver.observe('(max-width: 599px)').subscribe(result => {
            this.logger.debug('Breakpoint observer update', { isMobile: result.matches });
            this.isHandset.set(result.matches);

        });

        this.breakpointObserver.observe('(min-width: 1200px)').subscribe(result => {
            this.isWideScreen.set(result.matches);
        });
    }

    toggleSearch() {
        const newSearchState = !this.search();
        this.search.set(newSearchState);        if (newSearchState) {
            // Add ESC key listener when search is opened
            this.setupEscKeyListener();
        } else {
            // Remove ESC key listener when search is closed
            this.removeEscKeyListener();
            // Clear search input and query when closing
            this.searchInput = '';
            this.query.set('');
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

        if (type === 'nprofile') {
            const profile: ProfilePointer = { pubkey: text, relays: this.profileState.relay?.relayUrls };
            text = nip19.nprofileEncode(profile);
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

    showWelcomeScreen = signal<boolean>(localStorage.getItem('nostria-welcome') !== 'false');

    // Method to update welcome screen preference
    setWelcomeScreenPreference(show: boolean): void {
        localStorage.setItem('nostria-welcome', show ? 'true' : 'false');
        this.showWelcomeScreen.set(show);
        this.logger.debug('Welcome screen preference updated', { show });
    }

    async showLoginDialog(): Promise<void> {
        this.logger.debug('showLoginDialog called');
        // Apply the blur class to the document body before opening the dialog
        document.body.classList.add('blur-backdrop');

        const dialogRef = this.dialog.open(LoginDialogComponent, {
            // width: '400px',
            // maxWidth: '95vw',
            disableClose: true,
            // panelClass: 'welcome-dialog'
        });

        this.logger.debug('Initial login dialog opened');

        // Handle login completion and data loading
        dialogRef.afterClosed().subscribe(async () => {
            this.logger.debug('Login dialog closed');
            document.body.classList.remove('blur-backdrop');

            // If user is logged in after dialog closes, simulate data loading
            // if (this.nostrService.isLoggedIn()) {
            //   this.logger.debug('User logged in, loading data');
            // } else {
            //   this.logger.debug('User not logged in after dialog closed');
            // }
        });
    }

    navigateToProfile(npub: string): void {
        this.router.navigate(['/p', npub]);
        setTimeout(() => {
            this.scrollToOptimalProfilePosition();
        }, 300);
    }    onSearchInput(event: any) {
        if (event.target.value === null) {
            clearTimeout(this.debounceTimer);
            return;
        }

        // Set query immediately for cached search results
        console.log('onSearchInput called with value:', event.target.value);
        this.query.set(event.target.value);

        // Debounce logic to wait until user finishes typing for special searches
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            console.log('Handle search called!');
            this.handleSearch(event.target.value);
        }, 750);
    }private handleSearch(value: string): void {
        if (!value) {
            this.query.set('');
            return;
        }

        if (value.startsWith('npub')) {
            this.toggleSearch();
            this.searchInput = '';
            this.openProfile(value);
        }
        else if (value.startsWith('nprofile')) {
            this.toggleSearch();
            const decoded = nip19.decode(value).data as ProfilePointer;
            this.openProfile(decoded.pubkey);
        }
        else if (value.startsWith('nevent')) {
            this.toggleSearch();
            const decoded = nip19.decode(value).data as EventPointer;
            this.openEvent(value);
        }
        else if (value.includes('@')) {
            // Keep the query set for NIP-05 lookups (already set in onSearchInput)
            // The search service will handle this
        }
        else if (value.startsWith('nsec')) {
            this.toggleSearch();
            this.toast('WARNING: You pasted your nsec key. This is a security risk! Please remove it from your clipboard.', 5000, 'error-snackbar');
            return;
        }
        else if (value.startsWith('naddr')) {
            this.toggleSearch();
            const decoded = nip19.decode(value).data as AddressPointer;

            // If the naddr has a pubkey, we can discover them if not found locally.
            if (decoded.pubkey) {

            }

            this.openArticle(value);
        }
        else if (value.includes(':')) {
            this.openProfile(value);
        } else {
            // For regular text searches, let the search service handle cached results
            // The query is already set in onSearchInput
            // Only navigate to search page if no cached results are found after a delay
            setTimeout(() => {
                // This could be enhanced to check if cached results were found
                // For now, we'll let the cached search work without navigation
            }, 100);
        }
    }

    openProfile(pubkey: string): void {
        this.router.navigate(['/p', pubkey]);
    }

    openEvent(naddr: string, event?: Event): void {
        this.router.navigate(['/e', naddr], { state: { event } });
    }

    openArticle(naddr: string, event?: Event): void {
        this.router.navigate(['/a', naddr], { state: { event } });
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

        console.log('Scrolling to optimal position:', scrollPosition);
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
     * Scrolls the main content area to the top - specifically for page navigation
     * Uses the mat-drawer-content element which is the main scrollable container
     */
    scrollMainContentToTop(): void {
        // Try the mat-drawer-content first (main layout container)
        const matDrawerContent = document.querySelector('.mat-drawer-content');
        if (matDrawerContent) {
            matDrawerContent.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            this.logger.debug('Scrolled mat-drawer-content to top');
            return;
        }

        // Fallback to content-wrapper
        const contentWrapper = document.querySelector('.content-wrapper');
        if (contentWrapper) {
            contentWrapper.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            this.logger.debug('Fallback: scrolled content-wrapper to top');
            return;
        }

        // Final fallback to window scroll
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
        this.logger.debug('Final fallback: scrolled window to top');
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
    openProfilePicture(profile: NostrRecord): void {
        if (profile?.data.picture) {
            const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
                data: {
                    mediaUrl: profile.data.picture,
                },
                maxWidth: '100vw',
                maxHeight: '100vh',
                panelClass: 'profile-picture-dialog'
            });

            this.logger.debug('Opened profile picture dialog');
        }
    }

    openProfileBanner(profile: NostrRecord): void {
        if (profile?.data.banner) {
            const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
                data: {
                    mediaUrl: profile.data.banner,
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

    toast(message: string, duration: number = 3000, panelClass: string = 'success-snackbar') {
        this.snackBar.open(message, 'Close', {
            duration,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass
        });
    }

    async showPublishResults(publishPromises: Promise<string>[] | null, itemName: string) {
        try {
            // Wait for all publishing results
            const results = await Promise.all(publishPromises || []);

            // Count successes and failures
            const successful = results.filter(result => result === '').length;
            const failed = results.length - successful;

            // Display appropriate notification
            if (failed === 0) {
                this.snackBar.open(`${itemName} saved successfully to ${successful} ${successful === 1 ? 'relay' : 'relays'}`, 'Close', {
                    duration: 3000,
                    horizontalPosition: 'center',
                    verticalPosition: 'bottom',
                    panelClass: 'success-snackbar'
                });
            } else {
                this.snackBar.open(
                    `${itemName} saved to ${successful} ${successful === 1 ? 'relay' : 'relays'}, failed on ${failed} ${failed === 1 ? 'relay' : 'relays'}`,
                    'Close',
                    {
                        duration: 5000,
                        horizontalPosition: 'center',
                        verticalPosition: 'bottom',
                        panelClass: failed > successful ? 'error-snackbar' : 'warning-snackbar'
                    }
                );
            }
        } catch (error) {
            console.error('Error publishing:', error);
            this.snackBar.open(`Failed to save ${itemName}`, 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'bottom',
                panelClass: 'error-snackbar'
            });
        }
    }
}

