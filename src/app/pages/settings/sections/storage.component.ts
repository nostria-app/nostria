import { Component, ChangeDetectionStrategy } from '@angular/core';
import { StorageStatsComponent } from '../../../components/storage-stats/storage-stats.component';

@Component({
  selector: 'app-setting-storage',
  imports: [StorageStatsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="setting-section">
      <app-storage-stats></app-storage-stats>
    </div>
  `,
  styles: [`
    .setting-section {
      padding: 16px 0;
    }
  `]
})
export class SettingStorageComponent { }
