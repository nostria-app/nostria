import { computed, inject, Service, signal } from '@angular/core';
import type { LocalParticipant, Participant, RemoteParticipant, RemoteTrack, Room } from 'livekit-client';

import { LoggerService } from '../logger.service';
import { NostrService } from '../nostr.service';
import { AccountStateService } from '../account-state.service';
import { RelayPoolService } from '../relays/relay-pool';
import {
  CORD_KIND_HTTP_AUTH,
  CORD_KIND_VOICE_PRESENCE,
  CordChannel,
  CordCommunity,
  CordGroupKey,
  LABEL_CHANNEL,
  LABEL_VOICE_MEDIA,
  LABEL_VOICE_SENDER,
  LABEL_VOICE_SIGNER,
} from '../../interfaces/concord';
import { cordHkdf, fromHex, groupKey, toId32 } from './concord-crypto';
import { buildStreamEvent, openStreamEvent, splitTimestamp, tagValue } from './concord-stream';
import { sha256 } from '@noble/hashes/sha2.js';

/** Heartbeat cadence and staleness window (CORD-07 §4). */
const HEARTBEAT_MS = 30_000;
const PRESENCE_STALE_MS = 90_000;

/** Brokers advertise capability with a 204 at this path. */
const CAPABILITY_PATH = '/.well-known/concord/av';

export interface CordVoiceParticipant {
  identity: string;
  /** The Nostr pubkey claiming this identity, once presence verifies it. */
  pubkey?: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  /** True when exactly one author's fresh presence claims this identity. */
  verified: boolean;
}

interface PresenceEntry {
  pubkey: string;
  identity: string;
  broker: string;
  at: number;
}

/**
 * CORD-07 Audio/Video: calls in any channel, with no host and no roster.
 *
 * No server can check membership, so clients prove possession of the channel's
 * key instead: the room name *is* a pubkey derived from that key, and only a
 * keyholder can sign the token request. The broker and SFU only ever forward
 * ciphertext — media is encrypted under per-sender keys derived from the
 * channel secret, which the SFU never sees.
 */
@Service()
export class ConcordVoiceService {
  private readonly logger = inject(LoggerService);
  private readonly nostr = inject(NostrService);
  private readonly accountState = inject(AccountStateService);
  private readonly relayPool = inject(RelayPoolService);

  readonly state = signal<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  readonly error = signal<string | null>(null);
  readonly participants = signal<CordVoiceParticipant[]>([]);
  readonly micEnabled = signal(false);
  readonly cameraEnabled = signal(false);
  readonly screenShareEnabled = signal(false);
  readonly activeChannelId = signal<string | null>(null);

  readonly isConnected = computed(() => this.state() === 'connected');

  private room: Room | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private presenceSub: { close: () => void } | null = null;
  private readonly presence = new Map<string, PresenceEntry>();
  private readonly audioElements = new Map<string, HTMLMediaElement>();

  // ---------------------------------------------------------------------------
  // Key derivation (CORD-07 §1)
  // ---------------------------------------------------------------------------

  /** The channel secret and epoch that address this channel's chat plane. */
  private channelSecret(community: CordCommunity, channel: CordChannel): {
    secret: Uint8Array;
    epoch: number;
  } {
    return channel.key
      ? { secret: fromHex(channel.key), epoch: channel.epoch }
      : { secret: fromHex(community.communityRoot), epoch: community.rootEpoch };
  }

  /** The SFU room name is the derived pubkey; its sk signs token grants. */
  voiceKey(community: CordCommunity, channel: CordChannel): CordGroupKey {
    const { secret, epoch } = this.channelSecret(community, channel);
    return groupKey(LABEL_VOICE_SIGNER, secret, toId32(channel.channelId), epoch);
  }

  /** The raw 32-byte root every publisher's frame key derives from. */
  private mediaKey(community: CordCommunity, channel: CordChannel): Uint8Array {
    const { secret, epoch } = this.channelSecret(community, channel);
    return cordHkdf(secret, LABEL_VOICE_MEDIA, toId32(channel.channelId), epoch);
  }

  /**
   * A publisher's per-sender key.
   *
   * Never encrypt under the media key directly: two senders colliding an IV
   * under one GCM key is catastrophic, and distinct keys make a collision
   * harmless. The epoch is omitted here because the media key already carries it.
   */
  senderKey(community: CordCommunity, channel: CordChannel, identity: string): Uint8Array {
    return cordHkdf(
      this.mediaKey(community, channel),
      LABEL_VOICE_SENDER,
      sha256(new TextEncoder().encode(identity))
    );
  }

  // ---------------------------------------------------------------------------
  // The broker
  // ---------------------------------------------------------------------------

  /** Probe whether a broker serves Concord A/V at all. */
  async probeBroker(origin: string): Promise<boolean> {
    try {
      const response = await fetch(`${normalizeOrigin(origin)}${CAPABILITY_PATH}`, {
        method: 'GET',
      });
      return response.status === 204 || response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Request an SFU token.
   *
   * The grant is signed by the *voice key*, so `event.pubkey` equals the room
   * name: the broker needs no lookup and no community knowledge, and cannot
   * tell which community a room belongs to or who is joining.
   */
  private async requestToken(
    origin: string,
    voice: CordGroupKey
  ): Promise<{ token: string; url: string; identity: string }> {
    const base = normalizeOrigin(origin);
    const endpoint = `${base}${CAPABILITY_PATH}/${voice.pk}`;

    const { finalizeEvent } = await import('nostr-tools');

    // Signed with the derived key, never the member's own identity.
    const auth = finalizeEvent(
      {
        kind: CORD_KIND_HTTP_AUTH,
        content: '',
        tags: [
          ['u', endpoint],
          ['method', 'GET'],
        ],
        created_at: Math.floor(Date.now() / 1000),
      },
      voice.sk
    );

    const response = await fetch(endpoint, {
      headers: { Authorization: `Concord ${base64(JSON.stringify(auth))}` },
    });

    if (!response.ok) {
      throw new Error(`The broker refused the call token (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as {
      token?: string;
      url?: string;
      identity?: string;
    };

    if (!payload.token || !payload.url || !payload.identity) {
      throw new Error('The broker returned an incomplete token');
    }

    // The identity feeds the per-sender key derivation, so a weak one would
    // collapse two publishers into one nonce domain.
    if (payload.identity.length < 32) {
      throw new Error('The broker issued an identity with too little entropy');
    }

    return { token: payload.token, url: payload.url, identity: payload.identity };
  }

  // ---------------------------------------------------------------------------
  // Rendezvous (CORD-07 §5)
  // ---------------------------------------------------------------------------

  /**
   * Converge on one broker with no configuration: join whoever is already
   * present, break ties deterministically, otherwise use our own preference.
   */
  async chooseBroker(voiceRoom: string, preferred: string): Promise<string> {
    const live = [...this.presence.values()].filter(
      entry => Date.now() - entry.at < PRESENCE_STALE_MS
    );

    if (live.length === 0) return preferred;

    const origins = [...new Set(live.map(entry => normalizeOrigin(entry.broker)))];
    if (origins.length === 1) return origins[0];

    // Smallest sha256(voice_room || origin) wins, over the canonical ASCII
    // serialization — two clients must hash identical bytes or the tie never
    // settles.
    let best = origins[0];
    let bestHash = tieBreakHash(voiceRoom, best);

    for (const origin of origins.slice(1)) {
      const hash = tieBreakHash(voiceRoom, origin);
      if (hash < bestHash) {
        best = origin;
        bestHash = hash;
      }
    }

    return best;
  }

  // ---------------------------------------------------------------------------
  // Joining
  // ---------------------------------------------------------------------------

  async join(
    community: CordCommunity,
    channel: CordChannel,
    preferredBroker: string
  ): Promise<void> {
    await this.leave();

    this.state.set('connecting');
    this.error.set(null);
    this.activeChannelId.set(channel.channelId);

    try {
      const voice = this.voiceKey(community, channel);

      // Listen first so rendezvous can see who is already in the room.
      this.subscribeToPresence(community, channel);

      const origin = await this.chooseBroker(voice.pk, preferredBroker);
      if (!(await this.probeBroker(origin))) {
        throw new Error('That call broker is unreachable');
      }

      const { token, url, identity } = await this.requestToken(origin, voice);
      const livekit = await import('livekit-client');

      const room = new livekit.Room({ adaptiveStream: true, dynacast: true });

      room
        .on(livekit.RoomEvent.ParticipantConnected, () => this.syncParticipants())
        .on(livekit.RoomEvent.ParticipantDisconnected, () => this.syncParticipants())
        .on(livekit.RoomEvent.ActiveSpeakersChanged, () => this.syncParticipants())
        .on(livekit.RoomEvent.TrackMuted, () => this.syncParticipants())
        .on(livekit.RoomEvent.TrackUnmuted, () => this.syncParticipants())
        .on(livekit.RoomEvent.Disconnected, () => this.handleDisconnected())
        .on(livekit.RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) =>
          this.attachTrack(track, participant)
        );

      await room.connect(url, token);

      this.room = room;
      this.state.set('connected');
      this.syncParticipants();

      // Join muted, and announce ourselves so others can verify the identity.
      await this.setMicrophoneEnabled(false);
      await this.announce(community, channel, 'joined', identity, origin);

      this.heartbeat = setInterval(() => {
        void this.announce(community, channel, 'joined', identity, origin);
      }, HEARTBEAT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[Concord] Failed to join a call', error);
      this.error.set(message);
      this.state.set('error');
      this.activeChannelId.set(null);
      this.room = null;
    }
  }

  async leave(community?: CordCommunity, channel?: CordChannel): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }

    if (community && channel) {
      // Best-effort; a missed `left` heals by staleness.
      await this.announce(community, channel, 'left').catch(() => undefined);
    }

    const room = this.room;
    this.room = null;

    if (room) {
      try {
        await room.disconnect();
      } catch (error) {
        this.logger.debug('[Concord] Error leaving the call', error);
      }
    }

    this.presenceSub?.close();
    this.presenceSub = null;
    this.presence.clear();

    this.handleDisconnected();
  }

  // ---------------------------------------------------------------------------
  // Presence (CORD-07 §4)
  // ---------------------------------------------------------------------------

  /** Publish a presence heartbeat on the channel's own plane. */
  private async announce(
    community: CordCommunity,
    channel: CordChannel,
    verb: 'joined' | 'left',
    identity?: string,
    broker?: string
  ): Promise<void> {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const { secret, epoch } = this.channelSecret(community, channel);
    const chatKey = groupKey(LABEL_CHANNEL, secret, toId32(channel.channelId), epoch);

    const { created_at, ms } = splitTimestamp(Date.now());

    const tags: string[][] = [
      ['channel', channel.channelId],
      ['epoch', String(epoch)],
      ['ms', ms],
    ];

    if (verb === 'joined' && identity && broker) {
      tags.push(['identity', identity], ['broker', normalizeOrigin(broker)]);
    }

    const wrap = await buildStreamEvent(
      chatKey,
      { kind: CORD_KIND_VOICE_PRESENCE, pubkey, content: verb, tags, created_at },
      async event => this.nostr.signEvent(event),
      // Realtime-only: relays must not store any layer of it.
      { ephemeral: true }
    );

    await this.relayPool.publish(community.relays, wrap, 6000).catch(() => undefined);
  }

  private subscribeToPresence(community: CordCommunity, channel: CordChannel): void {
    const { secret, epoch } = this.channelSecret(community, channel);
    const chatKey = groupKey(LABEL_CHANNEL, secret, toId32(channel.channelId), epoch);

    this.presenceSub = this.relayPool.subscribe(
      community.relays,
      { kinds: [21059], authors: [chatKey.pk] },
      event => {
        try {
          const opened = openStreamEvent(chatKey, event);

          if (opened.rumor.kind !== CORD_KIND_VOICE_PRESENCE) return;
          if (tagValue(opened.rumor.tags, 'channel') !== channel.channelId) return;

          const identity = tagValue(opened.rumor.tags, 'identity');
          const broker = tagValue(opened.rumor.tags, 'broker');

          if (opened.rumor.content === 'left') {
            this.presence.delete(opened.author);
          } else if (identity && broker) {
            // Latest presence per author wins, on the millisecond basis.
            const existing = this.presence.get(opened.author);
            if (!existing || opened.timestamp > existing.at) {
              this.presence.set(opened.author, {
                pubkey: opened.author,
                identity,
                broker,
                at: opened.timestamp,
              });
            }
          }

          this.syncParticipants();
        } catch {
          // Not ours, or malformed.
        }
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Media controls
  // ---------------------------------------------------------------------------

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
    } catch (error) {
      this.logger.warn('[Concord] Microphone toggle failed', error);
      this.error.set('Microphone unavailable. Check your browser permissions.');
    } finally {
      this.syncLocal();
      this.syncParticipants();
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setCameraEnabled(enabled);
    } catch (error) {
      this.logger.warn('[Concord] Camera toggle failed', error);
      this.error.set('Camera unavailable. Check your browser permissions.');
    } finally {
      this.syncLocal();
    }
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setScreenShareEnabled(enabled);
    } catch (error) {
      this.logger.warn('[Concord] Screen share toggle failed', error);
    } finally {
      this.syncLocal();
    }
  }

  toggleMicrophone(): Promise<void> {
    return this.setMicrophoneEnabled(!this.micEnabled());
  }

  toggleCamera(): Promise<void> {
    return this.setCameraEnabled(!this.cameraEnabled());
  }

  toggleScreenShare(): Promise<void> {
    return this.setScreenShareEnabled(!this.screenShareEnabled());
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private attachTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    if (track.kind !== 'audio') return;

    const element = track.attach();
    document.body.appendChild(element);
    this.audioElements.set(`${participant.identity}:${track.sid}`, element);
  }

  private handleDisconnected(): void {
    for (const element of this.audioElements.values()) {
      element.srcObject = null;
      element.remove();
    }

    this.audioElements.clear();
    this.participants.set([]);
    this.micEnabled.set(false);
    this.cameraEnabled.set(false);
    this.screenShareEnabled.set(false);
    this.activeChannelId.set(null);

    if (this.state() !== 'error') this.state.set('disconnected');
  }

  private syncLocal(): void {
    const local = this.room?.localParticipant;
    if (!local) return;

    this.micEnabled.set(local.isMicrophoneEnabled);
    this.cameraEnabled.set(local.isCameraEnabled);
    this.screenShareEnabled.set(local.isScreenShareEnabled);
  }

  private syncParticipants(): void {
    const room = this.room;
    if (!room) {
      this.participants.set([]);
      return;
    }

    const all: (RemoteParticipant | LocalParticipant)[] = [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ];

    this.participants.set(all.map(participant => this.toParticipant(participant, room)));
  }

  private toParticipant(participant: Participant, room: Room): CordVoiceParticipant {
    const now = Date.now();

    // Identities are member-visible, so a malicious member can copy a victim's
    // into their own presence. A contested claim proves nothing about either
    // author, so all claimants render as unverified until the stale ones age out.
    const claimants = [...this.presence.values()].filter(
      entry => entry.identity === participant.identity && now - entry.at < PRESENCE_STALE_MS
    );

    return {
      identity: participant.identity,
      pubkey: claimants.length === 1 ? claimants[0].pubkey : undefined,
      isLocal: participant.identity === room.localParticipant.identity,
      isSpeaking: participant.isSpeaking,
      isMuted: !participant.isMicrophoneEnabled,
      verified: claimants.length === 1,
    };
  }
}

/** RFC 6454 ASCII serialization: one canonical byte-form for the tie-break. */
function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    const port =
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
        ? ''
        : url.port;

    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port ? `:${port}` : ''}`;
  } catch {
    return origin.replace(/\/$/, '');
  }
}

function tieBreakHash(voiceRoom: string, origin: string): string {
  const room = fromHex(voiceRoom);
  const originBytes = new TextEncoder().encode(origin);

  const input = new Uint8Array(room.length + originBytes.length);
  input.set(room, 0);
  input.set(originBytes, room.length);

  return Array.from(sha256(input))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
