import { Injectable, signal } from '@angular/core';
import { NostrEvent } from 'nostr-tools';

export type SidePanelContent =
  | { type: 'event'; eventId: string; event?: NostrEvent }
  | { type: 'profile'; pubkey: string }
  | null;

@Injectable({
  providedIn: 'root',
})
export class SidePanelService {
  // Current content being displayed in the side panel
  content = signal<SidePanelContent>(null);

  // Whether the panel is open
  isOpen = signal(false);

  openEvent(eventId: string, event?: NostrEvent) {
    this.content.set({ type: 'event', eventId, event });
    this.isOpen.set(true);
  }

  openProfile(pubkey: string) {
    this.content.set({ type: 'profile', pubkey });
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
    // Delay clearing content to allow close animation
    setTimeout(() => {
      this.content.set(null);
    }, 300);
  }
}
