import { Component, inject, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';

interface CreateOption {
  label: string;
  icon: string;
  action: () => void;
}

@Component({
  selector: 'app-create-menu',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './create-menu.component.html',
  styleUrl: './create-menu.component.scss',
})
export class CreateMenuComponent {
  private layout = inject(LayoutService);
  private eventService = inject(EventService);

  closed = output<void>();

  createOptions: CreateOption[] = [
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
    //   label: $localize`:@@create.option.upload:Upload`,
    //   icon: 'upload',
    //   action: () => this.layout.uploadMedia(),
    // },
  ];

  onItemClick(option: CreateOption): void {
    this.closed.emit();
    option.action();
  }
}
