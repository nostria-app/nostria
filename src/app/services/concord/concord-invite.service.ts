import { inject, Service, signal } from '@angular/core';
import { Event, finalizeEvent, getPublicKey, nip19, UnsignedEvent } from 'nostr-tools';
import { encrypt as nip44Encrypt } from 'nostr-tools/nip44';

import { LoggerService } from '../logger.service';
import { NostrService } from '../nostr.service';
import { AccountStateService } from '../account-state.service';
import { EncryptionService } from '../encryption.service';
import { RelayPoolService } from '../relays/relay-pool';
import { UtilitiesService } from '../utilities.service';
import { ConcordListsService } from './concord-lists.service';
import { ConcordAdminService } from './concord-admin.service';
import {
  CORD_KIND_DIRECT_INVITE,
  CORD_KIND_INVITE_BUNDLE,
  CORD_MAX_FRAGMENT_RELAYS,
  CordBlobPointer,
  CordCommunity,
  CordInviteBundle,
  PERM_CREATE_INVITE,
  VSK_INVITE_LIVE,
  VSK_INVITE_REGISTRY,
  VSK_INVITE_REVOKED,
} from '../../interfaces/concord';
import { fromHex, randomBytes32, toHex, xonlyPubkey } from './concord-crypto';
import { buildInviteLink, inviteBundleKey } from './concord-invite';
import { CordControlState } from './concord-control';

/** Where minted links point by default; any base opens the same invite. */
const DEFAULT_INVITE_BASE = 'https://nostria.app';

function asBlobPointer(icon: CordBlobPointer | string | undefined): CordBlobPointer | undefined {
  return typeof icon === 'string' ? undefined : icon;
}

/**
 * CORD-05 invite minting.
 *
 * A link's keys never travel in the URL: they sit in a relay-side bundle
 * encrypted under an off-network token, so the hosting domain and the relays
 * learn where a bundle is but can never open one. Because the coordinate is
 * stable, re-posting refreshes the same link, and a revocation tombstone is
 * exactly as durable as the bundle it replaces.
 */
@Service()
export class ConcordInviteService {
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly encryption = inject(EncryptionService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly utilities = inject(UtilitiesService);
  private readonly lists = inject(ConcordListsService);
  private readonly admin = inject(ConcordAdminService);

  /**
   * Invite URL waiting to be opened on the Private chats page, typically from
   * a QR scan. EncryptedComponent consumes and clears this.
   */
  readonly pendingJoinLink = signal<string | null>(null);

  queueJoin(link: string): void {
    this.pendingJoinLink.set(link.trim());
  }

  /**
   * Mint a shareable invite link.
   *
   * @param channels private channels to grant; public ones need no delivery
   * because every member derives them from the community_root.
   */
  async mintLink(params: {
    community: CordCommunity;
    state: CordControlState;
    label?: string;
    expiresAt?: number;
    channels?: CordInviteBundle['channels'];
    base?: string;
  }): Promise<{ url: string; token: string; signerPubkey: string }> {
    const creator = this.accountState.pubkey();
    if (!creator) throw new Error('Sign in to create an invite');

    const { community, state } = params;

    // The link signer is a fresh keypair used for nothing else; its secret
    // lives only in the creator's Invite List, so a link-holder can join but
    // can never replace or tombstone the bundle.
    const signerSk = randomBytes32();
    const signerPk = xonlyPubkey(signerSk);

    // 16 bytes, per the fragment layout.
    const token = toHex(randomBytes32().subarray(0, 16));

    const bundle: CordInviteBundle = {
      community_id: community.communityId,
      owner: community.owner,
      owner_salt: community.ownerSalt,
      community_root: community.communityRoot,
      root_epoch: community.rootEpoch,
      control_pk: community.controlPk,
      channels: params.channels ?? [],
      relays: community.relays,
      name: state.metadata?.name ?? community.name,
      icon: asBlobPointer(state.metadata?.icon),
      expires_at: params.expiresAt,
      creator_npub: creator,
      label: params.label,
    };

    const event = finalizeEvent(
      {
        kind: CORD_KIND_INVITE_BUNDLE,
        content: nip44Encrypt(JSON.stringify(bundle), inviteBundleKey(token)),
        // The per-link pubkey alone makes the coordinate unique, so `d` is
        // empty and the naddr stays as short as possible.
        tags: [
          ['d', ''],
          ['vsk', String(VSK_INVITE_LIVE)],
        ],
        created_at: Math.floor(Date.now() / 1000),
      },
      signerSk
    );

    await this.relayPool.publish(community.relays, event, 10000);

    const url = buildInviteLink(
      params.base ?? DEFAULT_INVITE_BASE,
      signerPk,
      token,
      community.relays.slice(0, CORD_MAX_FRAGMENT_RELAYS)
    );

    // Private bookkeeping: the signer secret is what lets us refresh or retire
    // this link later.
    await this.lists.addInvite({
      token,
      signer_sk: toHex(signerSk),
      community_id: community.communityId,
      url,
      label: params.label,
      created_at: Math.floor(Date.now() / 1000),
      expires_at: params.expiresAt,
    });

    // The member-facing shadow: locators only, never tokens or secrets.
    await this.publishRegistry(community, state, [...this.liveLinks(state, creator), signerPk]);

    return { url, token, signerPubkey: signerPk };
  }

  /**
   * Retire a link by replacing its bundle with a revocation tombstone.
   *
   * Unlike a relay deletion (best-effort and ignorable), the tombstone sits at
   * the same coordinate, so a fetcher finds the grave instead of keys.
   */
  async revokeLink(params: {
    community: CordCommunity;
    state: CordControlState;
    token: string;
  }): Promise<void> {
    const creator = this.accountState.pubkey();
    if (!creator) throw new Error('Sign in to revoke an invite');

    const list = await this.lists.loadInviteList();
    const entry = list.entries.find(item => item.token === params.token);

    if (!entry) throw new Error('That invite is not in your list on this device');

    const signerSk = fromHex(entry.signer_sk);
    const signerPk = getPublicKey(signerSk);

    const tombstone = finalizeEvent(
      {
        kind: CORD_KIND_INVITE_BUNDLE,
        content: '',
        tags: [
          ['d', ''],
          ['vsk', String(VSK_INVITE_REVOKED)],
        ],
        created_at: Math.floor(Date.now() / 1000),
      },
      signerSk
    );

    await this.relayPool.publish(params.community.relays, tombstone, 10000);
    await this.lists.revokeInvite(params.token, params.community.communityId);

    const remaining = this.liveLinks(params.state, creator).filter(pk => pk !== signerPk);
    await this.publishRegistry(params.community, params.state, remaining);

    if (remaining.length === 0) {
      this.logger.info(
        '[Concord] The last live link was retired; this community is Private again. ' +
        'A Refounding is required to cut off anyone who kept an old link.'
      );
    }
  }

  /** The invite registry entries this creator currently advertises. */
  private liveLinks(state: CordControlState, creator: string): string[] {
    return state.inviteRegistry.get(creator) ?? [];
  }

  private async publishRegistry(
    community: CordCommunity,
    state: CordControlState,
    signerPubkeys: string[]
  ): Promise<void> {
    const creator = this.accountState.pubkey();
    if (!creator) return;

    await this.admin.publishEdition(community, state, {
      vsk: VSK_INVITE_REGISTRY,
      eid: this.admin.inviteRegistryCoordinate(community.communityId, creator),
      content: JSON.stringify([...new Set(signerPubkeys)]),
      requires: PERM_CREATE_INVITE,
    });
  }

  // ---------------------------------------------------------------------------
  // Direct invites
  // ---------------------------------------------------------------------------

  /**
   * Hand the bundle straight to an npub over a standard NIP-59 giftwrap.
   *
   * All the link machinery is armor for a hostile journey; a direct invite has
   * an encrypted, authenticated lane to one recipient, so it carries the bundle
   * itself — no coordinate, no token, nothing to fetch. It cannot be revoked
   * (the recipient holds the keys the moment it lands), appears in no registry,
   * and never flips the community Public.
   */
  async sendDirectInvite(params: {
    community: CordCommunity;
    state: CordControlState;
    recipient: string;
    channels?: CordInviteBundle['channels'];
    expiresAt?: number;
  }): Promise<void> {
    const inviter = this.accountState.pubkey();
    if (!inviter) throw new Error('Sign in to send an invite');

    const { community, state } = params;

    const bundle: CordInviteBundle = {
      community_id: community.communityId,
      owner: community.owner,
      owner_salt: community.ownerSalt,
      community_root: community.communityRoot,
      root_epoch: community.rootEpoch,
      control_pk: community.controlPk,
      channels: params.channels ?? [],
      relays: community.relays,
      name: state.metadata?.name ?? community.name,
      icon: asBlobPointer(state.metadata?.icon),
      expires_at: params.expiresAt,
      creator_npub: inviter,
    };

    // The rumor is unsigned; the seal carries the inviter's real signature.
    const rumor = {
      kind: CORD_KIND_DIRECT_INVITE,
      pubkey: inviter,
      content: JSON.stringify(bundle),
      tags: [] as string[][],
      created_at: Math.floor(Date.now() / 1000),
    };

    // Standard NIP-59: a kind 13 seal encrypted to the recipient.
    const sealContent = await this.encryption.encryptNip44(
      JSON.stringify(rumor),
      params.recipient
    );

    const seal = await this.nostr.signEvent({
      kind: 13,
      pubkey: inviter,
      content: sealContent,
      tags: [],
      // NIP-59 tweaks seal and wrap timestamps into the past.
      created_at: tweakedTimestamp(),
    } as UnsignedEvent);

    const ephemeralSk = randomBytes32();

    const wrapContent = nip44Encrypt(
      JSON.stringify(seal),
      // Ephemeral author ↔ recipient conversation key.
      (await import('nostr-tools/nip44')).getConversationKey(ephemeralSk, params.recipient)
    );

    const tags: string[][] = [
      ['p', params.recipient],
      // The one identifying outer tag Concord permits, so a recipient can index
      // their invites instead of decrypting their whole giftwrap inbox.
      ['k', String(CORD_KIND_DIRECT_INVITE)],
    ];

    if (params.expiresAt) {
      tags.push(['expiration', String(Math.floor(params.expiresAt / 1000))]);
    }

    const wrap = finalizeEvent(
      { kind: 1059, content: wrapContent, tags, created_at: tweakedTimestamp() },
      ephemeralSk
    );

    // Deliver to the recipient's DM relays when they publish one, per NIP-17.
    const relays = await this.recipientInbox(params.recipient, community.relays);
    await this.relayPool.publish(relays, wrap, 10000, { allowWs: true });
  }

  /**
   * Fetch direct invites addressed to us, using the `k` tag index so we never
   * have to decrypt the whole giftwrap inbox.
   */
  async fetchDirectInvites(relays: string[]): Promise<Event[]> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return [];

    return this.relayPool.query(
      relays,
      {
        kinds: [1059],
        '#p': [pubkey],
        '#k': [String(CORD_KIND_DIRECT_INVITE)],
        limit: 50,
      },
      8000
    );
  }

  /** Open a direct invite wrap into its bundle. */
  async openDirectInvite(wrap: Event): Promise<CordInviteBundle | null> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return null;

    try {
      // A standard NIP-59 wrap: decrypt with our own key against the ephemeral
      // author, then the seal against the real inviter.
      const sealJson = await this.encryption.decryptNip44(wrap.content, wrap.pubkey);
      const seal = JSON.parse(sealJson) as Event;

      const rumorJson = await this.encryption.decryptNip44(seal.content, seal.pubkey);
      const rumor = JSON.parse(rumorJson) as { kind: number; content: string; pubkey: string };

      // The tag is an unsigned hint; the rumor's kind is the authority.
      if (rumor.kind !== CORD_KIND_DIRECT_INVITE) return null;
      if (rumor.pubkey !== seal.pubkey) return null;

      return JSON.parse(rumor.content) as CordInviteBundle;
    } catch (error) {
      this.logger.debug('[Concord] Could not open a direct invite', error);
      return null;
    }
  }

  private async recipientInbox(recipient: string, fallback: string[]): Promise<string[]> {
    try {
      const dmRelays = await this.relayPool.query(
        fallback,
        { kinds: [10050], authors: [recipient], limit: 1 },
        5000
      );

      const urls = this.utilities.normalizeRelayUrls(
        dmRelays[0]?.tags
          .filter(tag => tag[0] === 'relay' && tag[1])
          .map(tag => tag[1]) ?? [],
        false,
        {
          source: 'account-relays',
          ownerPubkey: recipient,
          eventKind: 10050,
          details: 'concord NIP-17 inbox',
          allowWs: true,
        },
      );

      if (urls.length > 0) return urls;
    } catch {
      // Fall through to the community's own relays.
    }

    return fallback;
  }
}

/** NIP-59 tweaks timestamps up to two days into the past. */
function tweakedTimestamp(): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800);
}
