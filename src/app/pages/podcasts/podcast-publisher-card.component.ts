import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Event } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { PodcastDataService } from '../../services/podcast-data.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

@Component({
  selector: 'app-podcast-publisher-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UserProfileComponent],
  template: `
    <button type="button" class="publisher-card" (click)="openPublisher()">
      <app-user-profile [pubkey]="event().pubkey" view="list" [disableLink]="true" [disableHoverCard]="true" />
      <span class="publisher-meta">{{ showCountLabel() }}</span>
    </button>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .publisher-card {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.25rem;
      width: 100%;
      padding: 0.75rem;
      border: 0;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .publisher-card:hover {
      background: var(--mat-sys-surface-container);
    }
    .publisher-meta {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }
  `],
})
export class PodcastPublisherCardComponent {
  private layout = inject(LayoutService);
  private podcastData = inject(PodcastDataService);

  readonly event = input.required<Event>();

  readonly showCount = computed(() => {
    this.podcastData.shows();
    this.podcastData.publishers();
    return this.podcastData.getPublisherShowPubkeys(this.event().pubkey).length;
  });

  readonly showCountLabel = computed(() => {
    const count = this.showCount();
    return count === 1
      ? $localize`:@@podcasts.publisher.showOne:1 show`
      : $localize`:@@podcasts.publisher.showCount:${count}:count: shows`;
  });

  openPublisher(): void {
    this.layout.openPodcastPublisher(this.event().pubkey);
  }
}
