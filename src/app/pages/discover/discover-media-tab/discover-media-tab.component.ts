import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { CategoryConfig, MEDIA_CATEGORIES } from '../../../services/discovery.service';

@Component({
  selector: 'app-discover-media-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatRippleModule,
  ],
  templateUrl: './discover-media-tab.component.html',
  styleUrl: './discover-media-tab.component.scss',
})
export class DiscoverMediaTabComponent {
  private router = inject(Router);

  readonly mediaCategories: CategoryConfig[] = MEDIA_CATEGORIES;

  selectCategory(category: CategoryConfig): void {
    this.router.navigate(['/discover', 'media', category.id]);
  }
}
