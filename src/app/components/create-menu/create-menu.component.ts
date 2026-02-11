import { Component, inject, output, signal } from '@angular/core';
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
  showMore = signal(false);

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
      label: $localize`:@@create.option.media:Media`,
      icon: 'add_photo_alternate',
      action: () => this.layout.openMediaCreatorDialog(),
    },
    {
      label: $localize`:@@create.option.message:Message`,
      icon: 'mail',
      action: () => this.layout.openMessages(),
    },
  ];

  moreOptions: CreateOption[] = [
    {
      label: $localize`:@@create.option.list:List`,
      icon: 'list',
      action: () => this.layout.createFollowSet(),
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
    {
      label: $localize`:@@create.option.music:Music Track`,
      icon: 'music_note',
      action: () => this.layout.openMusicUpload(),
    },
    {
      label: $localize`:@@create.option.livestream:Live Stream`,
      icon: 'live_tv',
      action: () => this.layout.openLiveStreamDialog(),
    },
  ];

  onItemClick(option: CreateOption): void {
    this.closed.emit();
    option.action();
  }

  toggleMore(): void {
    this.showMore.update(v => !v);
  }
}
