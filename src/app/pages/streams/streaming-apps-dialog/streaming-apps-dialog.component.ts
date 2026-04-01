import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { nip19 } from 'nostr-tools';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { NostrService } from '../../../services/nostr.service';
import { PublishService } from '../../../services/publish.service';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';
import {
  CameraFacingMode,
  LiveStreamBroadcastService,
} from '../../../services/live-stream-broadcast.service';

type StreamStatus = 'planned' | 'live' | 'ended';
type ProviderId = 'openresist-whip' | 'zap-stream' | 'generic';

interface StreamingProviderOption {
  id: ProviderId;
  name: string;
  serviceUrl: string;
  description: string;
  helpText: string;
  openUrl: string;
  defaultPlatformUrl?: string;
  supportsDirectBroadcast?: boolean;
  whipEndpoint?: string;
  whipToken?: string;
}

interface PublishedStreamResult {
  identifier: string;
  naddr: string;
}

const LIVE_STREAM_KIND = 30311;
const MILLISECONDS_PER_MINUTE = 60_000;

const STREAMING_PROVIDER_OPTIONS: StreamingProviderOption[] = [
  {
    id: 'openresist-whip',
    name: 'OpenResist WHIP',
    serviceUrl: 'https://stream.openresist.com',
    description: 'Push the device camera directly to OpenResist from Nostria, then announce it publicly when ready.',
    helpText: 'OpenResist gives you a public watch page even when you do not have a direct HLS playback URL yet.',
    openUrl: 'https://stream.openresist.com/',
    defaultPlatformUrl: 'https://stream.openresist.com/',
    supportsDirectBroadcast: true,
    whipEndpoint: 'https://stream.openresist.com/whip/endpoint/browser',
    whipToken: 'change-me',
  },
  {
    id: 'zap-stream',
    name: 'zap.stream',
    serviceUrl: 'https://zap.stream',
    description: 'Use zap.stream for ingest, then paste the playback URL here so Nostria viewers can watch inline.',
    helpText: 'zap.stream currently expects RTMP/SRT ingest from OBS or another encoder. Paste the resulting HLS playback URL back into Nostria to publish the Nostr live stream post.',
    openUrl: 'https://zap.stream',
  },
  {
    id: 'generic',
    name: 'Generic Provider',
    serviceUrl: '',
    description: 'Works with any provider that gives you an HLS (.m3u8) or LiveKit playback URL.',
    helpText: 'If your provider exposes a playback page, add that as the platform URL. For inline playback inside Nostria, include a direct HLS or LiveKit playback URL.',
    openUrl: 'https://zap.stream',
  },
];

@Component({
  selector: 'app-streaming-apps-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './streaming-apps-dialog.component.html',
  styleUrl: './streaming-apps-dialog.component.scss',
})
export class StreamingAppsDialogComponent implements OnDestroy {
  readonly dialogRef = inject(CustomDialogRef<StreamingAppsDialogComponent, PublishedStreamResult | undefined>);
  private readonly nostrService = inject(NostrService);
  private readonly publishService = inject(PublishService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);
  readonly broadcast = inject(LiveStreamBroadcastService);

  readonly providers = STREAMING_PROVIDER_OPTIONS;
  readonly cameraPreview = viewChild<ElementRef<HTMLVideoElement>>('cameraPreview');

  private readonly identifierSuffix = this.createIdentifierSuffix();
  readonly selectedProviderId = signal<ProviderId>('openresist-whip');
  readonly title = signal('');
  readonly summary = signal('');
  readonly status = signal<StreamStatus>('planned');
  readonly streamIdentifier = signal(this.buildAutomaticIdentifier('live-stream'));
  readonly startsAt = signal(this.toLocalDateTimeValue(new Date()));
  readonly endsAt = signal('');
  readonly streamingUrl = signal('');
  readonly platformUrl = signal(STREAMING_PROVIDER_OPTIONS[0].defaultPlatformUrl ?? STREAMING_PROVIDER_OPTIONS[0].openUrl);
  readonly imageUrl = signal('');
  readonly hashtagsInput = signal('');
  readonly publishing = signal(false);
  readonly cameraFacingMode = signal<CameraFacingMode>('user');
  readonly withMicrophone = signal(true);

  private readonly identifierEdited = signal(false);

  readonly currentProvider = computed(() => {
    return this.providers.find(provider => provider.id === this.selectedProviderId()) ?? this.providers[0];
  });

  readonly isAuthenticated = computed(() => !!this.accountState.pubkey());

  readonly supportsDirectBroadcast = computed(() => !!this.currentProvider().supportsDirectBroadcast);

  readonly publishButtonLabel = computed(() => {
    if (this.broadcast.isLive()) {
      return $localize`:@@streams.dialog.publishAnnounce:Announce live stream`;
    }

    switch (this.status()) {
      case 'live':
        return $localize`:@@streams.dialog.publishLive:Publish live stream`;
      case 'ended':
        return $localize`:@@streams.dialog.publishEnded:Publish ended stream`;
      default:
        return $localize`:@@streams.dialog.publishScheduled:Publish scheduled stream`;
    }
  });

  readonly privateBroadcastButtonLabel = computed(() => {
    return this.broadcast.isLive()
      ? $localize`:@@streams.dialog.stopPrivate:Stop private broadcast`
      : $localize`:@@streams.dialog.goLivePrivate:Go live privately`;
  });

  readonly directBroadcastStatusLabel = computed(() => {
    switch (this.broadcast.state()) {
      case 'preparing':
        return $localize`:@@streams.dialog.broadcastPreparing:Preparing camera`;
      case 'connecting':
        return $localize`:@@streams.dialog.broadcastConnecting:Connecting to provider`;
      case 'live':
        return $localize`:@@streams.dialog.broadcastLive:Private broadcast live`;
      case 'error':
        return $localize`:@@streams.dialog.broadcastError:Broadcast error`;
      case 'stopping':
        return $localize`:@@streams.dialog.broadcastStopping:Stopping broadcast`;
      default:
        return $localize`:@@streams.dialog.broadcastIdle:Idle`;
    }
  });

  readonly canPublish = computed(() => {
    return this.isAuthenticated() && !!this.title().trim() && !this.publishing();
  });

  readonly canPreparePreview = computed(() => {
    return this.isAuthenticated() && this.supportsDirectBroadcast() && !this.broadcast.isBusy();
  });

  readonly canTogglePrivateBroadcast = computed(() => {
    if (this.broadcast.isLive()) {
      return !this.broadcast.isBusy();
    }

    return this.canPreparePreview();
  });

  constructor() {
    effect(() => {
      const previewElement = this.cameraPreview()?.nativeElement;
      const previewStream = this.broadcast.previewStream();

      if (!previewElement) {
        return;
      }

      if (previewElement.srcObject !== previewStream) {
        previewElement.srcObject = previewStream;
      }

      if (previewStream) {
        previewElement.muted = true;
        previewElement.playsInline = true;
        void previewElement.play().catch(error => {
          this.logger.warn('Failed to start live stream preview playback', error);
        });
      }
    });
  }

  ngOnDestroy(): void {
    void this.broadcast.releasePreviewIfIdle();
  }

  close(): void {
    this.dialogRef.close();
  }

  onProviderChange(providerId: ProviderId): void {
    if (this.broadcast.isLive() && providerId !== this.selectedProviderId()) {
      this.snackBar.open(
        $localize`:@@streams.dialog.stopBeforeSwitch:Stop the active broadcast before switching providers.`,
        '',
        { duration: 3000 },
      );
      return;
    }

    const previousProvider = this.currentProvider();
    const currentPlatformUrl = this.platformUrl().trim();

    this.selectedProviderId.set(providerId);

    if (
      !currentPlatformUrl
      || currentPlatformUrl === previousProvider.openUrl
      || currentPlatformUrl === previousProvider.defaultPlatformUrl
    ) {
      this.platformUrl.set(this.currentProvider().defaultPlatformUrl ?? this.currentProvider().openUrl);
    }

    if (!this.supportsDirectBroadcast() && !this.broadcast.isLive()) {
      void this.broadcast.releasePreviewIfIdle();
    }
  }

  onStatusChange(status: StreamStatus): void {
    this.status.set(status);

    if (!this.startsAt()) {
      this.startsAt.set(this.toLocalDateTimeValue(new Date()));
    }

    if (status === 'ended' && !this.endsAt()) {
      this.endsAt.set(this.toLocalDateTimeValue(new Date()));
      return;
    }

    if (status !== 'ended' && this.endsAt()) {
      this.endsAt.set('');
    }
  }

  onTitleChange(value: string): void {
    this.title.set(value);

    if (!this.identifierEdited()) {
      this.streamIdentifier.set(this.buildAutomaticIdentifier(value));
    }
  }

  onIdentifierChange(value: string): void {
    this.identifierEdited.set(true);
    this.streamIdentifier.set(this.normalizeIdentifier(value));
  }

  onMicrophoneChange(value: boolean): void {
    this.withMicrophone.set(value);

    if (this.broadcast.previewStream() && !this.broadcast.isLive()) {
      void this.preparePreview();
    }
  }

  openProvider(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const platformUrl = this.platformUrl().trim();
    const targetUrl = platformUrl || this.currentProvider().openUrl;
    const normalizedTargetUrl = this.validateUrl(targetUrl, 'provider URL');
    if (!normalizedTargetUrl) {
      return;
    }

    window.open(normalizedTargetUrl, '_blank', 'noopener,noreferrer');
  }

  async preparePreview(): Promise<void> {
    if (!this.ensureAuthenticatedAccess()) {
      return;
    }

    if (!this.supportsDirectBroadcast()) {
      return;
    }

    try {
      await this.broadcast.restartPreview({
        audio: this.withMicrophone(),
        facingMode: this.cameraFacingMode(),
      });
    } catch (error) {
      this.logger.error('Failed to prepare live stream preview', error);
      this.snackBar.open(
        error instanceof Error ? error.message : $localize`:@@streams.dialog.previewFailed:Failed to prepare the camera preview.`,
        '',
        { duration: 3500 },
      );
    }
  }

  async toggleCameraFacingMode(): Promise<void> {
    const nextFacingMode = this.cameraFacingMode() === 'user' ? 'environment' : 'user';
    this.cameraFacingMode.set(nextFacingMode);

    if (this.broadcast.previewStream() && !this.broadcast.isLive()) {
      await this.preparePreview();
    }
  }

  async togglePrivateBroadcast(): Promise<void> {
    if (this.broadcast.isLive()) {
      await this.stopPrivateBroadcast();
      return;
    }

    if (!this.ensureAuthenticatedAccess()) {
      return;
    }

    const whipEndpoint = this.currentProvider().whipEndpoint;
    if (!whipEndpoint) {
      return;
    }

    try {
      await this.broadcast.startBroadcast({
        endpoint: whipEndpoint,
        token: this.currentProvider().whipToken,
        audio: this.withMicrophone(),
        facingMode: this.cameraFacingMode(),
      });

      if (!this.platformUrl().trim()) {
        this.platformUrl.set(this.currentProvider().defaultPlatformUrl ?? this.currentProvider().openUrl);
      }

      this.status.set('live');
      this.startsAt.set(this.toLocalDateTimeValue(new Date()));
      this.snackBar.open(
        $localize`:@@streams.dialog.privateStarted:Private broadcast is live. Publish the Nostr event when you are ready.`,
        '',
        { duration: 4000 },
      );
    } catch (error) {
      this.logger.error('Failed to start private live broadcast', error);
      this.snackBar.open(
        error instanceof Error ? error.message : $localize`:@@streams.dialog.privateFailed:Failed to start the private broadcast.`,
        '',
        { duration: 4000 },
      );
    }
  }

  async stopPrivateBroadcast(): Promise<void> {
    try {
      await this.broadcast.stopBroadcast();
      this.snackBar.open(
        $localize`:@@streams.dialog.privateStopped:Private broadcast stopped.`,
        '',
        { duration: 3000 },
      );
    } catch (error) {
      this.logger.error('Failed to stop private live broadcast', error);
      this.snackBar.open(
        $localize`:@@streams.dialog.stopFailed:Failed to stop the private broadcast cleanly.`,
        '',
        { duration: 3500 },
      );
    }
  }

  async publishStream(): Promise<void> {
    if (!this.ensureAuthenticatedAccess()) {
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open(
        $localize`:@@streams.dialog.signInFirst:Sign in to publish a live stream.`,
        '',
        { duration: 3000 },
      );
      return;
    }

    const title = this.title().trim();
    if (!title) {
      this.snackBar.open(
        $localize`:@@streams.dialog.titleRequired:Please add a title for your live stream.`,
        '',
        { duration: 3000 },
      );
      return;
    }

    const identifier = this.normalizeIdentifier(this.streamIdentifier());
    if (!identifier) {
      this.snackBar.open(
        $localize`:@@streams.dialog.identifierRequired:Please add a stream identifier.`,
        '',
        { duration: 3000 },
      );
      return;
    }

    const streamingUrl = this.validateUrl(this.streamingUrl(), 'playback URL');
    if (streamingUrl === null) {
      return;
    }

    const platformUrl = this.validateUrl(this.platformUrl(), 'platform URL');
    if (platformUrl === null) {
      return;
    }

    const imageUrl = this.validateUrl(this.imageUrl(), 'thumbnail URL');
    if (imageUrl === null) {
      return;
    }

    if (this.broadcast.isLive()) {
      this.status.set('live');
    }

    if (this.status() === 'live' && !streamingUrl && !platformUrl) {
      this.snackBar.open(
        $localize`:@@streams.dialog.playbackOrPlatformRequired:Add a playback URL or a provider watch page before announcing a live stream.`,
        '',
        { duration: 3500 },
      );
      return;
    }

    const startsTimestamp = this.parseDateTimeToUnixSeconds(this.startsAt()) ?? Math.floor(Date.now() / 1000);
    const endsTimestamp = this.status() === 'ended'
      ? this.parseDateTimeToUnixSeconds(this.endsAt()) ?? Math.floor(Date.now() / 1000)
      : null;

    const tags: string[][] = [
      ['d', identifier],
      ['title', title],
      ['status', this.status()],
      ['p', pubkey, '', 'host'],
      ['starts', String(startsTimestamp)],
    ];

    const summary = this.summary().trim();
    if (summary) {
      tags.push(['summary', summary]);
    }

    if (streamingUrl) {
      tags.push(['streaming', streamingUrl]);
    }

    if (platformUrl) {
      tags.push(['alt', `Watch live on ${platformUrl}`]);
    }

    if (this.currentProvider().serviceUrl) {
      tags.push(['service', this.currentProvider().serviceUrl]);
    } else if (platformUrl) {
      tags.push(['service', platformUrl]);
    }

    if (imageUrl) {
      tags.push(['image', imageUrl]);
    }

    if (endsTimestamp) {
      tags.push(['ends', String(endsTimestamp)]);
    }

    for (const hashtag of this.parseHashtags(this.hashtagsInput())) {
      tags.push(['t', hashtag]);
    }

    this.publishing.set(true);

    try {
      const unsignedEvent = this.nostrService.createEvent(LIVE_STREAM_KIND, '', tags);
      const signedEvent = await this.nostrService.signEvent(unsignedEvent);

      if (!signedEvent) {
        throw new Error('Signing returned no event');
      }

      const publishResult = await this.publishService.publish(signedEvent);
      if (!publishResult.success) {
        throw new Error('No relay accepted the live stream event');
      }

      const naddr = nip19.naddrEncode({
        identifier,
        kind: LIVE_STREAM_KIND,
        pubkey: signedEvent.pubkey,
      });

      this.streamIdentifier.set(identifier);

      this.snackBar.open(
        this.broadcast.isLive()
          ? $localize`:@@streams.dialog.publishSuccessWithBroadcast:Live stream announced. Your camera broadcast stays live until you stop it from Start Live Stream.`
          : $localize`:@@streams.dialog.publishSuccess:Live stream published successfully.`,
        '',
        { duration: 4500 },
      );

      await this.router.navigate(['/stream', naddr]);
      this.dialogRef.close({ identifier, naddr });
    } catch (error) {
      this.logger.error('Failed to publish live stream', error);
      this.snackBar.open(
        $localize`:@@streams.dialog.publishFailed:Failed to publish the live stream. Please try again.`,
        '',
        { duration: 4000 },
      );
    } finally {
      this.publishing.set(false);
    }
  }

  private parseHashtags(value: string): string[] {
    return [...new Set(
      value
        .split(/[\s,]+/)
        .map(tag => tag.trim().replace(/^#/, '').toLowerCase())
        .filter(Boolean),
    )];
  }

  private parseDateTimeToUnixSeconds(value: string): number | null {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    const parsedValue = new Date(trimmedValue);
    if (Number.isNaN(parsedValue.getTime())) {
      return null;
    }

    return Math.floor(parsedValue.getTime() / 1000);
  }

  private validateUrl(value: string, label: string): string | null {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return '';
    }

    try {
      const parsedUrl = new URL(trimmedValue);
      return parsedUrl.toString();
    } catch {
      this.snackBar.open(
        $localize`:@@streams.dialog.invalidUrl:Please enter a valid ${label}.`,
        '',
        { duration: 3000 },
      );
      return null;
    }
  }

  private toLocalDateTimeValue(date: Date): string {
    const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * MILLISECONDS_PER_MINUTE));
    return localDate.toISOString().slice(0, 16);
  }

  private buildAutomaticIdentifier(value: string): string {
    const normalizedValue = this.normalizeIdentifier(value);
    const baseValue = normalizedValue || 'live-stream';

    return `${baseValue}-${this.identifierSuffix}`;
  }

  private createIdentifierSuffix(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36);
  }

  private ensureAuthenticatedAccess(): boolean {
    if (!this.isAuthenticated()) {
      this.snackBar.open(
        $localize`:@@streams.dialog.signInFirst:Sign in to publish a live stream.`,
        '',
        { duration: 3000 },
      );
      return false;
    }

    return true;
  }

  private normalizeIdentifier(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
