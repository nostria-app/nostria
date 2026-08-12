import {
  isNip29InviteUrl,
  nip29InviteToNostriaCommands,
  nip29InviteToNostriaPath,
  parseNip29InviteUrl,
} from './nip29-invite-url';

describe('parseNip29InviteUrl', () => {
  it('parses Nostrord hash routes', () => {
    const parsed = parseNip29InviteUrl(
      'https://web.nostrord.com/#/g/chat.wisp.talk/pligeiproul'
    );

    expect(parsed).toEqual({
      clientId: 'nostrord',
      clientName: 'Nostrord',
      relaySlug: 'chat.wisp.talk',
      groupId: 'pligeiproul',
      inviteCode: undefined,
      originalUrl: 'https://web.nostrord.com/#/g/chat.wisp.talk/pligeiproul',
    });
  });

  it('parses Nostrord hash routes with an invite code', () => {
    const parsed = parseNip29InviteUrl(
      'https://web.nostrord.com/#/g/chat.wisp.talk/pligeiproul?invite=abc123'
    );

    expect(parsed?.inviteCode).toBe('abc123');
    expect(parsed?.relaySlug).toBe('chat.wisp.talk');
    expect(parsed?.groupId).toBe('pligeiproul');
  });

  it('parses Nostrord query-param invites', () => {
    const parsed = parseNip29InviteUrl(
      'https://web.nostrord.com/?relay=groups.0xchat.com&group=nostrord'
    );

    expect(parsed).toMatchObject({
      clientId: 'nostrord',
      relaySlug: 'groups.0xchat.com',
      groupId: 'nostrord',
    });
  });

  it('parses Chachi /<relay>/<group> paths', () => {
    const parsed = parseNip29InviteUrl('https://chachi.chat/groups.0xchat.com/chachi');

    expect(parsed).toMatchObject({
      clientId: 'chachi',
      clientName: 'Chachi',
      relaySlug: 'groups.0xchat.com',
      groupId: 'chachi',
    });
  });

  it('accepts a wss relay hint in query params', () => {
    const parsed = parseNip29InviteUrl(
      'https://groups.nip29.com/?relay=wss://groups.0xchat.com/&groupId=general'
    );

    expect(parsed).toMatchObject({
      clientId: 'groups',
      relaySlug: 'groups.0xchat.com',
      groupId: 'general',
    });
  });

  it('normalizes relay paths into Nostria slugs', () => {
    const parsed = parseNip29InviteUrl(
      'https://flotilla.social/?relay=wss://relay.example.com/groups&group=lobby'
    );

    expect(parsed?.relaySlug).toBe('relay.example.com~groups');
  });

  it('ignores unknown hosts', () => {
    expect(
      parseNip29InviteUrl('https://example.com/#/g/chat.wisp.talk/pligeiproul')
    ).toBeNull();
  });

  it('ignores known-client URLs that are not group invites', () => {
    expect(parseNip29InviteUrl('https://web.nostrord.com/#/login')).toBeNull();
    expect(parseNip29InviteUrl('https://chachi.chat/')).toBeNull();
    expect(parseNip29InviteUrl('https://chachi.chat/settings')).toBeNull();
  });

  it('rejects implausible relay hosts', () => {
    expect(parseNip29InviteUrl('https://web.nostrord.com/#/g/not-a-host/group')).toBeNull();
    expect(parseNip29InviteUrl('https://chachi.chat/localhost/group')).toBeNull();
  });
});

describe('nip29InviteToNostriaPath', () => {
  it('builds the short /g/ alias, including the invite code', () => {
    const parsed = parseNip29InviteUrl(
      'https://web.nostrord.com/#/g/chat.wisp.talk/pligeiproul?invite=secret'
    );

    expect(parsed).toBeTruthy();
    expect(nip29InviteToNostriaPath(parsed!)).toBe(
      '/g/chat.wisp.talk/pligeiproul?invite=secret'
    );
    expect(nip29InviteToNostriaCommands(parsed!)).toEqual({
      commands: ['/g', 'chat.wisp.talk', 'pligeiproul'],
      queryParams: { invite: 'secret' },
    });
  });
});

describe('isNip29InviteUrl', () => {
  it('returns true for the Nostrord example', () => {
    expect(
      isNip29InviteUrl('https://web.nostrord.com/#/g/chat.wisp.talk/pligeiproul')
    ).toBe(true);
  });
});
