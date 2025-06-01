import { Component, inject } from '@angular/core';
import { MediaPlayerService } from '../../services/media-player.service';

@Component({
  selector: 'app-video-player',
  imports: [],
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.scss'
})
export class VideoPlayerComponent {
  media = inject(MediaPlayerService);
}
