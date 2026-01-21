import { Component, inject, signal } from '@angular/core';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface PingResult {
  url: string;
  pingTime: number;
  isAlreadyAdded: boolean;
}

export interface RelayPingDialogData {
  results: PingResult[];
}

export interface RelayPingDialogResult {
  selected: PingResult;
  includePurplepages: boolean;
}

@Component({
  selector: 'app-relay-ping-results-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatTableModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './relay-ping-results-dialog.component.html',
  styleUrl: './relay-ping-results-dialog.component.scss',
})
export class RelayPingResultsDialogComponent {
  private dialogRef = inject(MatDialogRef<RelayPingResultsDialogComponent>);
  private data = inject<RelayPingDialogData>(MAT_DIALOG_DATA);

  results = this.data.results;

  // Toggle for including purplepag.es as a secondary discovery relay (enabled by default)
  includePurplepages = signal(true);

  selectRelay(result: PingResult): void {
    if (result.isAlreadyAdded) {
      return; // Don't allow re-selecting already added relays
    }

    // Close the dialog with both the selected relay and the purplepages preference
    this.dialogRef.close({
      selected: result,
      includePurplepages: this.includePurplepages(),
    } as RelayPingDialogResult);
  }

  formatRelayUrl(url: string): string {
    // Remove wss:// prefix for better UX
    return url.replace(/^wss:\/\//, '');
  }
}
