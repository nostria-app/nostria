import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { ApplicationService } from '../../../services/application.service';
import { MetaService } from '../../../services/meta.service';
import { Router } from '@angular/router';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RightPanelService } from '../../../services/right-panel.service';
import { CelebrationBurstComponent } from '../../../components/celebration-burst/celebration-burst.component';
import { ZapSoundService, ZapTier } from '../../../services/zap-sound.service';
import { HapticsService } from '../../../services/haptics.service';
import { DesktopUpdaterService } from '../../../services/desktop-updater.service';
import { AndroidUpdaterService } from '../../../services/android-updater.service';

interface WebManifest {
  version?: string;
  commitSha?: string;
  commitShort?: string;
  buildDate?: string;
  name: string;
  short_name: string;
  [key: string]: any;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-about',
  imports: [DatePipe, MatCardModule, MatListModule, MatIconModule, MatButtonModule, MatTooltipModule, CelebrationBurstComponent],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
  host: { class: 'panel-with-sticky-header' },
})
export class AboutComponent implements OnInit, OnDestroy {
  private readonly app = inject(ApplicationService);
  private readonly meta = inject(MetaService);
  private readonly router = inject(Router);
  private readonly layout = inject(LayoutService);
  private readonly logger = inject(LoggerService);
  private readonly rightPanel = inject(RightPanelService);
  private readonly zapSound = inject(ZapSoundService);
  private readonly haptics = inject(HapticsService);
  readonly desktopUpdater = inject(DesktopUpdaterService);
  readonly androidUpdater = inject(AndroidUpdaterService);
  version = computed(() => this.app.version());
  videoFailed = signal(false);
  useStaticLogo = signal(false);
  commitSha = signal<string | undefined>(undefined);
  commitShort = signal<string | undefined>(undefined);
  buildDate = signal<string | undefined>(undefined);

  /** Current demo tier being shown (0 = not active). */
  demoTier = signal<number>(0);
  /** Whether a demo sequence is currently running. */
  private demoRunning = false;
  /** Timers for the demo sequence so we can clean up. */
  private demoTimers: ReturnType<typeof setTimeout>[] = [];

  constructor() { }

  resetIntroduction() {
    this.layout.showWelcomeScreen.set(true);
  }

  private extractImageUrlFromImeta(tags: any[]): string | null {
    if (!tags || !Array.isArray(tags)) return null;

    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === 'imeta') {
        // Extract URL from imeta tag content which is typically in format "url https://..."
        const imetaContent = tag[1];
        if (imetaContent && imetaContent.startsWith('url ')) {
          return imetaContent.substring(4).trim(); // Remove 'url ' prefix
        }
      }
    }
    return null;
  }

  private extractImageUrlFromContent(content: string): string | null {
    if (!content) return null;

    // Regular expression to match image URLs in content
    const urlRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i;
    const match = content.match(urlRegex);

    return match ? match[0] : null;
  }

  async ngOnInit() {
    this.useStaticLogo.set(this.shouldUseStaticLogo());

    // Parent settings component handles the page title
    void this.fetchBuildMetadata();
  }

  ngOnDestroy() {
    this.clearDemoTimers();
  }

  /** Easter egg: click the logo to cycle through all 5 zap celebration tiers. */
  playZapDemo(): void {
    if (this.demoRunning) {
      return;
    }
    this.demoRunning = true;
    this.clearDemoTimers();

    // Representative amounts for each tier
    const tiers: { tier: ZapTier; amount: number; delay: number; duration: number }[] = [
      { tier: 1, amount: 21, delay: 0, duration: 800 },
      { tier: 2, amount: 210, delay: 1200, duration: 1200 },
      { tier: 3, amount: 500, delay: 2800, duration: 1400 },
      { tier: 4, amount: 5000, delay: 4600, duration: 1600 },
      { tier: 5, amount: 21000, delay: 6600, duration: 2200 },
    ];

    for (const t of tiers) {
      // Start this tier
      const startTimer = setTimeout(() => {
        this.demoTier.set(t.tier);
        this.zapSound.playZapSound(t.amount);
        this.haptics.triggerZapBuzz();
      }, t.delay);
      this.demoTimers.push(startTimer);

      // End this tier
      const endTimer = setTimeout(() => {
        this.demoTier.set(0);
      }, t.delay + t.duration);
      this.demoTimers.push(endTimer);
    }

    // Mark demo as finished after all tiers complete
    const lastTier = tiers[tiers.length - 1];
    const finishTimer = setTimeout(() => {
      this.demoRunning = false;
    }, lastTier.delay + lastTier.duration);
    this.demoTimers.push(finishTimer);
  }

  private clearDemoTimers(): void {
    for (const timer of this.demoTimers) {
      clearTimeout(timer);
    }
    this.demoTimers = [];
    this.demoTier.set(0);
    this.demoRunning = false;
  }

  private shouldUseStaticLogo(): boolean {
    if (!this.app.isBrowser() || !isTauri()) {
      return false;
    }

    return /linux/i.test(window.navigator.userAgent);
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  checkForUpdates(): void {
    void this.desktopUpdater.checkForUpdates({ interactive: true, source: 'manual' });
  }

  checkForAndroidUpdates(): void {
    void this.androidUpdater.checkForUpdates({ interactive: true });
  }

  downloadAndroidUpdate(): void {
    void this.androidUpdater.openLatestApkDownload();
  }

  private async fetchBuildMetadata(): Promise<void> {
    if (!this.app.isBrowser()) {
      return;
    }

    if (isTauri()) {
      return;
    }

    try {
      const response = await fetch('/manifest.webmanifest');
      if (!response.ok) {
        throw new Error(`Failed to load manifest.webmanifest: ${response.status}`);
      }
      const manifestData = await response.json() as WebManifest;

      // Set commit and build date information
      if (manifestData.commitSha) {
        this.commitSha.set(manifestData.commitSha);
      }
      if (manifestData.commitShort) {
        this.commitShort.set(manifestData.commitShort);
      }
      if (manifestData.buildDate) {
        this.buildDate.set(manifestData.buildDate);
      }
    } catch (error) {
      this.logger.error('Error fetching manifest.webmanifest:', error);
    }
  }
}
