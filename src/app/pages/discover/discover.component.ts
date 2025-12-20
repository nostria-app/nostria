import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { DiscoverContentTabComponent } from './discover-content-tab/discover-content-tab.component';
import { DiscoverMediaTabComponent } from './discover-media-tab/discover-media-tab.component';

@Component({
  selector: 'app-discover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    DiscoverContentTabComponent,
    DiscoverMediaTabComponent,
  ],
  templateUrl: './discover.component.html',
  styleUrl: './discover.component.scss',
})
export class DiscoverComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  selectedTabIndex = signal(0);

  ngOnInit(): void {
    // Check query params first (for back navigation from category pages)
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'media') {
      this.selectedTabIndex.set(1);
      // Clean up the URL by removing the query param
      this.router.navigate(['/discover/media'], { replaceUrl: true });
      return;
    }

    // Then check URL path
    const url = this.router.url;
    if (url.includes('/discover/media')) {
      this.selectedTabIndex.set(1);
    } else {
      this.selectedTabIndex.set(0);
    }
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
    if (index === 0) {
      this.router.navigate(['/discover'], { replaceUrl: true });
    } else if (index === 1) {
      this.router.navigate(['/discover/media'], { replaceUrl: true });
    }
  }
}
