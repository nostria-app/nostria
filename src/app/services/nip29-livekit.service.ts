import { computed, inject, Service, signal } from '@angular/core';
import type { Room, RemoteTrack, RemoteParticipant, LocalParticipant, Participant } from 'livekit-client';

import { LoggerService } from './logger.service';
import { Nip29Service } from './nip29.service';

/** A participant in a NIP-29 LiveKit room. */
export interface Nip29VoiceParticipant {
  /** LiveKit identity (first 64 chars are the Nostr pubkey). */
  identity: string;
  /** Lowercase hex Nostr pubkey extracted from the identity. */
  pubkey: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  hasVideo: boolean;
}

export type Nip29VoiceState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Audio/video rooms for NIP-29 groups, backed by the LiveKit server advertised
 * by the relay. The `livekit-client` bundle is loaded lazily so it is only
 * downloaded when the user actually joins a voice channel.
 */
@Service()
export class Nip29LivekitService {
  private readonly logger = inject(LoggerService);
  private readonly nip29 = inject(Nip29Service);

  readonly state = signal<Nip29VoiceState>('disconnected');
  readonly error = signal<string | null>(null);
  readonly participants = signal<Nip29VoiceParticipant[]>([]);
  readonly micEnabled = signal(false);
  readonly cameraEnabled = signal(false);
  readonly screenShareEnabled = signal(false);

  /** `<relay>|<groupId>` of the room currently joined, when any. */
  readonly activeRoomKey = signal<string | null>(null);

  readonly isConnected = computed(() => this.state() === 'connected');

  private room: Room | null = null;
  private readonly mediaElements = new Map<string, HTMLMediaElement>();

  /** Video tracks keyed by participant identity, for the component to attach. */
  readonly videoTracks = signal<Record<string, MediaStreamTrack>>({});

  /**
   * Join the LiveKit room of a group. The relay issues the token through the
   * NIP-98 authenticated `/.well-known/nip29/livekit/<group-id>` endpoint.
   */
  async join(relayUrl: string, groupId: string): Promise<void> {
    const key = this.nip29.groupKey(relayUrl, groupId);
    if (this.activeRoomKey() === key && this.isConnected()) return;

    await this.leave();

    this.state.set('connecting');
    this.error.set(null);
    this.activeRoomKey.set(key);

    try {
      const { token, url } = await this.nip29.requestLivekitToken(relayUrl, groupId);
      const livekit = await import('livekit-client');

      const room = new livekit.Room({
        adaptiveStream: true,
        dynacast: true,
      });

      room
        .on(livekit.RoomEvent.ParticipantConnected, () => this.syncParticipants())
        .on(livekit.RoomEvent.ParticipantDisconnected, () => this.syncParticipants())
        .on(livekit.RoomEvent.ActiveSpeakersChanged, () => this.syncParticipants())
        .on(livekit.RoomEvent.TrackMuted, () => this.syncParticipants())
        .on(livekit.RoomEvent.TrackUnmuted, () => this.syncParticipants())
        .on(livekit.RoomEvent.LocalTrackPublished, () => this.syncLocalState())
        .on(livekit.RoomEvent.LocalTrackUnpublished, () => this.syncLocalState())
        .on(livekit.RoomEvent.Disconnected, () => this.handleDisconnected())
        .on(livekit.RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) =>
          this.attachTrack(track, participant)
        )
        .on(livekit.RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) =>
          this.detachTrack(track, participant)
        );

      await room.connect(url, token);

      this.room = room;
      this.state.set('connected');
      this.syncParticipants();
      this.syncLocalState();

      // Join muted, the way Discord does for large rooms.
      await this.setMicrophoneEnabled(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[NIP-29] Failed to join LiveKit room', { relayUrl, groupId, error });
      this.error.set(message);
      this.state.set('error');
      this.activeRoomKey.set(null);
      this.room = null;
    }
  }

  /** Leave the current room and release all media. */
  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;

    if (room) {
      try {
        await room.disconnect();
      } catch (error) {
        this.logger.debug('[NIP-29] Error while leaving LiveKit room', error);
      }
    }

    this.handleDisconnected();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
    } catch (error) {
      this.logger.warn('[NIP-29] Failed to toggle microphone', error);
      this.error.set('Microphone unavailable. Check your browser permissions.');
    } finally {
      this.syncLocalState();
      this.syncParticipants();
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setCameraEnabled(enabled);
    } catch (error) {
      this.logger.warn('[NIP-29] Failed to toggle camera', error);
      this.error.set('Camera unavailable. Check your browser permissions.');
    } finally {
      this.syncLocalState();
      this.syncParticipants();
    }
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setScreenShareEnabled(enabled);
    } catch (error) {
      this.logger.warn('[NIP-29] Failed to toggle screen share', error);
    } finally {
      this.syncLocalState();
    }
  }

  async toggleMicrophone(): Promise<void> {
    await this.setMicrophoneEnabled(!this.micEnabled());
  }

  async toggleCamera(): Promise<void> {
    await this.setCameraEnabled(!this.cameraEnabled());
  }

  async toggleScreenShare(): Promise<void> {
    await this.setScreenShareEnabled(!this.screenShareEnabled());
  }

  private handleDisconnected(): void {
    for (const element of this.mediaElements.values()) {
      element.srcObject = null;
      element.remove();
    }

    this.mediaElements.clear();
    this.videoTracks.set({});
    this.participants.set([]);
    this.micEnabled.set(false);
    this.cameraEnabled.set(false);
    this.screenShareEnabled.set(false);
    this.activeRoomKey.set(null);

    if (this.state() !== 'error') {
      this.state.set('disconnected');
    }
  }

  private attachTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    if (track.kind === 'audio') {
      // Audio is attached to a detached element so it plays without a view.
      const element = track.attach();
      element.setAttribute('data-nip29-audio', participant.identity);
      document.body.appendChild(element);
      this.mediaElements.set(`${participant.identity}:${track.sid}`, element);
      return;
    }

    if (track.kind === 'video' && track.mediaStreamTrack) {
      this.videoTracks.update(state => ({
        ...state,
        [participant.identity]: track.mediaStreamTrack,
      }));
    }

    this.syncParticipants();
  }

  private detachTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    const key = `${participant.identity}:${track.sid}`;
    const element = this.mediaElements.get(key);

    if (element) {
      element.srcObject = null;
      element.remove();
      this.mediaElements.delete(key);
    }

    if (track.kind === 'video') {
      this.videoTracks.update(state => {
        const next = { ...state };
        delete next[participant.identity];
        return next;
      });
    }

    this.syncParticipants();
  }

  private syncLocalState(): void {
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

  private toParticipant(participant: Participant, room: Room): Nip29VoiceParticipant {
    // NIP-29 requires the first 64 characters of the LiveKit identity to be the
    // lowercase hex Nostr pubkey.
    const pubkey = participant.identity.slice(0, 64).toLowerCase();

    return {
      identity: participant.identity,
      pubkey: /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : '',
      isLocal: participant.identity === room.localParticipant.identity,
      isSpeaking: participant.isSpeaking,
      isMuted: !participant.isMicrophoneEnabled,
      hasVideo: participant.isCameraEnabled,
    };
  }
}
