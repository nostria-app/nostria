import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { Event } from 'nostr-tools';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { CustomDialogComponent } from '../custom-dialog/custom-dialog.component';

export type DeleteEventReferenceMode = 'e' | 'a';

export interface DeleteConfirmationDialogData {
  title: string;
  entityLabel?: string;
  confirmText?: string;
  event?: Event;
  canDeleteLocally?: boolean;
}

export interface DeleteConfirmationResult {
  confirmed: boolean;
  referenceMode: DeleteEventReferenceMode;
}

@Component({
  selector: 'app-delete-confirmation-dialog',
  imports: [CustomDialogComponent, FormsModule, MatButtonModule, MatRadioModule],
  templateUrl: './delete-confirmation-dialog.component.html',
  styleUrl: './delete-confirmation-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteConfirmationDialogComponent {
  dialogRef = inject(CustomDialogRef<DeleteConfirmationDialogComponent, DeleteConfirmationResult>);
  data!: DeleteConfirmationDialogData;

  selectedMode: DeleteEventReferenceMode = 'e';

  get event(): Event | undefined {
    return this.data?.event;
  }

  get isAddressable(): boolean {
    const kind = this.event?.kind;
    return kind !== undefined && kind >= 30000 && kind < 40000;
  }

  get hasDTag(): boolean {
    return !!this.event?.tags.find(tag => tag[0] === 'd' && tag[1]?.trim());
  }

  get supportsAddressDelete(): boolean {
    return this.isAddressable && this.hasDTag;
  }

  get confirmText(): string {
    return this.data?.confirmText || 'Delete';
  }

  get entityLabel(): string {
    return this.data?.entityLabel || 'event';
  }

  confirm(): void {
    this.dialogRef.close({
      confirmed: true,
      referenceMode: this.supportsAddressDelete ? this.selectedMode : 'e',
    });
  }

  cancel(): void {
    this.dialogRef.close({
      confirmed: false,
      referenceMode: this.supportsAddressDelete ? this.selectedMode : 'e',
    });
  }
}
