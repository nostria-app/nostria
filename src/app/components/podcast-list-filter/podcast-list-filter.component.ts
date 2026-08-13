import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ListFilterMenuComponent, ListFilterValue } from '../list-filter-menu/list-filter-menu.component';

@Component({
  selector: 'app-podcast-list-filter',
  imports: [ListFilterMenuComponent],
  template: `
    <app-list-filter-menu
      storageKey="podcasts"
      [showCuratedOption]="true"
      [showPublicOption]="true"
      [curatedLabel]="curatedLabel"
      [curatedDescription]="curatedDescription"
      curatedIcon="podcasts"
      [defaultFilter]="defaultFilter()"
      [compact]="true"
      [initialFilter]="initialFilter()"
      (filterChanged)="filterChanged.emit($event)" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PodcastListFilterComponent {
  initialFilter = input<ListFilterValue | undefined>(undefined);
  defaultFilter = input<ListFilterValue>('curated');
  filterChanged = output<ListFilterValue>();
  readonly curatedLabel = $localize`:@@podcasts.filter.curated:Curated`;
  readonly curatedDescription = $localize`:@@podcasts.filter.curatedDescription:Shows with published metadata`;
}
