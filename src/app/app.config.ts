import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  isDevMode,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, RouteReuseStrategy, TitleStrategy, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { NostriaTitleStrategy } from './services/nostria-title-strategy.service';
import { GlobalErrorHandler } from './services/global-error-handler.service';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';
import { importProvidersFrom } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { routes } from './app.routes';
import { LoggerService } from './services/logger.service';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MatIconRegistry } from '@angular/material/icon';
import { provideNativeDateAdapter } from '@angular/material/core';
import { ApiConfiguration } from './api/api-configuration';
import { environment } from '../environments/environment';
import { nip98AuthInterceptor } from './services/interceptors/nip98Auth';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';
import { CustomReuseStrategy } from './services/custom-reuse-strategy';
import { DesktopUpdaterService } from './services/desktop-updater.service';
import { ExternalLinkService } from './services/external-link.service';
import { getAngularLocaleCode, normalizeLocale } from './utils/supported-locales';
import { isTauri } from '@tauri-apps/api/core';

let appLang = 'en';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && isTauri();
}

async function clearTauriServiceWorkerState(): Promise<void> {
  if (!isTauriRuntime() || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));

    if (!('caches' in window)) {
      return;
    }

    const cacheNames = await caches.keys();
    const ngswCacheNames = cacheNames.filter(cacheName => cacheName.includes('ngsw'));
    await Promise.all(ngswCacheNames.map(cacheName => caches.delete(cacheName)));
  } catch (error) {
    console.warn('[AppConfig] Failed to clear service worker state for Tauri runtime.', error);
  }
}

const shouldEnableServiceWorker = !isDevMode() && !isTauriRuntime();

if (typeof window !== 'undefined') {
  const settings = localStorage.getItem('nostria-settings');

  if (settings) {
    const parsedSettings = JSON.parse(settings);
    appLang = getAngularLocaleCode(normalizeLocale(parsedSettings.locale));
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: appLang },
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    { provide: RouteReuseStrategy, useClass: CustomReuseStrategy },
    { provide: TitleStrategy, useClass: NostriaTitleStrategy },
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: { touchGestures: 'off' },
    },
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => {
      const initializerFn = ((iconRegistry: MatIconRegistry) => () => {
        const defaultFontSetClasses = iconRegistry.getDefaultFontSetClass();
        const outlinedFontSetClasses = defaultFontSetClasses
          .filter(fontSetClass => fontSetClass !== 'material-icons')
          .concat(['material-symbols-outlined']);
        iconRegistry.setDefaultFontSetClass(...outlinedFontSetClasses);
      })(inject(MatIconRegistry));
      return initializerFn();
    }),
    provideAppInitializer(() => {
      inject(DesktopUpdaterService).initialize();
    }),
    provideAppInitializer(() => clearTauriServiceWorkerState()),
    provideAppInitializer(() => {
      inject(ExternalLinkService).initialize();
    }),
    {
      provide: LoggerService,
      useFactory: () => new LoggerService(),
    },
    {
      provide: ApiConfiguration,
      useValue: {
        rootUrl: new URL('api', environment.backendUrl).toString(),
      },
    },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline' },
    },
    provideNativeDateAdapter(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        // Disabled: With two-column layout, scroll containers are .left-panel-content and .right-panel-content
        // Angular tracks the wrong element, and we manage scroll manually where needed
        scrollPositionRestoration: 'disabled',
        anchorScrolling: 'enabled',
      }),
      withNavigationErrorHandler((error: any) => {
        const errorMessage = error?.message || error?.toString() || '';
        // Check for chunk loading errors during navigation
        const chunkErrorPatterns = [
          'Failed to fetch dynamically imported module',
          'Loading chunk',
          'ChunkLoadError',
          'MIME type',
        ];
        const isChunkError = chunkErrorPatterns.some(pattern =>
          errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );

        if (isChunkError) {
          console.error('[Router] Chunk loading error during navigation, reloading app:', errorMessage);
          // Clear caches and reload
          (async () => {
            try {
              if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
              }
              if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(reg => reg.unregister()));
              }
            } catch (e) {
              console.error('Error clearing caches:', e);
            }
            window.location.reload();
          })();
        }
      })
    ),
    provideAnimations(),
    provideHttpClient(withFetch(), withInterceptors([nip98AuthInterceptor])),
    provideClientHydration(withEventReplay()),
    provideServiceWorker('service-worker.js', {
      enabled: shouldEnableServiceWorker,
      // enabled: true, // For development, set to true to test service worker. Also add "serviceWorker" in angular.json.
      registrationStrategy: 'registerWhenStable:30000',
    }),
    importProvidersFrom(DragDropModule),
  ],
};
