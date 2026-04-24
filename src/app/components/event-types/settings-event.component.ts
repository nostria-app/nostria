import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { SatAmountComponent } from '../sat-amount/sat-amount.component';
import { SatDisplayService } from '../../services/sat-display.service';

interface CustomFeed {
  label?: string;
  type?: string;
  source?: string;
}

interface SettingsSnapshot {
  socialSharingPreview?: boolean;
  relayDiscoveryMode?: string;
  mediaPrivacy?: string;
  placeholderAlgorithm?: string;
  autoPlayVideos?: boolean;
  autoPlayShortForm?: boolean;
  repeatShortForm?: boolean;
  aiEnabled?: boolean;
  aiTranslationEnabled?: boolean;
  aiSummarizationEnabled?: boolean;
  aiSpeechEnabled?: boolean;
  aiVoice?: string;
  aiNativeLanguage?: string;
  publishMusicStatus?: boolean;
  quickZapEnabled?: boolean;
  quickZapAmount?: number;
  zapQuickAmounts?: number[];
  googleFaviconEnabled?: boolean;
  imageCacheEnabled?: boolean;
  customFeeds?: CustomFeed[];
}

@Component({
  selector: 'app-settings-event',
  imports: [CommonModule, MatCardModule, MatChipsModule, MatIconModule, SatAmountComponent],
  templateUrl: './settings-event.component.html',
  styleUrl: './settings-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsEventComponent {
  event = input.required<Event>();
  private satDisplay = inject(SatDisplayService);

  settings = computed<SettingsSnapshot | null>(() => {
    const currentEvent = this.event();
    if (!currentEvent.content) {
      return null;
    }

    try {
      return JSON.parse(currentEvent.content) as SettingsSnapshot;
    } catch {
      return null;
    }
  });

  title = computed(() => {
    const dTag = this.event().tags.find(tag => tag[0] === 'd')?.[1];
    return dTag === 'nostria:settings' ? 'Nostria Settings' : 'Settings Snapshot';
  });

  summaryItems = computed(() => {
    const settings = this.settings();
    if (!settings) {
      return [];
    }

    return [
      { label: 'Relay discovery', value: this.prettyValue(settings.relayDiscoveryMode) },
      { label: 'Media privacy', value: this.prettyValue(settings.mediaPrivacy) },
      { label: 'Placeholder', value: this.prettyValue(settings.placeholderAlgorithm) },
      { label: 'Quick zap', value: settings.quickZapEnabled ? this.satDisplay.formatSats(settings.quickZapAmount ?? 0) : 'Off' },
      { label: 'Video autoplay', value: settings.autoPlayVideos ? 'On' : 'Off' },
      { label: 'Music status', value: settings.publishMusicStatus ? 'On' : 'Off' },
      { label: 'Image cache', value: settings.imageCacheEnabled ? 'On' : 'Off' },
      { label: 'Google favicon', value: settings.googleFaviconEnabled ? 'On' : 'Off' },
      { label: 'AI voice', value: settings.aiVoice ? this.prettyValue(settings.aiVoice) : 'Off' },
      { label: 'AI language', value: settings.aiNativeLanguage?.toUpperCase() || 'Default' },
    ].filter(item => item.value && item.value !== 'Unknown');
  });

  enabledFlags = computed(() => {
    const settings = this.settings();
    if (!settings) {
      return [];
    }

    const flags = [
      ['Social preview', settings.socialSharingPreview],
      ['Short-form autoplay', settings.autoPlayShortForm],
      ['Short-form repeat', settings.repeatShortForm],
      ['AI enabled', settings.aiEnabled],
      ['AI translation', settings.aiTranslationEnabled],
      ['AI summaries', settings.aiSummarizationEnabled],
      ['AI speech', settings.aiSpeechEnabled],
    ] as const;

    return flags.filter(([, enabled]) => !!enabled).map(([label]) => label);
  });

  feedLabels = computed(() => {
    const feeds = this.settings()?.customFeeds ?? [];
    return feeds.map(feed => `${feed.label || 'Untitled'} · ${this.prettyValue(feed.type)} · ${this.prettyValue(feed.source)}`);
  });

  quickZapAmounts = computed(() => {
    return this.settings()?.zapQuickAmounts ?? [];
  });

  private prettyValue(value: string | undefined): string {
    if (!value) {
      return 'Unknown';
    }

    return value
      .split('-')
      .flatMap(part => part.split('_'))
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}