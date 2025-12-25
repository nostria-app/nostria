import { Component, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';

@Component({
  selector: 'app-create-options-sheet',
  standalone: true,
  imports: [MatListModule, MatIconModule],
  templateUrl: './create-options-sheet.component.html',
  styleUrl: './create-options-sheet.component.scss',
})
export class CreateOptionsSheetComponent {
  private bottomSheetRef = inject(MatBottomSheetRef<CreateOptionsSheetComponent>);
  private layout = inject(LayoutService);
  private eventService = inject(EventService);

  // Creation options
  createOptions = [
    {
      label: $localize`:@@create.option.note:Note`,
      icon: 'create',
      action: () => this.eventService.createNote(),
    },
    {
      label: $localize`:@@create.option.article:Article`,
      icon: 'article',
      action: () => this.layout.createArticle(),
    },
    {
      label: $localize`:@@create.option.media:Media`,
      icon: 'add_photo_alternate',
      action: () => this.layout.openMediaCreatorDialog(),
    },
    {
      label: $localize`:@@create.option.video:Video Clip`,
      icon: 'cinematic_blur',
      action: () => this.layout.openRecordVideoDialog(),
    },
    {
      label: $localize`:@@create.option.audio:Audio Clip`,
      icon: 'mic',
      action: () => this.layout.openRecordAudioDialog(),
    },
    // {
    //   label: 'Upload',
    //   icon: 'upload',
    //   action: () => this.layout.uploadMedia(),
    // },
  ];

  // Handler for selecting an option
  selectOption(action: () => void): void {
    this.bottomSheetRef.dismiss();
    action();
  }
}
