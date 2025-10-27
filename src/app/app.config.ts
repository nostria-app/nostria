import {
  ApplicationConfig,
  inject,
  isDevMode,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
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
        rootUrl: new URL('api', environment.backendUrl),
      },
    },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline' },
    },
    provideNativeDateAdapter(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient(withFetch(), withInterceptors([nip98AuthInterceptor])),
    provideClientHydration(withEventReplay()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // enabled: true, // For development, set to true to test service worker. Also add "serviceWorker" in angular.json.
      registrationStrategy: 'registerWhenStable:30000',
    }),
    importProvidersFrom(DragDropModule),
  ],
};

bootstrapLogger.log('Application configuration complete');
