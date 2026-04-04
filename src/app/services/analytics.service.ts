import { Injectable, PLATFORM_ID, effect, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LocalSettingsService } from './local-settings.service';
import { LoggerService } from './logger.service';

type ApplicationInsightsModule = typeof import('@microsoft/applicationinsights-web');
type ApplicationInsightsInstance = InstanceType<ApplicationInsightsModule['ApplicationInsights']>;

@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private static readonly CONNECTION_STRING = 'InstrumentationKey=243bbf41-7f98-48b7-b4cd-ac9f9ead4985;IngestionEndpoint=https://westeurope-5.in.applicationinsights.azure.com/;LiveEndpoint=https://westeurope.livediagnostics.monitor.azure.com/;ApplicationId=6b331861-c4cc-4605-831f-a8d43ca240d7';

  private readonly localSettings = inject(LocalSettingsService);
  private readonly logger = inject(LoggerService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private appInsights: ApplicationInsightsInstance | null = null;
  private loadPromise: Promise<void> | null = null;
  private enabled = false;

  constructor() {
    effect(() => {
      const analyticsEnabled = this.localSettings.analyticsEnabled();
      void this.syncAnalyticsState(analyticsEnabled);
    });
  }

  initialize(): void {
    if (!this.isBrowser) {
      return;
    }

    this.logger.debug('[Analytics] Analytics service initialized');
  }

  private async syncAnalyticsState(shouldEnable: boolean): Promise<void> {
    if (!this.isBrowser) {
      return;
    }

    if (shouldEnable) {
      await this.enableAnalytics();
      return;
    }

    this.disableAnalytics();
  }

  private async enableAnalytics(): Promise<void> {
    if (this.enabled) {
      return;
    }

    if (!this.loadPromise) {
      this.loadPromise = this.loadApplicationInsights();
    }

    try {
      await this.loadPromise;
      this.enabled = true;
      this.logger.info('[Analytics] Optional analytics enabled');
    } catch (error) {
      this.loadPromise = null;
      this.logger.error('[Analytics] Failed to enable analytics', error);
    }
  }

  private disableAnalytics(): void {
    if (this.appInsights) {
      this.appInsights.flush(false);
      this.appInsights.config.disableTelemetry = true;
    }

    if (this.enabled) {
      this.logger.info('[Analytics] Optional analytics disabled');
    }

    this.enabled = false;
  }

  private async loadApplicationInsights(): Promise<void> {
    const { ApplicationInsights } = await import('@microsoft/applicationinsights-web');

    if (!this.appInsights) {
      this.appInsights = new ApplicationInsights({
        config: {
          connectionString: AnalyticsService.CONNECTION_STRING,
          disableTelemetry: false,
          enableAutoRouteTracking: true,
          autoTrackPageVisitTime: true,
        },
      });
      this.appInsights.loadAppInsights();
      return;
    }

    this.appInsights.config.disableTelemetry = false;
  }
}
