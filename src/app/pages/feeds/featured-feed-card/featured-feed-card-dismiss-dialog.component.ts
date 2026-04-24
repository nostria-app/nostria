import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { CustomDialogRef } from '../../../services/custom-dialog.service';

export type FeaturedFeedCardDismissAction = 'hide-one' | 'disable-all';

export interface FeaturedFeedCardDismissDialogData {
  title: string;
}

@Component({
  selector: 'app-featured-feed-card-dismiss-dialog',
  imports: [CustomDialogComponent, MatButtonModule],
  templateUrl: './featured-feed-card-dismiss-dialog.component.html',
  styleUrl: './featured-feed-card-dismiss-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturedFeedCardDismissDialogComponent {
  readonly dialogRef = inject(CustomDialogRef<FeaturedFeedCardDismissDialogComponent, FeaturedFeedCardDismissAction>);
  data!: FeaturedFeedCardDismissDialogData;

  hideOne(): void {
    this.dialogRef.close('hide-one');
  }

  disableAll(): void {
    this.dialogRef.close('disable-all');
  }

  cancel(): void {
    this.dialogRef.close();
  }
}