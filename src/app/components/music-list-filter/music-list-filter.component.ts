import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ListFilterMenuComponent, ListFilterValue } from '../list-filter-menu/list-filter-menu.component';

@Component({
  selector: 'app-music-list-filter',
  imports: [ListFilterMenuComponent],
  template: `
    <app-list-filter-menu
      storageKey="music"
      [showCuratedOption]="showCuratedOption()"
      [showPublicOption]="showPublicOption()"
      [showHideGruuvOption]="showHideGruuvOption()"
      [defaultFilter]="defaultFilter()"
      [compact]="true"
      [initialFilter]="initialFilter()"
      (filterChanged)="filterChanged.emit($event)"
      (hideGruuvChanged)="hideGruuvChanged.emit($event)" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicListFilterComponent {
  initialFilter = input<ListFilterValue | undefined>(undefined);
  showPublicOption = input(true);
  showCuratedOption = input(true);
  showHideGruuvOption = input(true);
  defaultFilter = input<ListFilterValue>('curated');

  filterChanged = output<ListFilterValue>();
  hideGruuvChanged = output<boolean>();
}
