import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, nip19 } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-wot-event',
  imports: [CommonModule, MatCardModule, MatChipsModule, MatIconModule, MatTooltipModule, UserProfileComponent],
  templateUrl: './wot-event.component.html',
  styleUrl: './wot-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WotEventComponent {
  private layout = inject(LayoutService);

  event = input.required<Event>();

  /** The d-tag identifier for this parameterized replaceable event */
  identifier = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'd');
    return tag?.[1] || '';
  });

  /** Referenced event IDs from e-tags */
  referencedEvents = computed(() => {
    return this.event().tags
      .filter(t => t[0] === 'e' && !!t[1])
      .map(t => {
        const id = t[1];
        const relay = t[2] || '';
        let nevent = '';
        try {
          nevent = nip19.neventEncode({
            id,
            relays: relay ? [relay] : undefined,
          });
        } catch {
          nevent = '';
        }
        return { id, relay, nevent, shortId: id.substring(0, 12) + '...' };
      });
  });

  /** Referenced pubkeys from p-tags */
  referencedPubkeys = computed(() => {
    return this.event().tags
      .filter(t => t[0] === 'p' && !!t[1])
      .map(t => t[1]);
  });

  /** Status tag (s) - e.g., "verified", "spam", "trusted" */
  status = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 's');
    return tag?.[1] || '';
  });

  /** Capitalized status for display */
  statusDisplay = computed(() => this.capitalize(this.status()));

  /** Validity tag (v) - e.g., "valid", "invalid" */
  validity = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'v');
    return tag?.[1] || '';
  });

  /** Capitalized validity for display */
  validityDisplay = computed(() => this.capitalize(this.validity()));

  /** Client that created this attestation */
  client = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'client');
    return tag?.[1] || '';
  });

  /** Content text (attestation comment) */
  content = computed(() => this.event().content || '');

  /** Whether this is a positive/trust attestation */
  isPositive = computed(() => {
    const s = this.status().toLowerCase();
    const v = this.validity().toLowerCase();
    return s === 'verified' || s === 'trusted' || s === 'safe' || v === 'valid' || v === 'trusted';
  });

  /** Whether this is a negative/distrust attestation */
  isNegative = computed(() => {
    const s = this.status().toLowerCase();
    const v = this.validity().toLowerCase();
    return s === 'spam' || s === 'bot' || s === 'malicious' || s === 'blocked' || v === 'invalid' || v === 'spam';
  });

  /** Icon to display based on status */
  statusIcon = computed(() => {
    if (this.isPositive()) return 'verified';
    if (this.isNegative()) return 'gpp_bad';
    return 'shield';
  });

  /** All custom tags that aren't standard structural ones (d, e, p, s, v, client) */
  extraTags = computed(() => {
    const knownTags = new Set(['d', 'e', 'p', 's', 'v', 'client']);
    return this.event().tags
      .filter(t => !knownTags.has(t[0]) && !!t[1])
      .map(t => ({ key: t[0], value: t[1] }));
  });

  /** Navigate to a referenced event */
  navigateToEvent(ref: { id: string; nevent: string }): void {
    if (ref.nevent) {
      this.layout.openEventAsPrimary(ref.nevent);
    }
  }

  /** Navigate to a user profile */
  navigateToProfile(pubkey: string): void {
    this.layout.navigateToProfile(pubkey);
  }

  /** Capitalize the first letter of each word */
  private capitalize(value: string): string {
    if (!value) return '';
    return value.replace(/\b\w/g, char => char.toUpperCase());
  }
}
