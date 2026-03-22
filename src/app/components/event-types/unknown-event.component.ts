import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';
import { UtilitiesService } from '../../services/utilities.service';
import { AppHandlerService, AppHandler } from '../../services/app-handler.service';
import { getKindLabel } from '../../utils/kind-labels';
import { ContentComponent } from '../content/content.component';

/**
 * Renders events of unknown/unrecognized kinds.
 *
 * NIP-31: Shows the `alt` tag as a human-readable description of what the
 * event is about, giving users context even when the client cannot render
 * the event natively.
 *
 * NIP-89: Discovers and suggests external applications that can handle
 * the event kind, allowing users to "Open in..." a compatible app.
 *
 * If no alt tag is present, falls back to rendering the event content
 * as text (same as the previous behavior for unknown kinds).
 */
@Component({
  selector: 'app-unknown-event',
  imports: [
    CommonModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ContentComponent,
  ],
  templateUrl: './unknown-event.component.html',
  styleUrl: './unknown-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnknownEventComponent {
  private utilities = inject(UtilitiesService);
  private appHandlerService = inject(AppHandlerService);

  /** The unknown event to render */
  event = input.required<Event>();

  /** Content data (parsed record data) for the <app-content> fallback */
  content = input<string | undefined>();

  /** Trusted pubkey for content rendering */
  trustedByPubkey = input<string | undefined>();

  /** Whether in feeds panel */
  inFeedsPanel = input<boolean>(false);

  /** NIP-31: human-readable alt description */
  altText = computed(() => this.utilities.getAltTag(this.event()));

  /** Human-readable kind label */
  kindLabel = computed(() => getKindLabel(this.event().kind));

  /** Numeric kind for display */
  kindNumber = computed(() => this.event().kind);

  /** Whether the event has text content to show */
  hasContent = computed(() => {
    const c = this.content();
    const eventContent = this.event().content;
    return !!(c || eventContent);
  });

  /** Whether to show the content section (when there is content AND no alt text, or always when expanded) */
  showContent = signal(false);

  /** App handlers discovered via NIP-89 */
  appHandlers = signal<AppHandler[]>([]);

  /** Whether handlers are currently loading */
  handlersLoading = signal(false);

  /** Whether handler discovery has been attempted */
  handlersQueried = signal(false);

  /** Load app handlers when the event changes */
  private loadHandlersEffect = effect(() => {
    const evt = this.event();
    this.loadHandlers(evt.kind);
  });

  toggleContent(): void {
    this.showContent.update(v => !v);
  }

  openInApp(handler: AppHandler): void {
    const url = this.appHandlerService.buildHandlerUrl(handler, this.event());
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  private async loadHandlers(kind: number): Promise<void> {
    this.handlersLoading.set(true);
    this.handlersQueried.set(false);

    try {
      const handlers = await this.appHandlerService.getHandlersForKind(kind);
      this.appHandlers.set(handlers);
    } catch {
      this.appHandlers.set([]);
    } finally {
      this.handlersLoading.set(false);
      this.handlersQueried.set(true);
    }
  }
}
