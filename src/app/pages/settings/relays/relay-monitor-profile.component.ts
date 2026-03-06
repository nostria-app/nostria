import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DataService } from '../../../services/data.service';
import { ProfileDisplayNameComponent } from '../../../components/user-profile/display-name/profile-display-name.component';
import { NostrRecord } from '../../../interfaces';

@Component({
  selector: 'app-relay-monitor-profile',
  imports: [CommonModule, MatIconModule, ProfileDisplayNameComponent],
  templateUrl: './relay-monitor-profile.component.html',
  styleUrl: './relay-monitor-profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelayMonitorProfileComponent {
  private readonly data = inject(DataService);

  pubkey = input.required<string>();

  profile = signal<NostrRecord | null>(null);
  isLoading = signal(false);

  avatarUrl = computed(() => {
    const record = this.profile();
    const pictureValue = record?.data?.picture;
    return typeof pictureValue === 'string' && pictureValue.length > 0 ? pictureValue : null;
  });

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();
      if (!pubkey) {
        this.profile.set(null);
        this.isLoading.set(false);
        return;
      }

      const cached = this.data.getCachedProfile(pubkey);
      if (cached) {
        this.profile.set(cached);
      }

      void this.loadProfile(pubkey);
    });
  }

  private async loadProfile(pubkey: string): Promise<void> {
    this.isLoading.set(true);

    try {
      const loaded = await this.data.getProfile(pubkey, { refresh: false });
      if (loaded && this.pubkey() === pubkey) {
        this.profile.set(loaded);
      }
    } finally {
      if (this.pubkey() === pubkey) {
        this.isLoading.set(false);
      }
    }
  }
}
