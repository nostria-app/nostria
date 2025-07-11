import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { RouteDataService } from '../../services/route-data.service';

@Component({
  selector: 'app-navigation',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './navigation.html',
  styleUrl: './navigation.scss'
})
export class NavigationComponent {
  hasState = computed(() => {
    return !this.isRoot();
  });

  private route = inject(ActivatedRoute);

  // Convert route data to signal
  routeData = toSignal(
    this.route.data.pipe(
      map(data => data)
    ),
    { initialValue: {} }
  );

  isRoot = signal<boolean>(false);

  private routeDataService = inject(RouteDataService);

  constructor() {
    effect(() => {
      const routeData = this.routeDataService.currentRouteData();

      this.isRoot.set(routeData['isRoot'] || false);
    });
  }
}
