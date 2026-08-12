/**
 * Parse NIP-29 group invite URLs published by known clients.
 *
 * Nostria's own share form is `/g/<relay-host>/<group-id>?invite=<code>`.
 * Other NIP-29 clients use the same pair (sometimes behind a hash, sometimes
 * as query params). This module turns those into a Nostria route.
 */

export interface Nip29InviteLink {
  clientId: string;
  clientName: string;
  /** Route-safe relay host, e.g. `chat.wisp.talk` or `groups.0xchat.com`. */
  relaySlug: string;
  groupId: string;
  inviteCode?: string;
  originalUrl: string;
}

interface KnownNip29Client {
  id: string;
  name: string;
  hosts: readonly string[];
}

/**
 * Web clients known to host NIP-29 groups and publish shareable group URLs.
 * Host matching is exact or a subdomain of the listed value.
 */
export const KNOWN_NIP29_CLIENTS: readonly KnownNip29Client[] = [
  {
    id: 'nostrord',
    name: 'Nostrord',
    hosts: ['web.nostrord.com', 'nostrord.com'],
  },
  {
    id: 'chachi',
    name: 'Chachi',
    hosts: ['chachi.chat'],
  },
  {
    id: 'flotilla',
    name: 'Flotilla',
    hosts: ['flotilla.social'],
  },
  {
    id: 'groups',
    name: 'Groups',
    hosts: ['groups.nip29.com'],
  },
  {
    id: '0xchat',
    name: '0xChat',
    hosts: ['0xchat.com', 'web.0xchat.com'],
  },
];

/** Plausible relay host / slug, matching `group-resolver` rules. */
const RELAY_SLUG_RE = /^[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}(~[\w\-.]*)*$/;

/** Group ids are relay-defined strings; reject empty / path-like junk. */
const GROUP_ID_RE = /^[^\s/?#]{1,128}$/;

export function parseNip29InviteUrl(raw: string, base?: string): Nip29InviteLink | null {
  const url = toUrl(raw, base);
  if (!url) return null;

  const client = matchKnownClient(url.hostname);
  if (!client) return null;

  const hash = parseHash(url.hash);
  const path = hash.path || url.pathname;
  const params = mergeParams(url.searchParams, hash.params);

  const fromPath = parseGroupPath(path);
  const relayRaw = fromPath?.relay ?? firstParam(params, ['relay', 'relayUrl', 'host']);
  const groupRaw = fromPath?.groupId ?? firstParam(params, ['group', 'groupId', 'group_id', 'id']);
  const invite = firstParam(params, ['invite', 'inviteCode', 'code', 'invitation']);

  if (!relayRaw || !groupRaw) return null;

  const relaySlug = toRelaySlug(relayRaw);
  const groupId = safeDecode(groupRaw);

  if (!relaySlug || !GROUP_ID_RE.test(groupId)) return null;

  return {
    clientId: client.id,
    clientName: client.name,
    relaySlug,
    groupId,
    inviteCode: invite || undefined,
    originalUrl: url.toString(),
  };
}

export function isNip29InviteUrl(raw: string, base?: string): boolean {
  return parseNip29InviteUrl(raw, base) !== null;
}

/** Internal Nostria path for a parsed invite. */
export function nip29InviteToNostriaPath(invite: Nip29InviteLink): string {
  const path = `/g/${invite.relaySlug}/${encodeURIComponent(invite.groupId)}`;
  return invite.inviteCode
    ? `${path}?invite=${encodeURIComponent(invite.inviteCode)}`
    : path;
}

export function nip29InviteToNostriaCommands(invite: Nip29InviteLink): {
  commands: string[];
  queryParams: Record<string, string>;
} {
  return {
    commands: ['/g', invite.relaySlug, invite.groupId],
    queryParams: invite.inviteCode ? { invite: invite.inviteCode } : {},
  };
}

function matchKnownClient(hostname: string): KnownNip29Client | null {
  const host = hostname.replace(/^www\./, '').toLowerCase();

  return (
    KNOWN_NIP29_CLIENTS.find(
      client => client.hosts.some(known => host === known || host.endsWith(`.${known}`))
    ) ?? null
  );
}

/**
 * Accept `/g/<relay>/<group>` (Nostria / Nostrord hash routes) and
 * `/<relay.host>/<group>` (Chachi).
 */
function parseGroupPath(path: string): { relay: string; groupId: string } | null {
  const cleaned = path.replace(/\/+$/, '') || '/';

  const gMatch = cleaned.match(/^\/g\/([^/]+)\/([^/]+)$/i);
  if (gMatch) {
    return { relay: gMatch[1], groupId: gMatch[2] };
  }

  const hostMatch = cleaned.match(/^\/([^/]+\.[^/]+)\/([^/]+)$/);
  if (hostMatch) {
    return { relay: hostMatch[1], groupId: hostMatch[2] };
  }

  return null;
}

function toRelaySlug(raw: string): string | null {
  const decoded = safeDecode(raw).trim();
  if (!decoded) return null;

  try {
    const withScheme =
      decoded.startsWith('ws://') || decoded.startsWith('wss://')
        ? decoded
        : `wss://${decoded.replace(/^\/+/, '')}`;
    const url = new URL(withScheme);
    const path = url.pathname.replace(/\/+$/, '');
    const slug = (path ? `${url.host}${path}` : url.host).replace(/\//g, '~');
    return RELAY_SLUG_RE.test(slug) ? slug : null;
  } catch {
    const slug = decoded.replace(/^wss?:\/\//i, '').replace(/\/+$/, '').replace(/\//g, '~');
    return RELAY_SLUG_RE.test(slug) ? slug : null;
  }
}

function parseHash(hash: string): { path: string; params: URLSearchParams } {
  if (!hash || hash === '#') {
    return { path: '', params: new URLSearchParams() };
  }

  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart, queryPart] = withoutHash.split('?');
  const path = pathPart.startsWith('/') ? pathPart : pathPart ? `/${pathPart}` : '';

  return { path, params: new URLSearchParams(queryPart ?? '') };
}

function mergeParams(...lists: URLSearchParams[]): URLSearchParams {
  const merged = new URLSearchParams();

  for (const list of lists) {
    for (const [key, value] of list.entries()) {
      if (value && !merged.has(key)) merged.set(key, value);
    }
  }

  return merged;
}

function firstParam(params: URLSearchParams, keys: string[]): string | null {
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }

  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toUrl(raw: string, base?: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}
