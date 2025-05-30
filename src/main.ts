import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

console.log('[BOOTSTRAP] Starting application bootstrap');

bootstrapApplication(App, appConfig)
  .then(() => {
    console.log('[BOOTSTRAP] Application successfully bootstrapped');
  })
  .catch((err) => {
    console.error('[BOOTSTRAP ERROR] Failed to bootstrap application', err);
  });
