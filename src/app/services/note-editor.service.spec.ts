import { TestBed } from '@angular/core/testing';
import { nip19 } from 'nostr-tools';
import { NoteEditorService } from './note-editor.service';
import { DataService } from './data.service';
import { MentionInputService } from './mention-input.service';
import { UtilitiesService } from './utilities.service';

describe('NoteEditorService', () => {
  let service: NoteEditorService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NoteEditorService,
        { provide: DataService, useValue: {} },
        { provide: MentionInputService, useValue: {} },
        { provide: UtilitiesService, useValue: { buildImetaTag: () => null } },
      ],
    });

    service = TestBed.inject(NoteEditorService);
  });

  it('should include relay hint in q tag for nostr:nevent references', () => {
    const eventId = 'a'.repeat(64);
    const pubkey = 'b'.repeat(64);
    const relay = 'wss://relay.nostr.example';
    const nevent = nip19.neventEncode({
      id: eventId,
      author: pubkey,
      relays: [relay],
    });

    const tags = service.buildTags({
      mentions: [],
      content: `check nostr:${nevent}`,
    });

    expect(tags).toContain(['q', eventId, relay, pubkey]);
  });

  it('should include relay hint in q tag for nostr:naddr references', () => {
    const pubkey = 'c'.repeat(64);
    const relay = 'wss://relay.article.example';
    const kind = 30023;
    const identifier = 'my-article';
    const naddr = nip19.naddrEncode({
      kind,
      pubkey,
      identifier,
      relays: [relay],
    });

    const tags = service.buildTags({
      mentions: [],
      content: `read nostr:${naddr}`,
    });

    expect(tags).toContain(['q', `${kind}:${pubkey}:${identifier}`, relay, pubkey]);
  });

  it('should enrich existing q tag with relay hint from nostr:nevent', () => {
    const eventId = 'd'.repeat(64);
    const pubkey = 'e'.repeat(64);
    const relay = 'wss://relay.enrich.example';
    const nevent = nip19.neventEncode({
      id: eventId,
      author: pubkey,
      relays: [relay],
    });

    const tags = service.buildTags({
      quote: { id: eventId, pubkey },
      mentions: [],
      content: `quote nostr:${nevent}`,
    });

    const quoteTags = tags.filter(tag => tag[0] === 'q' && tag[1] === eventId);
    expect(quoteTags.length).toBe(1);
    expect(quoteTags[0]).toEqual(['q', eventId, relay, pubkey]);
  });

  it('should use addressable q target for parameterized replaceable quote events', () => {
    const eventId = 'f'.repeat(64);
    const pubkey = '1'.repeat(64);
    const kind = 36787;
    const identifier = 'track-123';

    const tags = service.buildTags({
      quote: { id: eventId, pubkey, kind, identifier },
      mentions: [],
      content: 'quote track',
    });

    expect(tags).toContain(['q', `${kind}:${pubkey}:${identifier}`, '', pubkey]);
  });
});
