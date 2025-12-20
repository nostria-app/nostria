import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
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

  selectedTabIndex = signal(0);

  ngOnInit(): void {
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
