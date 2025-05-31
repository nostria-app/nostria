import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { NoteEditorDialogComponent } from '../note-editor-dialog/note-editor-dialog.component';

@Component({
  selector: 'app-create-options-sheet',
  standalone: true,
  imports: [
    MatListModule,
    MatIconModule
  ],
  templateUrl: './create-options-sheet.component.html',
  styleUrl: './create-options-sheet.component.scss'
})
export class CreateOptionsSheetComponent {
  private bottomSheetRef = inject(MatBottomSheetRef<CreateOptionsSheetComponent>);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  // Creation options
  createOptions = [
    { label: 'Note', icon: 'create', action: () => this.createNote() },
    { label: 'Article', icon: 'article', action: () => this.createArticle() },
    { label: 'Upload', icon: 'upload', action: () => this.uploadMedia() }
  ];

  // Handler for selecting an option
  selectOption(action: () => void): void {
    this.bottomSheetRef.dismiss();
    action();
  }
  // Handler methods for different creation types
  private createNote(): void {
    // Open note editor dialog
    const dialogRef = this.dialog.open(NoteEditorDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      data: {} // No reply/quote data for new notes
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.published) {
        console.log('Note published successfully:', result.event);
      }
    });
  }
  private createArticle(): void {
    // Navigate to article creation
    this.router.navigate(['/article/create']);
  }private async uploadMedia(): Promise<void> {
    // Navigate to media page with upload parameter
    await this.router.navigate(['/media'], { queryParams: { upload: 'true' } });
  }
}
