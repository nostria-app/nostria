import {
  Component,
  inject,
  signal,
  input,
  output,
  ChangeDetectionStrategy,
  computed,
  ElementRef,
  viewChild,
  effect,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { MediaItem } from '../../../../interfaces';

@Component({
  selector: 'app-playlist-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatRippleModule,
    DragDropModule,
  ],
  templateUrl: './playlist-drawer.component.html',
  styleUrl: './playlist-drawer.component.scss',
  host: {
    '[class.open]': 'isOpen()',
    '[class.dragging]': 'isDragging()',
    '[class.previewing]': 'dragOffset() > 0',
    '[style.transform]': 'transformStyle()',
  },
})
export class PlaylistDrawerComponent {
  readonly media = inject(MediaPlayerService);

  isOpen = input<boolean>(false);
  dragOffset = input<number>(0);
  closeDrawer = output<void>();

  // Drag to open/close
  isDragging = signal(false);
  dragOffsetInternal = signal(0);
  private startY = 0;
  private containerEl = viewChild<ElementRef<HTMLDivElement>>('container');
  private closeHandleEl = viewChild<ElementRef<HTMLDivElement>>('closeHandle');
  private gestureSetup = false;

  queue = computed(() => this.media.media());
  currentIndex = computed(() => this.media.index);

  private queueListEl = viewChild<ElementRef<HTMLDivElement>>('queueList');

  constructor() {
    // Use effect to setup gesture when element becomes available
    effect(() => {
      const closeHandle = this.closeHandleEl()?.nativeElement;
      const container = this.containerEl()?.nativeElement;
      if (closeHandle && container && !this.gestureSetup) {
        this.gestureSetup = true;
        // Use setTimeout to ensure DOM is fully ready
        setTimeout(() => this.setupDragGesture(closeHandle, container), 0);
      }
    });

    // Scroll to current track when drawer opens
    effect(() => {
      if (this.isOpen()) {
        // Use setTimeout to ensure DOM is updated after drawer animation starts
        setTimeout(() => this.scrollToCurrentTrack(), 100);
      }
    });
  }

  private scrollToCurrentTrack(): void {
    const queueList = this.queueListEl()?.nativeElement;
    if (!queueList) return;

    const currentIndex = this.currentIndex();
    const currentItem = queueList.querySelector('.queue-item.current') as HTMLElement;

    if (currentItem) {
      currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  transformStyle = computed(() => {
    // When drawer is being dragged closed (internal drag on open drawer)
    if (this.isDragging()) {
      const offset = this.dragOffsetInternal();
      return `translateY(${Math.max(-100, offset)}%)`;
    }

    // When open, show fully
    if (this.isOpen()) {
      return 'translateY(0)';
    }

    // When closed but external drag is happening (dragging down from player view)
    const externalDrag = this.dragOffset();
    if (externalDrag > 0) {
      // Convert pixel drag to percentage (assuming ~600px container height)
      const percent = Math.min(100, (externalDrag / 600) * 100);
      return `translateY(${-100 + percent}%)`;
    }

    // Default closed state
    return 'translateY(-100%)';
  });

  private setupDragGesture(closeHandle: HTMLDivElement, container: HTMLDivElement): void {
    // Only listen on the bottom close handle, not the entire container
    closeHandle.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      this.startY = e.touches[0].clientY;
      this.isDragging.set(true);
    }, { passive: true });

    closeHandle.addEventListener('touchmove', (e: TouchEvent) => {
      if (!this.isDragging()) return;
      const deltaY = e.touches[0].clientY - this.startY;
      const containerHeight = container.offsetHeight;
      const percent = (deltaY / containerHeight) * 100;

      if (this.isOpen()) {
        // When open, allow dragging up (negative) to close
        this.dragOffsetInternal.set(Math.min(0, percent));
      }
    }, { passive: true });

    closeHandle.addEventListener('touchend', () => {
      const offset = this.dragOffsetInternal();
      this.isDragging.set(false);

      // Threshold to trigger close
      if (this.isOpen() && offset < -20) {
        this.closeDrawer.emit();
      }

      this.dragOffsetInternal.set(0);
    }, { passive: true });
  }

  playTrack(index: number): void {
    this.media.index = index;
    this.media['start'](); // Start playing the selected track
  }

  removeTrack(index: number, event: Event): void {
    event.stopPropagation();
    const queue = this.queue();
    if (queue.length > 0) {
      this.media.dequeue(queue[index]);
    }
  }

  clearQueue(): void {
    this.media['clearQueue']?.();
  }

  onDrop(event: CdkDragDrop<MediaItem[]>): void {
    const queue = [...this.queue()];
    moveItemInArray(queue, event.previousIndex, event.currentIndex);
    this.media.media.set(queue);
    this.media.save();

    // Update current index if needed
    if (event.previousIndex === this.currentIndex()) {
      this.media.index = event.currentIndex;
    } else if (
      event.previousIndex < this.currentIndex() &&
      event.currentIndex >= this.currentIndex()
    ) {
      this.media.index = this.currentIndex() - 1;
    } else if (
      event.previousIndex > this.currentIndex() &&
      event.currentIndex <= this.currentIndex()
    ) {
      this.media.index = this.currentIndex() + 1;
    }
  }

  formatDuration(duration: number | undefined): string {
    if (!duration) return '';
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
