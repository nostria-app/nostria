import { Component, computed, inject, input } from '@angular/core';
import { Event, kinds } from 'nostr-tools';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EventService } from '../../../services/event';
import { AccountStateService } from '../../../services/account-state.service';
import { LayoutService } from '../../../services/layout.service';

@Component({
  selector: 'app-reply-button',
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './reply-button.component.html',
  styleUrls: ['./reply-button.component.scss'],
})
export class ReplyButtonComponent {
  private readonly eventService = inject(EventService);
  private readonly accountState = inject(AccountStateService);
  private readonly layout = inject(LayoutService);

  event = input.required<Event>();

  // we use NIP-10 replies for kind:1 and NIP-22 comments for all the other kinds
  isReply = computed(() => this.event().kind === kinds.ShortTextNote);

  async onClick(event?: MouseEvent): Promise<void> {
    if (event) {
      event.stopPropagation();
    }

    // Check if user is logged in
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) {
      // Show login dialog if no account is active
      await this.layout.showLoginDialog();
      return;
    }

    if (this.event().kind === kinds.ShortTextNote) {
      // Get the full thread context using EventService
      const eventTags = this.eventService.getEventTags(this.event());

      this.eventService.createNote({
        replyTo: {
          id: this.event().id,
          pubkey: this.event().pubkey,
          rootId: eventTags.rootId,
          event: this.event(), // Pass the full event for complete tag analysis
        },
      });
    } else {
      // Create kind:1111 comment (NIP-22)
      this.eventService.createComment(this.event());
    }
  }
}
