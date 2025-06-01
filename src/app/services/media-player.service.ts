import { effect, inject, Injectable, signal } from '@angular/core';
import { SafeResourceUrl } from '@angular/platform-browser';
import { MediaItem, OnInitialized } from '../interfaces';
import { UtilitiesService } from './utilities.service';
import { ApplicationService } from './application.service';
import { LocalStorageService } from './local-storage.service';
import { LayoutService } from './layout.service';

@Injectable({
  providedIn: 'root',
})
export class MediaPlayerService implements OnInitialized {
  utilities = inject(UtilitiesService);
  localStorage = inject(LocalStorageService);
  layout = inject(LayoutService);
  app = inject(ApplicationService);
  media = signal<MediaItem[]>([]);
  audio?: HTMLAudioElement;
  current?: MediaItem;
  index = 0;
  readonly MEDIA_STORAGE_KEY = 'nostria-media-queue';

  // minimized = false;
  // previousWidth = 800;
  // previousHeight = 600;

  get canPrevious() {
    return this.index > 0;
  }

  get canNext() {
    return this.index < this.media.length - 1;
  }

  constructor() {
    effect(() => {
      if (this.app.initialized()) {
        this.initialize();
      }
    });

    navigator.mediaSession.setActionHandler('play', async () => {
      if (!this.audio) {
        return;
      }

      // Resume playback
      try {
        await this.audio.play();
      } catch (err: any) {
        console.error(err.name, err.message);
      }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      if (!this.audio) {
        return;
      }

      // Pause active playback
      this.audio.pause();
    });

    navigator.mediaSession.setActionHandler('seekbackward', () => {
      this.rewind(10);
    });
    navigator.mediaSession.setActionHandler('seekforward', () => {
      this.forward(10);
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (this.canPrevious) {
        this.previous();
      }
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (this.canNext) {
        this.next();
      }
    });
  }

  initialize(): void {
    let mediaQueue = this.localStorage.getItem(this.MEDIA_STORAGE_KEY);

    if (mediaQueue == null || mediaQueue == '' || mediaQueue === 'undefined') {
      return
    }

    this.media.set(JSON.parse(mediaQueue) as MediaItem[]);
  }

  exit() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = undefined;
    }

    this.index = -1;
    this.current = undefined;
    this.layout.showMediaPlayer.set(false);
    this.media.set([]);
  }

  play(file: MediaItem) {
    this.layout.showMediaPlayer.set(true);
    // this.media.set[];
    this.media.update(files => [...files, file]);

    // this.stop();

    this.start();
  }

  enque(file: MediaItem) {
    // TODO: Clean the file.source URL!
    this.layout.showMediaPlayer.set(true);
    this.media.update(files => [...files, file]);
    // this.snackBar.open('Added to media queue', 'Hide', {
    //   duration: 1500,
    //   horizontalPosition: 'center',
    //   verticalPosition: 'bottom',
    // });
    this.save()
  }

  dequeue(file: MediaItem) {
    this.media.update(files => {
      const index = files.findIndex((e) => e === file);
      if (index === -1) {
        return files;
      }
      return files.filter((_, i) => i !== index);
    });
    this.save();
  }

  async save() {
    if (this.media().length === 0) {
      this.localStorage.removeItem(this.MEDIA_STORAGE_KEY);
      return;
    }

    this.localStorage.setItem(this.MEDIA_STORAGE_KEY, JSON.stringify(this.media()));
  }

  youtubeUrl?: SafeResourceUrl;
  videoUrl?: SafeResourceUrl;
  videoMode = false;

  async start() {
    if (this.index === -1) {
      this.index = 0;
    }

    const file = this.media()[this.index];

    if (!file) {
      return;
    }

    this.current = file;

    this.layout.showMediaPlayer.set(true);

    if (file.type === 'YouTube') {
      this.videoMode = true;
      this.youtubeUrl = this.utilities.sanitizeUrlAndBypassFrame(file.source + '?autoplay=1');
    } else if (file.type === 'Video') {
      this.videoMode = true;
      this.videoUrl = this.utilities.sanitizeUrlAndBypassFrame(file.source);
    } else {
      this.videoMode = false;
      if (!this.audio) {
        this.audio = new Audio(file.source);
      } else {
        this.audio.src = file.source;
      }

      await this.audio.play();
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: file.title,
      artist: file.artist,
      album: 'Blockcore Notes',
      artwork: [{ src: file.artwork }],
    });

    navigator.mediaSession.playbackState = 'playing';
  }

  async resume() {
    if (this.videoMode) {
      this.youtubeUrl = this.pausedYouTubeUrl;
      this.pausedYouTubeUrl = undefined;
    } else {
      if (!this.audio) {
        this.start();
        return;
      }

      console.log('RESUME!');
      try {
        await this.audio.play();
      } catch (err) {
        console.error(err);
      }
    }

    navigator.mediaSession.playbackState = 'playing';
  }

  pausedYouTubeUrl?: SafeResourceUrl;

  pause() {
    if (this.videoMode) {
      this.pausedYouTubeUrl = this.youtubeUrl;
      this.youtubeUrl = undefined;
    } else {
      if (!this.audio) {
        return;
      }

      this.audio.pause();
    }

    navigator.mediaSession.playbackState = 'paused';
  }

  next() {
    this.index++;
    this.start();
  }

  previous() {
    this.index--;
    this.start();
  }

  get error() {
    return this.audio?.error;
  }

  get paused() {
    if (this.videoMode) {
      return this.youtubeUrl == null;
    } else {
      if (!this.audio) {
        return true;
      }

      return this.audio.paused;
    }
  }

  get muted() {
    if (!this.audio) {
      return false;
    }

    return this.audio.muted;
  }

  get time() {
    if (!this.audio) {
      return 10;
    }

    return Math.floor(this.audio.currentTime);
  }

  set time(value) {
    if (!this.audio) {
      return;
    }

    this.audio.currentTime = value;
  }

  get duration() {
    if (!this.audio) {
      return 100;
    }

    return Math.floor(this.audio.duration);
  }

  mute() {
    if (!this.audio) {
      return;
    }

    this.audio.muted = !this.audio.muted;
  }

  forward(value: number) {
    if (!this.audio) {
      return;
    }

    this.audio.currentTime += value;
  }

  rewind(value: number) {
    if (!this.audio) {
      return;
    }

    this.audio.currentTime -= value;
  }

  rate() {
    if (!this.audio) {
      return;
    }

    console.log(this.audio.playbackRate);

    if (this.audio.playbackRate == 2.0) {
      this.audio.playbackRate = 1.0;
    } else {
      this.audio.playbackRate = 2.0;
    }
  }
}
