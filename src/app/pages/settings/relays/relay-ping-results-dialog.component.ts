import { Component, inject } from '@angular/core';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';

export interface PingResult {
  url: string;
  pingTime: number;
  isAlreadyAdded: boolean;
}

export interface RelayPingDialogData {
  results: PingResult[];
}

@Component({
  selector: 'app-relay-ping-results-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatTableModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
  ],
  templateUrl: './relay-ping-results-dialog.component.html',
  styleUrl: './relay-ping-results-dialog.component.scss',
})
export class RelayPingResultsDialogComponent {
  private dialogRef = inject(MatDialogRef<RelayPingResultsDialogComponent>);
  private data = inject<RelayPingDialogData>(MAT_DIALOG_DATA);

  results = this.data.results;

  selectRelay(result: PingResult): void {
    if (result.isAlreadyAdded) {
      return; // Don't allow re-selecting already added relays
    }

    // Close the dialog immediately to avoid expression changed errors
    this.dialogRef.close({ selected: result });
  }

  formatRelayUrl(url: string): string {
    // Remove wss:// prefix for better UX
    return url.replace(/^wss:\/\//, '');
  }
}
