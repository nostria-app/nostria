import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CustomDialogRef } from '../../services/custom-dialog.service';

export interface RenameChatDialogData {
  currentName: string;
}

@Component({
  selector: 'app-rename-chat-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="rename-chat-dialog">
      <p class="dialog-description">Enter a new name for this group chat.</p>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Chat Name</mat-label>
        <input matInput [formControl]="nameControl" placeholder="Enter new chat name"
          (keydown.enter)="submit()" />
        @if (nameControl.hasError('required')) {
          <mat-error>Chat name is required</mat-error>
        }
      </mat-form-field>
      <div class="dialog-actions">
        <button mat-button type="button" (click)="dialogRef.close()">Cancel</button>
        <button mat-flat-button type="button" (click)="submit()" [disabled]="nameControl.invalid">
          Rename
        </button>
      </div>
    </div>
  `,
  styles: [`
    .rename-chat-dialog {
      padding: 8px 0;
    }
    .dialog-description {
      margin-bottom: 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .full-width {
      width: 100%;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
  `],
})
export class RenameChatDialogComponent {
  dialogRef = inject(CustomDialogRef);

  data: RenameChatDialogData = { currentName: '' };

  nameControl = new FormControl('', [Validators.required]);

  constructor() {
    if (this.data?.currentName) {
      this.nameControl.setValue(this.data.currentName);
    }
  }

  submit(): void {
    if (this.nameControl.valid) {
      this.dialogRef.close(this.nameControl.value!.trim());
    }
  }
}
