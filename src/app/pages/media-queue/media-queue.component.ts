import { Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AddMediaDialog, AddMediaDialogData } from './add-media-dialog/add-media-dialog';
import { MediaItem } from '../../interfaces';
import { UtilitiesService } from '../../services/utilities.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-media-queue',
  imports: [MatButtonModule, MatIconModule, MatListModule],
  templateUrl: './media-queue.component.html',
  styleUrl: './media-queue.component.scss'
})
export class MediaQueueComponent {
  utilities = inject(UtilitiesService);
  media = inject(MediaPlayerService);
  private dialog = inject(MatDialog);

  constructor() { }

  ngOnInit() {
    // this.appState.showBackButton = true;
    // this.appState.updateTitle('Media Queue');
    // this.appState.actions = [
    //   {
    //     icon: 'queue',
    //     tooltip: 'Add Media to Queue',
    //     click: () => {
    //       this.addQueue();
    //     },
    //   },
    // ];
  }

  addQueue() {
    const dialogRef = this.dialog.open(AddMediaDialog, {
      data: {},
      maxWidth: '100vw',
      panelClass: 'full-width-dialog',
    });

    dialogRef.afterClosed().subscribe(async (result: AddMediaDialogData) => {
      if (!result || !result.url) {
        return;
      }

      if (result.url.indexOf('youtu.be') > -1 || result.url.indexOf('youtube.com') > -1) {
        const youtubes = [...result.url.matchAll(this.utilities.regexpYouTube)];
        let youtube = youtubes.map((i) => {
          return { url: `https://www.youtube.com/embed/${i[1]}` };
        });

        for (let index = 0; index < youtube.length; index++) {
          const youtubeUrl = youtube[index].url;
          this.media.enque({ artist: '', artwork: '/logos/youtube.png', title: youtubeUrl, source: youtubeUrl, type: 'YouTube' });
        }
      } else if (result.url.indexOf('.mp4') > -1 || result.url.indexOf('.webm') > -1) {
        this.media.enque({ artist: '', artwork: '/logos/youtube.png', title: result.url, source: result.url, type: 'Video' });
      } else {
        this.media.enque({ artist: '', artwork: '', title: result.url, source: result.url, type: 'Music' });
      }
    });
  }

  remove(item: MediaItem) {
    this.media.dequeue(item);
  }
}
