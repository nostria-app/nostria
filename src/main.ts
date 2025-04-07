import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

console.log('[BOOTSTRAP] Starting application bootstrap');

bootstrapApplication(AppComponent, appConfig)
  .then(() => {
    console.log('[BOOTSTRAP] Application successfully bootstrapped');
  })
  .catch((err) => {
    console.error('[BOOTSTRAP ERROR] Failed to bootstrap application', err);
  });
