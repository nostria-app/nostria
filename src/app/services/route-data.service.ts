import { Injectable, inject, signal } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({
    providedIn: 'root'
})
export class RouteDataService {
    private router = inject(Router);

    // Signal for current route data
    currentRouteData = signal<any>({});

    // Listen to navigation events
    navigationEvents = toSignal(
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        )
    );

    constructor() {
        // Update route data when navigation occurs
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe(() => {
            this.updateRouteData();
        });
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

    // Helper methods
    getRouteData<T>(key: string): T | undefined {
        return this.currentRouteData()[key];
    }

    hasRouteData(key: string): boolean {
        return key in this.currentRouteData();
    }
}