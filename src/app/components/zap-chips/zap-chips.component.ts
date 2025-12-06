import { Component, input, computed, inject, ChangeDetectionStrategy, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { DataService } from '../../services/data.service';

export interface ZapperInfo {
  pubkey: string;
  amount: number;
}

interface ProfileCache {
  picture?: string;
  name?: string;
  display_name?: string;
}

@Component({
  selector: 'app-zap-chips',
  imports: [CommonModule, MatTooltipModule, MatIconModule],
  template: `
    <div class="zap-chips-container">
      @for (zapper of displayedZappers(); track zapper.pubkey; let i = $index) {
        <div class="zap-chip" [class.has-avatar]="getAvatar(zapper.pubkey)">
          @if (getAvatar(zapper.pubkey); as avatar) {
            <img [src]="avatar" class="zapper-avatar" [alt]="getName(zapper.pubkey)" />
          } @else {
            <div class="zapper-initial" [style.background-color]="getColor(i)">
              {{ getInitial(zapper.pubkey) }}
            </div>
          }
          <span class="zapper-name">{{ getName(zapper.pubkey) }}</span>
          <mat-icon class="zap-icon">bolt</mat-icon>
          <span class="zap-amount">{{ formatAmount(zapper.amount) }}</span>
        </div>
      }
      @if (remainingCount() > 0) {
        <div class="zap-chip more-chip" [matTooltip]="remainingTooltip()">
          <span>+{{ remainingCount() }} more</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .zap-chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .zap-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 4px;
      background-color: var(--mat-sys-surface-container-high);
      border-radius: 20px;
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface);
      transition: background-color 0.2s;

      &:hover {
        background-color: var(--mat-sys-surface-container-highest);
      }

      &.more-chip {
        padding: 4px 12px;
        color: var(--mat-sys-on-surface-variant);
        cursor: default;
      }
    }

    .zapper-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
    }

    .zapper-initial {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      color: white;
      text-transform: uppercase;
    }

    .zapper-name {
      max-width: 100px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .zap-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #f7931a;
    }

    .zap-amount {
      color: #f7931a;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZapChipsComponent {
  zappers = input.required<ZapperInfo[]>();
  maxDisplay = input<number>(4);

  private data = inject(DataService);

  // Cache for profile data
  private profileCache = signal<Map<string, ProfileCache>>(new Map());

  // Track which pubkeys we've already requested to prevent duplicate fetches
  private loadedPubkeys = new Set<string>();

  // Colors for initial avatars
  private colors = [
    '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3',
    '#00bcd4', '#009688', '#4caf50', '#ff9800', '#ff5722'
  ];

  constructor() {
    // Load profile data when zappers change
    effect(() => {
      const zappersList = this.zappers();
      // Only load profiles for displayed zappers, not all
      const displayed = zappersList.slice(0, this.maxDisplay());
      for (const zapper of displayed) {
        // Skip if already loaded or loading
        if (this.loadedPubkeys.has(zapper.pubkey)) {
          continue;
        }
        this.loadedPubkeys.add(zapper.pubkey);
        this.loadProfile(zapper.pubkey);
      }
    }, { allowSignalWrites: true });
  }

  private loadProfile(pubkey: string) {
    // Check cache first (sync)
    const cached = this.data.getCachedProfile(pubkey);
    if (cached?.data) {
      this.updateProfileCacheSync(pubkey, cached.data);
      return;
    }

    // Load from relay if not cached (async, outside effect)
    this.data.getProfile(pubkey).then(profile => {
      if (profile?.data) {
        this.updateProfileCacheSync(pubkey, profile.data);
      }
    }).catch(() => {
      // Ignore errors
    });
  }

  private updateProfileCacheSync(pubkey: string, data: { picture?: string; name?: string; display_name?: string }) {
    const current = this.profileCache();
    // Don't update if already in cache with same data
    const existing = current.get(pubkey);
    if (existing?.picture === data.picture && existing?.name === data.name && existing?.display_name === data.display_name) {
      return;
    }
    const updated = new Map(current);
    updated.set(pubkey, {
      picture: data.picture,
      name: data.name,
      display_name: data.display_name,
    });
    this.profileCache.set(updated);
  }

  displayedZappers = computed(() => {
    const all = this.zappers();
    return all.slice(0, this.maxDisplay());
  });

  remainingCount = computed(() => {
    const all = this.zappers();
    const max = this.maxDisplay();
    return Math.max(0, all.length - max);
  });

  remainingTooltip = computed(() => {
    const all = this.zappers();
    const max = this.maxDisplay();
    const remaining = all.slice(max);
    return remaining.map(z => `${this.getName(z.pubkey)}: ${this.formatAmount(z.amount)}`).join('\n');
  });

  getAvatar(pubkey: string): string | null {
    const cache = this.profileCache();
    const profile = cache.get(pubkey);
    return profile?.picture || null;
  }

  getName(pubkey: string): string {
    const cache = this.profileCache();
    const profile = cache.get(pubkey);
    if (profile?.display_name) return profile.display_name;
    if (profile?.name) return profile.name;
    // Return shortened pubkey
    return pubkey.slice(0, 8) + '...';
  }

  getInitial(pubkey: string): string {
    const name = this.getName(pubkey);
    return name.charAt(0);
  }

  getColor(index: number): string {
    return this.colors[index % this.colors.length];
  }

  formatAmount(sats: number): string {
    if (sats >= 1000000) {
      return (sats / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (sats >= 1000) {
      return (sats / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return sats.toString();
  }
}
