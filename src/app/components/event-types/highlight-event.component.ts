import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { ContentComponent } from '../content/content.component';

@Component({
  selector: 'app-highlight-event',
  imports: [
    MatIconModule,
    ContentComponent,
  ],
  templateUrl: './highlight-event.component.html',
  styleUrl: './highlight-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HighlightEventComponent {
  event = input.required<Event>();
  trustedByPubkey = input<string | undefined>(undefined);
  inFeedsPanel = input<boolean>(false);

  /** The highlighted text from the event content */
  highlightText = computed(() => this.event().content || '');

  /** Optional context tag providing surrounding text */
  context = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'context');
    return tag?.[1] || '';
  });

  /** Source URL from 'r' tag (without 'mention' marker) */
  sourceUrl = computed(() => {
    const event = this.event();
    // Per NIP-84: source url has 'source' attribute, or is the r-tag without 'mention'
    const sourceTag = event.tags.find(
      t => t[0] === 'r' && t[2] !== 'mention'
    );
    return sourceTag?.[1] || '';
  });

  /** Display-friendly hostname from the source URL */
  sourceHostname = computed(() => {
    const url = this.sourceUrl();
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  });

  /** Optional comment tag (quote highlight per NIP-84) */
  comment = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'comment');
    return tag?.[1] || '';
  });

  hasComment = computed(() => !!this.comment());
}
