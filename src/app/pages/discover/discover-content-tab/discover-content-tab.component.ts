import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { CategoryConfig, CONTENT_CATEGORIES } from '../../../services/discovery.service';

@Component({
  selector: 'app-discover-content-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatRippleModule,
  ],
  templateUrl: './discover-content-tab.component.html',
  styleUrl: './discover-content-tab.component.scss',
})
export class DiscoverContentTabComponent {
  private router = inject(Router);

  readonly contentCategories: CategoryConfig[] = CONTENT_CATEGORIES;

  selectCategory(category: CategoryConfig): void {
    this.router.navigate(['/discover', 'content', category.id]);
  }
}
