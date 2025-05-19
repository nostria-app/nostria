import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface Region {
  id: string;
  name: string;
  enabled: boolean;
  icon: string;
}

@Component({
  selector: 'app-location-selection-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './location-selection-dialog.component.html',
  styleUrl: './location-selection-dialog.component.scss'
})
export class LocationSelectionDialogComponent {
  private dialogRef = inject(MatDialogRef<LocationSelectionDialogComponent>);

  regions: Region[] = [
    { id: 'europe', name: 'Europe', enabled: true, icon: 'euro_symbol' },
    { id: 'africa', name: 'Africa', enabled: true, icon: 'public' },
    { id: 'north_america', name: 'North America', enabled: false, icon: 'north_america' },
    { id: 'south_america', name: 'South America', enabled: false, icon: 'south_america' },
    { id: 'asia', name: 'Asia', enabled: false, icon: 'asia' }
  ];

  selectRegion(region: Region): void {
    if (region.enabled) {
      this.dialogRef.close(region.id);
    }
  }

  isEnabled(region: Region): boolean {
    return region.enabled;
  }
}
