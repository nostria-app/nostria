import { Injectable, inject, signal, computed } from '@angular/core';
import { Router, NavigationEnd, Event } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';

export interface NavigationHistoryItem {
    url: string;
    title: string;
    timestamp: Date;
}

@Injectable({
    providedIn: 'root'
})
export class RouteDataService {
    private router = inject(Router);
    private titleService = inject(Title);

    // Signal for current route data
    currentRouteData = signal<any>({});

    // Signal for navigation history
    navigationHistory = signal<NavigationHistoryItem[]>([]);

    // Computed signal for whether we can go back
    canGoBack = computed(() => {
        return this.navigationHistory().length > 1;
    });

    // Listen to navigation events
    navigationEvents = toSignal(
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        )
    );

    constructor() {
        // Update route data immediately
        this.updateRouteData();
        
        // Initialize with current route
        setTimeout(() => this.initializeHistory(), 0);
        
        // Listen for router events and track navigation
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event: NavigationEnd) => {
            this.updateRouteData();
            // Delay history update to ensure title is properly set
            setTimeout(() => {
                this.updateNavigationHistory(event);
            }, 0);
        });
    }

    private initializeHistory() {
        // Add the initial/current route to history if not already present
        const currentUrl = this.router.url;
        const currentHistory = this.navigationHistory();
        
        if (currentHistory.length === 0 && currentUrl) {
            const initialTitle = this.getRouteTitle(currentUrl);
            const initialItem: NavigationHistoryItem = {
                url: currentUrl,
                title: initialTitle,
                timestamp: new Date()
            };
            this.navigationHistory.set([initialItem]);
        }
    }

    private updateRouteData() {
        const route = this.router.routerState.root;
        let child = route;

        // Traverse to the activated route
        while (child.firstChild) {
            child = child.firstChild;
        }

        // Update the signal with current route data
        this.currentRouteData.set(child.snapshot.data);
    }

    private updateNavigationHistory(event: NavigationEnd) {
        const currentHistory = this.navigationHistory();
        
        // Get title from current route configuration first, then fallback to title service
        const routeTitle = this.getRouteTitle(event.url);
        const currentTitle = routeTitle || this.titleService.getTitle() || 'Page';
        
        // Don't add duplicate consecutive entries
        if (currentHistory.length > 0 && currentHistory[currentHistory.length - 1].url === event.url) {
            return;
        }

        const newItem: NavigationHistoryItem = {
            url: event.url,
            title: currentTitle,
            timestamp: new Date()
        };

        // Keep only last 10 history items
        const updatedHistory = [...currentHistory, newItem].slice(-10);
        this.navigationHistory.set(updatedHistory);
    }

    private getRouteTitle(url: string): string {
        // Remove query params and fragments
        const cleanUrl = url.split('?')[0].split('#')[0];
        
        // Find the best matching route
        const matchingRoute = this.findMatchingRoute(cleanUrl);
        
        if (matchingRoute?.title) {
            return typeof matchingRoute.title === 'string' ? matchingRoute.title : matchingRoute.title.toString();
        }

        // Generate title from URL segments
        return this.generateTitleFromUrl(cleanUrl);
    }

    private findMatchingRoute(url: string): any {
        // Helper function to check if a route pattern matches the URL
        const matchesPattern = (pattern: string, testUrl: string): boolean => {
            if (pattern === '') return testUrl === '/';
            
            // Convert route pattern to regex
            const regexPattern = pattern
                .replace(/:[^/]+/g, '[^/]+') // Replace :param with [^/]+
                .replace(/\*\*/g, '.*') // Replace ** with .*
                .replace(/\*/g, '[^/]*'); // Replace * with [^/]*
            
            const regex = new RegExp(`^/${regexPattern}$`);
            return regex.test(testUrl);
        };

        // Flatten all routes including children
        const flattenRoutes = (routes: any[], parentPath = ''): any[] => {
            const result: any[] = [];
            
            for (const route of routes) {
                const fullPath = parentPath + '/' + (route.path || '');
                const cleanPath = fullPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
                
                result.push({ ...route, fullPath: cleanPath });
                
                if (route.children) {
                    result.push(...flattenRoutes(route.children, cleanPath));
                }
            }
            
            return result;
        };

        const allRoutes = flattenRoutes(this.router.config);
        
        // Find the most specific matching route
        const matches = allRoutes.filter(route => matchesPattern(route.path || '', url));
        
        // Sort by specificity (longer paths first)
        matches.sort((a, b) => (b.fullPath?.length || 0) - (a.fullPath?.length || 0));
        
        return matches[0] || null;
    }

    private generateTitleFromUrl(url: string): string {
        const segments = url.split('/').filter(s => s.length > 0);
        
        if (segments.length === 0) return 'Home';
        
        // Handle special route patterns
        if (segments[0] === 'p' && segments.length > 1) {
            return 'Profile';
        }
        
        if (segments[0] === 'u' && segments.length > 1) {
            return 'Profile';
        }
        
        if (segments[0] === 'e' && segments.length > 1) {
            return 'Event';
        }
        
        if (segments[0] === 'a' && segments.length > 1) {
            return 'Article';
        }
        
        if (segments[0] === 'b' && segments.length > 1) {
            return 'Badge';
        }
        
        if (segments[0] === 'f' && segments.length > 1) {
            return 'Feed';
        }
        
        // Use the first segment for title
        const firstSegment = segments[0];
        
        // Handle special cases
        const titleMap: { [key: string]: string } = {
            'settings': 'Settings',
            'people': 'People',
            'articles': 'Articles',
            'messages': 'Messages',
            'notifications': 'Notifications',
            'credentials': 'Credentials',
            'accounts': 'Accounts',
            'about': 'About',
            'relays': 'Relays',
            'badges': 'Badges',
            'media': 'Media',
            'bookmarks': 'Bookmarks',
            'premium': 'Premium',
            'beta': 'Beta',
            'backup': 'Backup',
            'media-queue': 'Media Queue'
        };
        
        if (titleMap[firstSegment]) {
            return titleMap[firstSegment];
        }
        
        // Convert segment to title case
        return firstSegment
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    // Helper methods
    getRouteData<T>(key: string): T | undefined {
        return this.currentRouteData()[key];
    }

    hasRouteData(key: string): boolean {
        return key in this.currentRouteData();
    }

    // Navigation history methods
    goBack(): void {
        if (this.canGoBack()) {
            const history = this.navigationHistory();
            const previousUrl = history[history.length - 2]?.url;
            if (previousUrl) {
                // Remove current item from history before navigating
                this.navigationHistory.set(history.slice(0, -1));
                this.router.navigateByUrl(previousUrl);
            }
        }
    }

    goToHistoryItem(index: number): void {
        const history = this.navigationHistory();
        if (index >= 0 && index < history.length) {
            const targetUrl = history[index].url;
            // Remove items after the target index
            this.navigationHistory.set(history.slice(0, index + 1));
            this.router.navigateByUrl(targetUrl);
        }
    }

    getNavigationHistory(): NavigationHistoryItem[] {
        return this.navigationHistory();
    }
}