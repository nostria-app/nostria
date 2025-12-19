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
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
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

let appLang = 'en';

if (typeof window !== 'undefined') {
  const settings = localStorage.getItem('nostria-settings');

  if (settings) {
    const parsedSettings = JSON.parse(settings);
    let locale = parsedSettings.locale || 'en';

    // Map 'no' to 'nb' for Angular locale compatibility
    if (locale === 'no') {
      locale = 'nb';
    }

    appLang = locale;
  }
}

// Create a logger for bootstrapping phase
const bootstrapLogger = {
  log: (message: string) => console.log(`[BOOTSTRAP] ${message}`),
  error: (message: string, error?: any) => console.error(`[BOOTSTRAP ERROR] ${message}`, error),
};

bootstrapLogger.log('Configuring application');

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: appLang },
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
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
    {
      provide: LoggerService,
      useFactory: () => {
        bootstrapLogger.log('Creating LoggerService');
        return new LoggerService();
      },
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
      enabled: !isDevMode(),
      // enabled: true, // For development, set to true to test service worker. Also add "serviceWorker" in angular.json.
      registrationStrategy: 'registerWhenStable:30000',
    }),
    importProvidersFrom(DragDropModule),
  ],
};

bootstrapLogger.log('Application configuration complete');
