import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { Router } from '@angular/router';

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
    // Navigate to note creation or implement note creation logic
    console.log('Create note');
    // Example: this.router.navigate(['/create/note']);
  }

  private createArticle(): void {
    // Navigate to article creation
    console.log('Create article');
    // Example: this.router.navigate(['/create/article']);
  }

  private uploadMedia(): void {
    // Navigate to upload page or open upload dialog
    console.log('Upload media');
    // Example: this.router.navigate(['/create/upload']);
  }
}
