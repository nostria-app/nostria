import { Component, ChangeDetectionStrategy, computed, inject, input, signal, effect, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { type Event, nip19 } from 'nostr-tools';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { UtilitiesService } from '../../services/utilities.service';
import { DataService } from '../../services/data.service';

/** Parsed content segment - either text or a mention */
interface ContentSegment {
  type: 'text' | 'mention';
  content: string;
  displayName?: string;
}

/**
 * A simplified event component optimized for screenshot/image capture.
 * 
 * Differences from regular event display:
 * - Shows full timestamp instead of relative time ("35 minutes ago")
 * - Parses nostr mentions to show @username instead of raw nostr: URIs
 * - No footer section (no reactions, zaps, replies, reposts)
 * - No bookmark button
 * - No client indicator  
 * - Includes Nostria logo watermark and event ID
 */
@Component({
  selector: 'app-event-image',
  imports: [
    MatCardModule,
    TimestampPipe,
    UserProfileComponent,
  ],
  templateUrl: './event-image.component.html',
  styleUrl: './event-image.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventImageComponent {
  private utilities = inject(UtilitiesService);
  private data = inject(DataService);

  /** The event to render */
  event = input.required<Event>();

  /** Width of the rendered image in pixels */
  width = input<number>(500);

  /** Parsed content segments with resolved mentions */
  contentSegments = signal<ContentSegment[]>([]);

  /** Whether content parsing is complete (including profile resolution) */
  isReady = signal<boolean>(false);

  /** Emits when content parsing is complete */
  ready = output<void>();

  /** The encoded event ID (nevent1... or naddr1...) */
  encodedEventId = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    // Encode without relay hints to keep it shorter
    return this.utilities.encodeEventForUrl(ev, []);
  });

  constructor() {
    // Parse content when event changes
    effect(() => {
      const ev = this.event();
      if (ev) {
        this.isReady.set(false);
        this.parseContent(ev.content).then(() => {
          this.isReady.set(true);
          this.ready.emit();
        });
      }
    });
  }

  /**
   * Parse content and resolve nostr mentions to display names
   */
  private async parseContent(content: string): Promise<void> {
    if (!content) {
      this.contentSegments.set([]);
      return;
    }

    // Regex to match nostr URIs and raw bech32 identifiers (with optional @ prefix)
    // Uses the exact bech32 character set to properly terminate matches
    // Supports: nostr:npub1..., npub1..., @npub1..., and same for nprofile, note, nevent, naddr
    const nostrRegex = /@?(nostr:)?(?:npub|nprofile|note|nevent|naddr)1(?:(?!(?:npub|nprofile|note|nevent|naddr)1)[qpzry9x8gf2tvdw0s3jn54khce6mua7lQPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L])+/gi;

    const segments: ContentSegment[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Find all nostr URIs
    const matches: { start: number; end: number; uri: string; rawMatch: string }[] = [];
    while ((match = nostrRegex.exec(content)) !== null) {
      // Normalize: strip @ prefix and add nostr: prefix if needed
      let uri = match[0];
      if (uri.startsWith('@')) {
        uri = uri.slice(1);
      }
      if (!uri.startsWith('nostr:')) {
        uri = 'nostr:' + uri;
      }
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        uri: uri,
        rawMatch: match[0],
      });
    }

    // Process matches and resolve display names
    for (const m of matches) {
      // Add text before this match
      if (m.start > lastIndex) {
        segments.push({
          type: 'text',
          content: content.slice(lastIndex, m.start),
        });
      }

      // Try to resolve the mention
      const displayName = await this.resolveNostrUri(m.uri);
      segments.push({
        type: 'mention',
        content: m.uri,
        displayName: displayName || m.uri,
      });

      lastIndex = m.end;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex),
      });
    }

    // If no matches, just use the raw content
    if (segments.length === 0) {
      segments.push({ type: 'text', content });
    }

    this.contentSegments.set(segments);
  }

  /**
   * Resolve a nostr URI to a display name
   */
  private async resolveNostrUri(uri: string): Promise<string | null> {
    try {
      const bech32 = uri.replace(/^nostr:/, '');
      const decoded = nip19.decode(bech32);

      if (decoded.type === 'npub' || decoded.type === 'nprofile') {
        const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;

        // Try to get profile from cache/database
        const profile = await this.data.getProfile(pubkey);
        if (profile?.data) {
          return '@' + (profile.data.display_name || profile.data.name || this.utilities.getTruncatedNpub(pubkey));
        }

        // Fallback to truncated npub
        return '@' + this.utilities.getTruncatedNpub(pubkey);
      }

      // For other types (note, nevent, naddr), just show a short identifier
      if (decoded.type === 'note') {
        return `note:${decoded.data.substring(0, 8)}...`;
      }
      if (decoded.type === 'nevent') {
        return `event:${decoded.data.id.substring(0, 8)}...`;
      }
      if (decoded.type === 'naddr') {
        return `${decoded.data.kind}:${decoded.data.identifier?.substring(0, 8) || 'addr'}...`;
      }

      return null;
    } catch (error) {
      console.warn('Failed to resolve nostr URI:', uri, error);
      return null;
    }
  }
}
