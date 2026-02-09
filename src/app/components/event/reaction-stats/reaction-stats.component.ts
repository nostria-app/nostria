import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { NostrRecord } from '../../../interfaces';

@Component({
  selector: 'app-reaction-stats',
  imports: [
    MatIconModule,
    MatRippleModule,
  ],
  templateUrl: './reaction-stats.component.html',
  styleUrl: './reaction-stats.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReactionStatsComponent {
  reactions = input<NostrRecord[]>([]);
  replyCount = input<number>(0);
  repostCount = input<number>(0);
  quoteCount = input<number>(0);
  totalZapAmount = input<number>(0);
  zapCount = input<number>(0);

  tabClicked = output<'likes' | 'zaps' | 'reposts' | 'quotes'>();

  hasAnyStats = computed<boolean>(() => {
    return this.reactions().length > 0
      || this.replyCount() > 0
      || this.repostCount() > 0
      || this.totalZapAmount() > 0;
  });

  formattedZapAmount = computed<string>(() => {
    const amount = this.totalZapAmount();
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toLocaleString();
  });

  onStatClick(tab: 'likes' | 'zaps' | 'reposts' | 'quotes', event: MouseEvent): void {
    event.stopPropagation();
    this.tabClicked.emit(tab);
  }
}
