import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { nip19 } from 'nostr-tools';
import { PanelNavigationService } from '../../../services/panel-navigation.service';
import { PodcastDataService } from '../../../services/podcast-data.service';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { PodcastShowEventComponent } from '../../../components/event-types/podcast-show-event.component';

@Component({
  selector: 'app-podcast-publisher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    UserProfileComponent,
    PodcastShowEventComponent,
  ],
  template: `
    <div class="panel-header">
      <button mat-icon-button (click)="goBack()" matTooltip="Back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="panel-title title-font" i18n="@@podcasts.publisher.title">Publisher</h2>
    </div>

    @if (loading()) {
      <div class="empty"><mat-spinner diameter="40"></mat-spinner></div>
    } @else {
      <div class="page">
        <div class="hero">
          <app-user-profile [pubkey]="pubkey()" view="large" />
          <p class="hero-meta">{{ showCountLabel() }}</p>
        </div>

        @if (shows().length === 0) {
          <div class="empty">
            <mat-icon>podcasts</mat-icon>
            <p i18n="@@podcasts.publisher.empty">This publisher has not listed any shows yet.</p>
          </div>
        } @else {
          <div class="shows-grid">
            @for (show of shows(); track show.id) {
              <app-podcast-show-event [event]="show" [compact]="true" />
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .panel-header {
      position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 8px;
      min-height: 56px; padding: 0 16px;
      background: color-mix(in srgb, var(--mat-sys-surface) 92%, transparent);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .panel-title { margin: 0; font-size: 1.25rem; }
    .page { padding: 1rem 1rem 120px; display: flex; flex-direction: column; gap: 1.5rem; }
    .hero { display: flex; flex-direction: column; gap: 0.5rem; }
    .hero-meta { margin: 0; color: var(--mat-sys-on-surface-variant); }
    .shows-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 3rem 1rem; color: var(--mat-sys-on-surface-variant); }
  `],
})
export class PodcastPublisherComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private panelNav = inject(PanelNavigationService);
  private podcastData = inject(PodcastDataService);

  readonly refreshing = signal(false);
  readonly pubkey = signal('');
  readonly shows = computed(() => {
    this.podcastData.shows();
    this.podcastData.publishers();
    return this.podcastData.getShowsForPublisher(this.pubkey());
  });
  readonly listedShowCount = computed(() => {
    this.podcastData.publishers();
    return this.podcastData.getPublisherShowPubkeys(this.pubkey()).length;
  });
  readonly loading = computed(() => {
    if (!this.pubkey()) {
      return true;
    }
    const hasCache = !!this.podcastData.getPublisher(this.pubkey()) || this.shows().length > 0;
    return !hasCache && this.refreshing();
  });
  readonly showCountLabel = computed(() => {
    const count = this.listedShowCount();
    return count === 1
      ? $localize`:@@podcasts.publisher.showOne:1 show`
      : $localize`:@@podcasts.publisher.showCount:${count}:count: shows`;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      void this.loadPublisher(params.get('pubkey') || '');
    });
  }

  private async loadPublisher(raw: string): Promise<void> {
    const pubkey = this.decodePubkey(raw);
    this.pubkey.set(pubkey);
    if (!pubkey) {
      return;
    }

    await this.podcastData.ensureInitialized();
    this.refreshing.set(true);
    try {
      await this.podcastData.refreshPublisher(pubkey);
    } finally {
      if (this.pubkey() === pubkey) {
        this.refreshing.set(false);
      }
    }
  }

  private decodePubkey(value: string): string {
    if (value.startsWith('npub') || value.startsWith('nprofile')) {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type === 'npub') return decoded.data;
        if (decoded.type === 'nprofile') return decoded.data.pubkey;
      } catch {
        return value;
      }
    }
    return value;
  }

  goBack(): void {
    if (this.route.outlet === 'right') {
      this.panelNav.goBackRight();
      return;
    }
    void this.router.navigate(['/podcasts']);
  }
}
