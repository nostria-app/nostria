import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';

export interface MessageDetailsDialogData {
  eventId: string;
  giftWrapId?: string;
  chatPubkey: string;
  relaySources: string[];
  rawMessageJson: string;
  rawEnvelopeJson?: string;
  unwrapStages?: {
    title: string;
    json?: string;
    error?: string;
  }[];
}

@Component({
  selector: 'app-message-details-dialog',
  imports: [MatButtonModule, MatIconModule, MatDividerModule],
  templateUrl: './message-details-dialog.component.html',
  styleUrl: './message-details-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageDetailsDialogComponent {
  data: MessageDetailsDialogData = {
    eventId: '',
    chatPubkey: '',
    relaySources: [],
    rawMessageJson: '',
  };
  private snackBar = inject(MatSnackBar);

  async copyText(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.snackBar.open(`${label} copied`, 'Close', { duration: 2000 });
    } catch {
      this.snackBar.open(`Failed to copy ${label.toLowerCase()}`, 'Close', { duration: 3000 });
    }
  }
}
