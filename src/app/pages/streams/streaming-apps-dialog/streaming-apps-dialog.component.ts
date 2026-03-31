import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { nip19 } from 'nostr-tools';
import { CustomDialogRef } from '../../../services/custom-dialog.service';
import { NostrService } from '../../../services/nostr.service';
import { PublishService } from '../../../services/publish.service';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';

type StreamStatus = 'planned' | 'live' | 'ended';
type ProviderId = 'zap-stream' | 'generic';

interface StreamingProviderOption {
  id: ProviderId;
  name: string;
  serviceUrl: string;
  description: string;
  helpText: string;
  openUrl: string;
}

interface PublishedStreamResult {
  identifier: string;
  naddr: string;
}

const LIVE_STREAM_KIND = 30311;
const MILLISECONDS_PER_MINUTE = 60_000;

const STREAMING_PROVIDER_OPTIONS: StreamingProviderOption[] = [
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
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div dialog-content class="live-stream-dialog-content">
      <mat-card class="intro-card">
        <mat-card-content class="intro-content">
          <div class="intro-copy">
            <p class="intro-title" i18n="@@streams.dialog.introTitle">
              Publish your live stream post from Nostria
            </p>
            <p i18n="@@streams.dialog.introDescription">
              Nostria can publish the Nostr live stream post and send people to your stream, but providers such as
              zap.stream still handle the actual video ingest.
            </p>
            <p class="supporting-text" i18n="@@streams.dialog.introDetails">
              Paste the playback URL your provider gives you so people can watch directly inside Nostria. If your
              provider only gives you a public page URL, Nostria will still publish the live stream post and link out
              to that page.
            </p>
          </div>

          <div class="provider-actions">
            <button mat-stroked-button type="button" (click)="openProvider()">
              <mat-icon>open_in_new</mat-icon>
              <span>Open {{ currentProvider().name }}</span>
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      @if (!isAuthenticated()) {
        <mat-card class="warning-card">
          <mat-card-content class="warning-content">
            <mat-icon>info</mat-icon>
            <span i18n="@@streams.dialog.signInRequired">
              Sign in to publish live streams from Nostria.
            </span>
          </mat-card-content>
        </mat-card>
      }

      <div class="form-grid">
        <mat-form-field appearance="outline">
          <mat-label i18n="@@streams.dialog.providerLabel">Streaming provider</mat-label>
          <mat-select
            [ngModel]="selectedProviderId()"
            (ngModelChange)="onProviderChange($event)"
          >
            @for (provider of providers; track provider.id) {
              <mat-option [value]="provider.id">{{ provider.name }}</mat-option>
            }
          </mat-select>
          <mat-hint>{{ currentProvider().description }}</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label i18n="@@streams.dialog.statusLabel">Status</mat-label>
          <mat-select [ngModel]="status()" (ngModelChange)="onStatusChange($event)">
            <mat-option value="planned" i18n="@@streams.dialog.statusPlanned">Scheduled</mat-option>
            <mat-option value="live" i18n="@@streams.dialog.statusLive">Live now</mat-option>
            <mat-option value="ended" i18n="@@streams.dialog.statusEnded">Ended</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label i18n="@@streams.dialog.titleLabel">Title</mat-label>
          <input
            matInput
            maxlength="120"
            [ngModel]="title()"
            (ngModelChange)="onTitleChange($event)"
            i18n-placeholder="@@streams.dialog.titlePlaceholder"
            placeholder="Friday night stream"
          >
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label i18n="@@streams.dialog.summaryLabel">Summary</mat-label>
          <textarea
            matInput
            rows="3"
            [ngModel]="summary()"
            (ngModelChange)="summary.set($event)"
            i18n-placeholder="@@streams.dialog.summaryPlaceholder"
            placeholder="What you're streaming, who is joining, and where people can watch."
          ></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label i18n="@@streams.dialog.identifierLabel">Stream identifier</mat-label>
          <input
            matInput
            [ngModel]="streamIdentifier()"
            (ngModelChange)="onIdentifierChange($event)"
            i18n-placeholder="@@streams.dialog.identifierPlaceholder"
            placeholder="friday-night-stream"
          >
          <mat-hint i18n="@@streams.dialog.identifierHint">
            Reuse this identifier later if you want to update the same live stream post.
          </mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label i18n="@@streams.dialog.startsLabel">Starts at</mat-label>
          <input
            matInput
            type="datetime-local"
            [ngModel]="startsAt()"
            (ngModelChange)="startsAt.set($event)"
          >
        </mat-form-field>

        @if (status() === 'ended') {
          <mat-form-field appearance="outline">
            <mat-label i18n="@@streams.dialog.endsLabel">Ended at</mat-label>
            <input
              matInput
              type="datetime-local"
              [ngModel]="endsAt()"
              (ngModelChange)="endsAt.set($event)"
            >
          </mat-form-field>
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label i18n="@@streams.dialog.playbackLabel">Playback URL</mat-label>
          <input
            matInput
            [ngModel]="streamingUrl()"
            (ngModelChange)="streamingUrl.set($event)"
            i18n-placeholder="@@streams.dialog.playbackPlaceholder"
            placeholder="https://example.com/live/index.m3u8"
          >
          <mat-hint i18n="@@streams.dialog.playbackHint">
            Required for inline playback when the stream is live. HLS (.m3u8) and LiveKit URLs work best.
          </mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label i18n="@@streams.dialog.platformLabel">Platform page URL</mat-label>
          <input
            matInput
            [ngModel]="platformUrl()"
            (ngModelChange)="platformUrl.set($event)"
            i18n-placeholder="@@streams.dialog.platformPlaceholder"
            placeholder="https://zap.stream/..."
          >
          <mat-hint>{{ currentProvider().helpText }}</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label i18n="@@streams.dialog.thumbnailLabel">Thumbnail image URL</mat-label>
          <input
            matInput
            [ngModel]="imageUrl()"
            (ngModelChange)="imageUrl.set($event)"
            i18n-placeholder="@@streams.dialog.thumbnailPlaceholder"
            placeholder="https://example.com/thumbnail.jpg"
          >
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label i18n="@@streams.dialog.hashtagsLabel">Hashtags</mat-label>
          <input
            matInput
            [ngModel]="hashtagsInput()"
            (ngModelChange)="hashtagsInput.set($event)"
            i18n-placeholder="@@streams.dialog.hashtagsPlaceholder"
            placeholder="nostr, gaming, live"
          >
          <mat-hint i18n="@@streams.dialog.hashtagsHint">
            Separate tags with commas or spaces.
          </mat-hint>
        </mat-form-field>
      </div>

    </div>

    <div dialog-actions class="dialog-actions">
      <button mat-button type="button" (click)="close()" i18n="@@common.close">Close</button>
      <button
        mat-flat-button
        type="button"
        (click)="publishStream()"
        [disabled]="!canPublish()"
      >
        <mat-icon>live_tv</mat-icon>
        <span>{{ publishButtonLabel() }}</span>
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: contents;
    }

    .live-stream-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: min(680px, 100%);
      padding-top: 8px;
    }

    .intro-card,
    .warning-card {
      background: var(--mat-sys-surface-container);
      border: 1px solid var(--mat-sys-outline-variant);
    }

    .intro-content,
    .warning-content {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .intro-content {
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .intro-copy {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1 1 360px;
    }

    .intro-title {
      margin: 0;
      color: var(--mat-sys-on-surface);
    }

    .supporting-text {
      color: var(--mat-sys-on-surface-variant);
    }

    .provider-actions {
      display: flex;
      align-items: center;
    }

    .warning-content {
      color: var(--mat-sys-on-surface);
      align-items: center;
    }

    .warning-content mat-icon {
      color: var(--mat-sys-primary);
      flex-shrink: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .full-width {
      grid-column: 1 / -1;
    }

    textarea[matInput] {
      field-sizing: content;
      min-height: 96px;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      width: 100%;
    }

    @media (max-width: 720px),
    (max-height: 720px) {
      .live-stream-dialog-content {
        min-width: 0;
      }

      .form-grid {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `],
})
export class StreamingAppsDialogComponent {
  readonly dialogRef = inject(CustomDialogRef<StreamingAppsDialogComponent, PublishedStreamResult | undefined>);
  private readonly nostrService = inject(NostrService);
  private readonly publishService = inject(PublishService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly accountState = inject(AccountStateService);

  readonly providers = STREAMING_PROVIDER_OPTIONS;

  private readonly identifierSuffix = this.createIdentifierSuffix();
  readonly selectedProviderId = signal<ProviderId>('zap-stream');
  readonly title = signal('');
  readonly summary = signal('');
  readonly status = signal<StreamStatus>('planned');
  readonly streamIdentifier = signal(this.buildAutomaticIdentifier('live-stream'));
  readonly startsAt = signal(this.toLocalDateTimeValue(new Date()));
  readonly endsAt = signal('');
  readonly streamingUrl = signal('');
  readonly platformUrl = signal(STREAMING_PROVIDER_OPTIONS[0].openUrl);
  readonly imageUrl = signal('');
  readonly hashtagsInput = signal('');
  readonly publishing = signal(false);

  private readonly identifierEdited = signal(false);

  readonly currentProvider = computed(() => {
    return this.providers.find(provider => provider.id === this.selectedProviderId()) ?? this.providers[0];
  });

  readonly isAuthenticated = computed(() => !!this.accountState.pubkey());

  readonly publishButtonLabel = computed(() => {
    switch (this.status()) {
      case 'live':
        return $localize`:@@streams.dialog.publishLive:Publish live stream`;
      case 'ended':
        return $localize`:@@streams.dialog.publishEnded:Publish ended stream`;
      default:
        return $localize`:@@streams.dialog.publishScheduled:Publish scheduled stream`;
    }
  });

  readonly canPublish = computed(() => {
    return this.isAuthenticated() && !!this.title().trim() && !this.publishing();
  });

  close(): void {
    this.dialogRef.close();
  }

  onProviderChange(providerId: ProviderId): void {
    const previousProvider = this.currentProvider();
    const currentPlatformUrl = this.platformUrl().trim();

    this.selectedProviderId.set(providerId);

    if (!currentPlatformUrl || currentPlatformUrl === previousProvider.openUrl) {
      this.platformUrl.set(this.currentProvider().openUrl);
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

  async publishStream(): Promise<void> {
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

    if (this.status() === 'live' && !streamingUrl) {
      this.snackBar.open(
        $localize`:@@streams.dialog.playbackRequired:Paste a playback URL before publishing a live stream.`,
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
        $localize`:@@streams.dialog.publishSuccess:Live stream published successfully.`,
        '',
        { duration: 3000 },
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

  private normalizeIdentifier(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
