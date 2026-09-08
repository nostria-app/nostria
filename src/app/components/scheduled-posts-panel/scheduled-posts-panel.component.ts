import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ScheduledPostsService } from '../../services/scheduled-posts.service';

@Component({
  selector: 'app-scheduled-posts-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule],
  template: `
    <p i18n="@@scheduled.managerHelp">Scheduled posts from all accounts on this device publish automatically, even after switching accounts. Canceling removes pending delivery from this device.</p>
    @if (queue.error()) {
      <p role="alert" i18n="@@scheduled.storageError">Unable to access scheduled posts. Check device storage and try again.</p>
    }
    @for (post of queue.posts(); track post.id) {
      <article>
        <time>{{ post.events[0].created_at * 1000 | date:'medium' }}</time>
        <p class="author"><span i18n="@@scheduled.author">Author:</span> {{ post.events[0].pubkey }}</p>
        <p class="content">{{ post.events[0].content }}</p>
        @if (post.leaseUntil > 0) {
          <p role="status" i18n="@@scheduled.delivering">Delivery in progress or awaiting recovery…</p>
        }
        @if (post.attempts > 0) {
          <p role="status"><span i18n="@@scheduled.retrying">Delivery failed. Automatic retry:</span> {{ post.retryAt | date:'medium' }}</p>
          <button mat-button (click)="retry(post.id)" [disabled]="busy() === post.id" i18n="@@scheduled.retry">Retry now</button>
        }
        @if (post.nextEvent > 0) {
          <p i18n="@@scheduled.partial">Part of this media post has already been published. Canceling only stops the remaining delivery.</p>
        }
        @if (confirmCancel() === post.id) {
          <button mat-flat-button (click)="cancelPost(post.id)" [disabled]="busy() === post.id" i18n="@@scheduled.confirmCancel">Confirm cancellation</button>
          <button mat-button (click)="confirmCancel.set(null)" i18n="@@scheduled.keep">Keep post</button>
        } @else {
          <button mat-button (click)="confirmCancel.set(post.id)" i18n="@@scheduled.cancel">Cancel post</button>
        }
      </article>
    } @empty {
      <p i18n="@@scheduled.empty">No scheduled posts on this device.</p>
    }
    <button mat-button (click)="queue.processDue()" i18n="@@scheduled.refresh">Refresh</button>
  `,
  styles: `
    :host { display: block; color: var(--mat-sys-on-surface); }
    article {
      padding: 16px; margin-block: 12px; border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
    }
    .content { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; }
    .author { overflow-wrap: anywhere; color: var(--mat-sys-on-surface-variant); font-size: 12px; }
  `,
})
export class ScheduledPostsPanelComponent {
  readonly queue = inject(ScheduledPostsService);
  private readonly snackBar = inject(MatSnackBar);
  readonly confirmCancel = signal<string | null>(null);
  readonly busy = signal<string | null>(null);

  constructor() { void this.queue.processDue(); }

  async cancelPost(id: string): Promise<void> {
    this.busy.set(id);
    try {
      await this.queue.cancel(id);
      this.confirmCancel.set(null);
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(null);
    }
  }

  async retry(id: string): Promise<void> {
    this.busy.set(id);
    try { await this.queue.retry(id); }
    catch (error) { this.showError(error); }
    finally { this.busy.set(null); }
  }

  private showError(error: unknown): void {
    this.snackBar.open(error instanceof Error ? error.message :
      $localize`:@@scheduled.storageError:Unable to access scheduled posts. Check device storage and try again.`,
    undefined, { duration: 5000 });
  }
}
