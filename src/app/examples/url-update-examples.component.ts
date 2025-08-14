import { Component, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-url-update-examples',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule],
  template: `
    <mat-card>
      <mat-card-header>
        <mat-card-title
          >URL Update Examples (No Navigation Events)</mat-card-title
        >
      </mat-card-header>

      <mat-card-content>
        <p>Current URL: {{ currentUrl() }}</p>

        <div class="button-group">
          <button
            mat-raised-button
            color="primary"
            (click)="updateWithReplaceState()"
          >
            Update with Location.replaceState()
          </button>

          <button mat-raised-button color="primary" (click)="updateWithGo()">
            Update with Location.go()
          </button>

          <button
            mat-raised-button
            color="primary"
            (click)="updateQueryParams()"
          >
            Update Query Parameters Only
          </button>

          <button
            mat-raised-button
            color="primary"
            (click)="updatePathSegments()"
          >
            Update Path Segments
          </button>

          <button
            mat-raised-button
            color="primary"
            (click)="updateWithSkipLocation()"
          >
            Router Navigate (Skip Location Change)
          </button>

          <button
            mat-raised-button
            color="warn"
            (click)="updateWithReplaceUrl()"
          >
            Router Navigate (Replace URL)
          </button>

          <button mat-raised-button (click)="resetUrl()">
            Reset to Original
          </button>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .button-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 16px;
      }

      .button-group button {
        align-self: flex-start;
      }
    `,
  ],
})
export class UrlUpdateExamplesComponent {
  private location = inject(Location);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  currentUrl = signal(this.location.path());
  private originalUrl = this.location.path();

  constructor() {
    // Update current URL signal when location changes
    // Note: This won't trigger for replaceState(), only for actual navigation
    setInterval(() => {
      this.currentUrl.set(this.location.path());
    }, 100);
  }

  /**
   * Method 1: Location.replaceState() - Most Recommended
   * - Updates URL without adding to browser history
   * - No navigation events triggered
   * - Most efficient approach
   */
  updateWithReplaceState(): void {
    const newUrl =
      '/example/replacestate?method=replaceState&timestamp=' + Date.now();
    this.location.replaceState(newUrl);
    console.log('URL updated with replaceState:', newUrl);
  }

  /**
   * Method 2: Location.go()
   * - Updates URL and adds to browser history
   * - No navigation events triggered
   * - User can navigate back with browser back button
   */
  updateWithGo(): void {
    const newUrl = '/example/go?method=go&timestamp=' + Date.now();
    this.location.go(newUrl);
    console.log('URL updated with go:', newUrl);
  }

  /**
   * Method 3: Update Query Parameters Only
   * - Preserves current path, only updates query params
   * - Most useful for state management
   */
  updateQueryParams(): void {
    const queryParams = {
      method: 'queryParams',
      timestamp: Date.now().toString(),
      filter: 'active',
    };

    const urlTree = this.router.createUrlTree([], {
      queryParams,
      queryParamsHandling: 'merge',
      relativeTo: this.route,
    });

    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('Query parameters updated:', queryParams);
  }

  /**
   * Method 4: Update Path Segments
   * - Updates entire path structure
   * - Can include query parameters
   */
  updatePathSegments(): void {
    const pathSegments = ['example', 'path-segments', 'updated'];
    const queryParams = { method: 'pathSegments', timestamp: Date.now() };

    const urlTree = this.router.createUrlTree(pathSegments, { queryParams });
    this.location.replaceState(this.router.serializeUrl(urlTree));
    console.log('Path segments updated:', pathSegments);
  }

  /**
   * Method 5: Router.navigate() with skipLocationChange
   * - Updates Angular router internal state
   * - Browser URL remains unchanged
   * - Navigation events ARE triggered but URL doesn't change
   */
  updateWithSkipLocation(): void {
    this.router.navigate(['/example/skip-location'], {
      queryParams: { method: 'skipLocation', timestamp: Date.now() },
      skipLocationChange: true,
    });
    console.log('Router navigated with skipLocationChange');
  }

  /**
   * Method 6: Router.navigate() with replaceUrl
   * - Navigation events ARE triggered
   * - Replaces current URL in history (no new history entry)
   * - Less efficient than Location methods
   */
  updateWithReplaceUrl(): void {
    this.router.navigate(['/example/replace-url'], {
      queryParams: { method: 'replaceUrl', timestamp: Date.now() },
      replaceUrl: true,
    });
    console.log('Router navigated with replaceUrl');
  }

  /**
   * Reset to original URL
   */
  resetUrl(): void {
    this.location.replaceState(this.originalUrl);
    console.log('URL reset to original:', this.originalUrl);
  }
}
