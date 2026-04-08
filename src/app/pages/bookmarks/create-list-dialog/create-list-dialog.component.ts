import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { CustomDialogRef } from '../../../services/custom-dialog.service';

export interface CreateListDialogResult {
  name: string;
  id: string;
  isPrivate: boolean;
}

export interface CreateListDialogData {
  name?: string;
  id?: string;
  isRename?: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-create-list-dialog',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    FormsModule
  ],
  templateUrl: './create-list-dialog.component.html',
  styleUrl: './create-list-dialog.component.scss',
})
export class CreateListDialogComponent {
  dialogRef = inject(CustomDialogRef<CreateListDialogComponent, CreateListDialogResult | undefined>);

  set data(value: CreateListDialogData | null | undefined) {
    this.listName.set(value?.name || '');
    this.listId.set(value?.id || '');
    this.isRename.set(value?.isRename || false);
    this.isPrivate.set(false);
  }

  listName = signal('');
  listId = signal('');
  isPrivate = signal(false);
  isRename = signal(false);

  // Generate a suggested ID based on the name
  generateIdFromName() {
    const name = this.listName().trim();
    if (!name) {
      this.listId.set('');
      return;
    }

    // Convert to lowercase, replace spaces with hyphens, remove special chars
    const id = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 50); // Limit length

    this.listId.set(id);
  }

  create() {
    const name = this.listName().trim();
    const id = this.listId().trim();

    if (!name || (!this.isRename() && !id)) {
      return;
    }

    this.dialogRef.close({ name, id, isPrivate: this.isPrivate() });
  }

  cancel() {
    this.dialogRef.close();
  }
}
