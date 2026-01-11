import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';

export interface CreateListDialogResult {
  name: string;
  id: string;
}

export interface CreateListDialogData {
  name?: string;
  id?: string;
  isRename?: boolean;
}

@Component({
  selector: 'app-create-list-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './create-list-dialog.component.html',
  styleUrl: './create-list-dialog.component.scss',
})
export class CreateListDialogComponent {
  dialogRef = inject(MatDialogRef<CreateListDialogComponent>);
  data = inject<CreateListDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  listName = signal(this.data?.name || '');
  listId = signal(this.data?.id || '');
  isRename = this.data?.isRename || false;

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

    if (!name || !id) {
      return;
    }

    this.dialogRef.close({ name, id });
  }

  cancel() {
    this.dialogRef.close();
  }
}
