import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ListFilterMenuComponent, ListFilterValue } from '../list-filter-menu/list-filter-menu.component';

@Component({
  selector: 'app-music-list-filter',
  imports: [ListFilterMenuComponent],
  template: `
    <app-list-filter-menu
      storageKey="music"
      [showPublicOption]="true"
      defaultFilter="all"
      [compact]="true"
      [initialFilter]="initialFilter()"
      (filterChanged)="filterChanged.emit($event)" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicListFilterComponent {
  initialFilter = input<ListFilterValue | undefined>(undefined);

  filterChanged = output<ListFilterValue>();
}