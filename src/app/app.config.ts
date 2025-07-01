import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';
import { importProvidersFrom } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { routes } from './app.routes';
import { LoggerService } from './services/logger.service';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { UserRelayFactoryService } from './services/user-relay-factory.service';
import { UserRelayService } from './services/user-relay.service';
import { MatIconRegistry } from '@angular/material/icon';
import { ApiConfiguration } from './api/api-configuration';
import { environment } from '../environments/environment';
import { nip98AuthInterceptor } from './services/interceptors/nip98Auth';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';

// Create a logger for bootstrapping phase
const bootstrapLogger = {
  log: (message: string) => console.log(`[BOOTSTRAP] ${message}`),
  error: (message: string, error?: any) => console.error(`[BOOTSTRAP ERROR] ${message}`, error)
};

bootstrapLogger.log('Configuring application');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => {
      const initializerFn = ((iconRegistry: MatIconRegistry) => () => {
        const defaultFontSetClasses = iconRegistry.getDefaultFontSetClass();
        const outlinedFontSetClasses = defaultFontSetClasses
          .filter((fontSetClass) => fontSetClass !== 'material-icons')
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
      }
    },
    {
      provide: ApiConfiguration,
      useValue: {
        rootUrl: new URL('api', environment.backendUrl)
      }
    },
     {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline' }
    },
    UserRelayFactoryService,
    UserRelayService,
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient(
      withFetch(),
      withInterceptors([nip98AuthInterceptor]),
    ),
    provideClientHydration(withEventReplay()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // enabled: true, // For development, set to true to test service worker. Also add "serviceWorker" in angular.json.
      registrationStrategy: 'registerWhenStable:30000'
    }),
    importProvidersFrom(DragDropModule)
  ]
};

bootstrapLogger.log('Application configuration complete');