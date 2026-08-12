import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { CustomDialogRef } from '../../services/custom-dialog.service';
import { Nip29InviteLink } from '../../utils/nip29-invite-url';

export type Nip29InviteDialogResult = 'nostria' | 'external';

@Component({
  selector: 'app-nip29-invite-dialog',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './nip29-invite-dialog.component.html',
  styleUrl: './nip29-invite-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nip29InviteDialogComponent {
  private readonly dialogRef = inject(
    CustomDialogRef<Nip29InviteDialogComponent, Nip29InviteDialogResult | undefined>
  );

  data?: Nip29InviteLink;

  get invite(): Nip29InviteLink | undefined {
    return this.data;
  }

  relayLabel(slug: string): string {
    return slug.replace(/~/g, '/');
  }

  openInNostria(): void {
    this.dialogRef.close('nostria');
  }

  openExternal(): void {
    this.dialogRef.close('external');
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
