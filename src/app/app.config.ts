import { ApplicationConfig, isDevMode, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { LoggerService } from './services/logger.service';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { UserRelayFactoryService } from './services/user-relay-factory.service';
import { UserRelayService } from './services/user-relay.service';

// Create a logger for bootstrapping phase
const bootstrapLogger = {
  log: (message: string) => console.log(`[BOOTSTRAP] ${message}`),
  error: (message: string, error?: any) => console.error(`[BOOTSTRAP ERROR] ${message}`, error)
};

bootstrapLogger.log('Configuring application');

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: LoggerService,
      useFactory: () => {
        bootstrapLogger.log('Creating LoggerService');
        return new LoggerService();
      }
    },
    UserRelayFactoryService,
    UserRelayService,
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient(withFetch()),
    provideClientHydration(withEventReplay()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};

bootstrapLogger.log('Application configuration complete');
