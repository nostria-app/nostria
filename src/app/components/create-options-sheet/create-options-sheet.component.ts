import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../services/layout.service';

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
  private layout = inject(LayoutService);

  // Creation options
  createOptions = [
    { label: 'Note', icon: 'create', action: () => this.layout.createNote() },
    { label: 'Article', icon: 'article', action: () => this.layout.createArticle() },
    { label: 'Upload', icon: 'upload', action: () => this.layout.uploadMedia() }
  ];

  // Handler for selecting an option
  selectOption(action: () => void): void {
    this.bottomSheetRef.dismiss();
    action();
  }
}
