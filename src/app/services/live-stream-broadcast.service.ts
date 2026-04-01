import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';

export type BroadcastState = 'idle' | 'preparing' | 'connecting' | 'live' | 'stopping' | 'error';
export type CameraFacingMode = 'user' | 'environment';

export interface LiveStreamPreviewOptions {
  facingMode?: CameraFacingMode;
  audio?: boolean;
}

export interface StartWhipBroadcastOptions extends LiveStreamPreviewOptions {
  endpoint: string;
  token?: string;
}

interface WhipAnswerNormalizationResult {
  sdp: string;
  removedLines: string[];
}

@Injectable({
  providedIn: 'root',
})
export class LiveStreamBroadcastService {
  private static readonly MAX_PROVIDER_BITRATE_BPS = 500_000;
  private static readonly MAX_AUDIO_BITRATE_BPS = 64_000;
  private static readonly MAX_VIDEO_BITRATE_BPS = 420_000;

  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly state = signal<BroadcastState>('idle');
  readonly previewStream = signal<MediaStream | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly endpoint = signal<string | null>(null);
  readonly sessionUrl = signal<string | null>(null);
  readonly startedAt = signal<number | null>(null);

  readonly isSupported = computed(() => {
    return this.isBrowser
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof RTCPeerConnection !== 'undefined';
  });

  readonly isLive = computed(() => this.state() === 'live');
  readonly isBusy = computed(() => {
    const currentState = this.state();
    return currentState === 'preparing' || currentState === 'connecting' || currentState === 'stopping';
  });

  private peerConnection: RTCPeerConnection | null = null;
  private currentFacingMode: CameraFacingMode = 'user';
  private currentWhipToken: string | null = null;

  constructor() {
    if (!this.isBrowser || typeof window === 'undefined') {
      return;
    }

    const handleWindowUnload = () => {
      this.releaseSessionForWindowUnload();
    };

    window.addEventListener('pagehide', handleWindowUnload);
    window.addEventListener('beforeunload', handleWindowUnload);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('pagehide', handleWindowUnload);
      window.removeEventListener('beforeunload', handleWindowUnload);
    });
  }

  async ensurePreview(options: LiveStreamPreviewOptions = {}): Promise<MediaStream> {
    if (!this.isSupported()) {
      throw new Error('This browser cannot capture and publish live video.');
    }

    const nextFacingMode = options.facingMode ?? this.currentFacingMode;
    const currentStream = this.previewStream();

    if (currentStream && this.currentFacingMode === nextFacingMode) {
      return currentStream;
    }

    return this.replacePreviewStream(options);
  }

  async restartPreview(options: LiveStreamPreviewOptions = {}): Promise<MediaStream> {
    if (this.isLive() || this.state() === 'connecting') {
      throw new Error('Stop the current live broadcast before switching cameras.');
    }

    return this.replacePreviewStream(options);
  }

  async startBroadcast(options: StartWhipBroadcastOptions): Promise<void> {
    if (this.isLive()) {
      return;
    }

    if (this.isBusy()) {
      throw new Error('A live broadcast action is already in progress.');
    }

    if (!this.isSupported()) {
      throw new Error('This browser cannot publish live video to the provider.');
    }

    const normalizedEndpoint = new URL(options.endpoint).toString();
    let peerConnection: RTCPeerConnection | null = null;
    let sessionUrl: string | null = null;
    let rawAnswerPreview = '';
    let sanitizedAnswerPreview = '';
    let removedAnswerLines: string[] = [];

    try {
      this.errorMessage.set(null);
      this.state.set('preparing');
      this.endpoint.set(normalizedEndpoint);
      this.currentWhipToken = options.token ?? null;

      const stream = await this.ensurePreview(options);

      peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      });
      this.peerConnection = peerConnection;

      peerConnection.onconnectionstatechange = () => {
        const currentPeerConnection = this.peerConnection;
        if (!currentPeerConnection || currentPeerConnection !== peerConnection) {
          return;
        }

        if (currentPeerConnection.connectionState === 'connected') {
          this.state.set('live');
          return;
        }

        if (currentPeerConnection.connectionState === 'failed') {
          this.errorMessage.set('The provider connection failed.');
          this.state.set('error');
        }
      };

      const senderConfigurationTasks: Promise<void>[] = [];
      for (const track of stream.getTracks()) {
        const sender = peerConnection.addTrack(track, stream);
        senderConfigurationTasks.push(this.configureSender(sender, track.kind));
      }

      await Promise.all(senderConfigurationTasks);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await this.waitForIceGatheringComplete(peerConnection);

      this.state.set('connecting');

      const response = await fetch(normalizedEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/sdp',
          'Content-Type': 'application/sdp',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: peerConnection.localDescription?.sdp ?? offer.sdp ?? '',
      });

      const responseBody = await response.text();

      if (!response.ok) {
        throw this.createWhipResponseError(response.status, responseBody);
      }

      const locationHeader = response.headers.get('location');
      sessionUrl = locationHeader ? new URL(locationHeader, normalizedEndpoint).toString() : null;
      this.sessionUrl.set(sessionUrl);

      rawAnswerPreview = this.createSdpPreview(responseBody);

      const normalizedAnswer = this.normalizeWhipAnswerSdp(responseBody);
      const answerSdp = normalizedAnswer.sdp;
      removedAnswerLines = normalizedAnswer.removedLines;
      sanitizedAnswerPreview = this.createSdpPreview(answerSdp);

      if (removedAnswerLines.length > 0) {
        this.logger.warn('WHIP answer SDP normalization removed unsupported lines', {
          removedLines: removedAnswerLines,
          endpoint: normalizedEndpoint,
          sessionUrl,
        });
      }

      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      this.startedAt.set(Date.now());
      this.state.set('live');
    } catch (error) {
      this.logger.error('Failed to start WHIP live broadcast', error, {
        endpoint: normalizedEndpoint,
        sessionUrl,
        rawAnswerPreview,
        sanitizedAnswerPreview,
        removedAnswerLines,
      });
      if (sessionUrl) {
        await this.closeWhipSession(sessionUrl, this.currentWhipToken);
      }
      if (peerConnection) {
        peerConnection.close();
      }
      this.peerConnection = null;
      this.sessionUrl.set(null);
      this.startedAt.set(null);
      this.endpoint.set(null);
      this.currentWhipToken = null;
      this.state.set('error');
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to start the live broadcast.');
      throw error;
    }
  }

  async stopBroadcast(options: { stopPreview?: boolean } = {}): Promise<void> {
    if (this.state() === 'idle' && !this.peerConnection) {
      if (options.stopPreview) {
        this.stopPreviewTracks();
      }
      return;
    }

    this.state.set('stopping');

    const activeSessionUrl = this.sessionUrl();
    if (activeSessionUrl) {
      await this.closeWhipSession(activeSessionUrl, this.currentWhipToken);
    }

    if (this.peerConnection) {
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.sessionUrl.set(null);
    this.startedAt.set(null);
    this.endpoint.set(null);
    this.currentWhipToken = null;
    this.errorMessage.set(null);
    this.state.set('idle');

    if (options.stopPreview) {
      this.stopPreviewTracks();
    }
  }

  async releasePreviewIfIdle(): Promise<void> {
    if (this.isLive() || this.isBusy()) {
      return;
    }

    this.stopPreviewTracks();
  }

  private async replacePreviewStream(options: LiveStreamPreviewOptions): Promise<MediaStream> {
    this.stopPreviewTracks();
    this.errorMessage.set(null);

    const facingMode = options.facingMode ?? this.currentFacingMode;
    const stream = await navigator.mediaDevices.getUserMedia(this.buildConstraints({
      ...options,
      facingMode,
    }));

    this.previewStream.set(stream);
    this.currentFacingMode = facingMode;

    if (!this.isLive() && this.state() !== 'connecting') {
      this.state.set('idle');
    }

    return stream;
  }

  private buildConstraints(options: LiveStreamPreviewOptions): MediaStreamConstraints {
    return {
      audio: options.audio ?? true,
      video: {
        facingMode: options.facingMode ?? 'user',
        width: { ideal: 854, max: 960 },
        height: { ideal: 480, max: 540 },
        frameRate: { ideal: 24, max: 24 },
      },
    };
  }

  private async configureSender(sender: RTCRtpSender, kind: string): Promise<void> {
    const parameters = sender.getParameters();
    const encoding = parameters.encodings?.[0] ?? {};

    if (kind === 'audio') {
      encoding.maxBitrate = LiveStreamBroadcastService.MAX_AUDIO_BITRATE_BPS;
      encoding.priority = 'high';
    }

    if (kind === 'video') {
      encoding.maxBitrate = LiveStreamBroadcastService.MAX_VIDEO_BITRATE_BPS;
      encoding.maxFramerate = 24;
      encoding.priority = 'medium';
      encoding.networkPriority = 'medium';
    }

    parameters.encodings = [encoding];

    try {
      await sender.setParameters(parameters);
    } catch (error) {
      this.logger.warn(`Failed to apply ${kind} sender bitrate cap`, error);
    }
  }

  private stopPreviewTracks(): void {
    const stream = this.previewStream();
    if (!stream) {
      return;
    }

    for (const track of stream.getTracks()) {
      track.stop();
    }

    this.previewStream.set(null);
  }

  private async waitForIceGatheringComplete(peerConnection: RTCPeerConnection): Promise<void> {
    if (peerConnection.iceGatheringState === 'complete') {
      return;
    }

    await new Promise<void>(resolve => {
      const handleStateChange = () => {
        if (peerConnection.iceGatheringState !== 'complete') {
          return;
        }

        peerConnection.removeEventListener('icegatheringstatechange', handleStateChange);
        resolve();
      };

      peerConnection.addEventListener('icegatheringstatechange', handleStateChange);
    });
  }

  private normalizeWhipAnswerSdp(sdp: string): WhipAnswerNormalizationResult {
    const removedLines: string[] = [];
    const sanitizedLines = sdp
      .replace(/^\uFEFF/, '')
      .replace(/\r?\n/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        if (!line) {
          return false;
        }

        if (line.toLowerCase() === 'a=end-of-candidates') {
          removedLines.push(line);
          return false;
        }

        if (!/^[a-z]=/i.test(line)) {
          removedLines.push(line);
          return false;
        }

        return true;
      });

    const hasRequiredSdpEnvelope = sanitizedLines.some(line => line.startsWith('v='))
      && sanitizedLines.some(line => line.startsWith('o='))
      && sanitizedLines.some(line => line.startsWith('s='))
      && sanitizedLines.some(line => line.startsWith('t='))
      && sanitizedLines.some(line => line.startsWith('m='));

    if (!hasRequiredSdpEnvelope) {
      throw new Error(`WHIP endpoint returned an invalid SDP answer: ${this.createSdpPreview(sdp)}`);
    }

    return {
      sdp: `${sanitizedLines.join('\r\n')}\r\n`,
      removedLines,
    };
  }

  private createSdpPreview(sdp: string): string {
    return sdp
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .slice(0, 500);
  }

  private async closeWhipSession(sessionUrl: string, token: string | null): Promise<void> {
    try {
      await fetch(sessionUrl, {
        method: 'DELETE',
        keepalive: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch (error) {
      this.logger.warn('Failed to close WHIP session cleanly', error);
    }
  }

  private releaseSessionForWindowUnload(): void {
    const activeSessionUrl = this.sessionUrl();
    if (!activeSessionUrl) {
      return;
    }

    void this.closeWhipSession(activeSessionUrl, this.currentWhipToken);

    if (this.peerConnection) {
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.sessionUrl.set(null);
    this.startedAt.set(null);
    this.endpoint.set(null);
    this.currentWhipToken = null;
  }

  private createWhipResponseError(status: number, responseBody: string): Error {
    const trimmedBody = responseBody.trim();
    if (status === 403 && /endpoint id already in use/i.test(trimmedBody)) {
      return new Error('The browser broadcast endpoint is already in use. Stop the existing browser stream or reset the browser endpoint before trying again.');
    }

    return new Error(trimmedBody || `WHIP publish failed with status ${status}.`);
  }
}